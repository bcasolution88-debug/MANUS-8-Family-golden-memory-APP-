/**
 * P9 — backups API (Settings → 自动备份).
 *
 *   list        my backups, newest first
 *   runNow      manual backup (rate-limited), emails a summary when mail is configured
 *   download    fresh 15-minute signed URL (or inline JSON when storage isn't configured)
 *   status      autoBackup flag + next scheduled run
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { BACKUP_TARGET_KINDS, backupRemoteUploads, backupTargets, backups, userPreferences } from "@/drizzle/schema";
import { isMailConfigured } from "@/server/_core/mailer";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { applyRetention, estimateMonthlyUsd, gdriveExchangeCode, isGoogleDriveConfigured, normalizeS3Endpoint, probeQuota, probeTarget, S3_STORAGE_CLASSES, TARGET_LABELS } from "@/server/_core/remoteTargets";
import { normalizeDavUrl, sealSecret } from "@/server/_core/webdav";
import { BACKUP_INTERVAL_MS, BACKUP_ZIP_MAX_BYTES, __inlineBackupPayload, loadBackupTarget, loadBackupTargetById, loadBackupTargets, refreshBackupRemoteStatus, resolveTarget, retryRemoteUploads, runBackup } from "@/server/backupService";
import { requireFamilyEditor } from "@/server/_core/authorization";
import { ALBUM_CONFLICT_STRATEGIES, enqueueRestore, filterManifestAlbums, filterManifestItems, previewRestoreItems, undoRestoreJob, getRestoreJob, listRestoreJobs, loadRestoreArtefact, parseBackupArtefact, planRestore, runRestore, RESTORE_MAX_ARCHIVE_BYTES, type RestoreResult } from "@/server/restoreService";
import { listTarget } from "@/server/_core/remoteTargets";
import { buildBackupKey } from "@/server/backupService";
import { storagePresignPut } from "@/server/storage";
import { getDb } from "@/server/db";
import { isStorageConfigured, storageGetSignedUrl } from "@/server/storage";
import { cancelCopy, enqueueCopy, getCopyJob, listCopyJobs } from "@/server/targetCopyService";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

const MAX_TARGETS = Number(process.env.BACKUP_MAX_TARGETS ?? 5);

const restoreSourceInput = z.object({
  familyId: z.number().int().positive(),
  backupId: z.number().int().positive().optional(),
  importKey: z.string().max(512).optional(),
  /** P12: a key returned by `remoteList` (restore straight from the cloud target). */
  remoteKey: z.string().max(512).optional(),
  /** P13: which target `remoteKey` lives on (defaults to the first enabled). */
  targetId: z.number().int().positive().optional(),
  /** P12: only these album names (null / empty = everything). */
  albums: z.array(z.string().trim().min(1).max(255)).max(200).optional(),
  /** P13: conflict strategy for same-name albums + hash de-duplication. */
  options: z.object({ albumConflict: z.enum(ALBUM_CONFLICT_STRATEGIES).optional(), dedupeByHash: z.boolean().optional() }).optional(),
  /** P14: only these manifest item ids (after the album filter). */
  items: z.array(z.number().int().positive()).max(5000).optional(),
});

export const backupRouter = router({
  list: protectedProcedure.input(z.object({ take: z.number().int().min(1).max(50).default(10) }).optional()).query(async ({ input, ctx }) => {
    const database = await requireDatabase();
    return database.select().from(backups).where(eq(backups.userId, ctx.user.id)).orderBy(desc(backups.createdAt)).limit(input?.take ?? 10);
  }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDatabase();
    const [pref] = await database.select({ autoBackup: userPreferences.autoBackup, backupIncludeMedia: userPreferences.backupIncludeMedia }).from(userPreferences).where(eq(userPreferences.userId, ctx.user.id)).limit(1);
    const [last] = await database.select().from(backups).where(eq(backups.userId, ctx.user.id)).orderBy(desc(backups.createdAt)).limit(1);
    const targets = await loadBackupTargets(ctx.user.id);
    const target = targets.find((t) => t.enabled) ?? targets[0] ?? null;
    const autoBackup = pref?.autoBackup ?? false;
    const nextRunAt = autoBackup ? new Date((last?.createdAt.getTime() ?? Date.now() - BACKUP_INTERVAL_MS) + BACKUP_INTERVAL_MS) : null;
    return {
      autoBackup,
      /** P10 */
      includeMedia: pref?.backupIncludeMedia ?? false,
      zipMaxBytes: BACKUP_ZIP_MAX_BYTES,
      lastBackupAt: last?.createdAt ?? null,
      lastItemCount: last?.itemCount ?? null,
      lastFormat: last?.format ?? null,
      lastRemoteStatus: last?.remoteStatus ?? null,
      nextRunAt,
      mailConfigured: isMailConfigured(),
      storageConfigured: isStorageConfigured(),
      target: target
        ? { id: target.id, kind: target.kind, label: TARGET_LABELS[target.kind], url: target.url, username: target.username, config: JSON.parse(target.config ?? "{}") as Record<string, unknown>, lastSuccessAt: target.lastSuccessAt, lastError: target.lastError }
        : null,
      /** P13: every target with health */
      targets: targets.map((t) => ({
        id: t.id,
        kind: t.kind,
        kindLabel: TARGET_LABELS[t.kind],
        label: t.label,
        enabled: t.enabled,
        url: t.url,
        username: t.username,
        config: JSON.parse(t.config ?? "{}") as Record<string, unknown>,
        health: t.health,
        lastCheckedAt: t.lastCheckedAt,
        lastSuccessAt: t.lastSuccessAt,
        lastError: t.lastError,
        /** P14 */
        keepCount: t.keepCount,
        storageClass: t.storageClass,
        usedBytes: t.usedBytes,
        quotaBytes: t.quotaBytes,
        quotaCheckedAt: t.quotaCheckedAt,
        estMonthlyUsd: t.kind === "s3" ? estimateMonthlyUsd(t.usedBytes ?? 0, t.storageClass ?? "STANDARD") : null,
      })),
      storageClasses: S3_STORAGE_CLASSES,
      /** P11 */
      targetKinds: BACKUP_TARGET_KINDS,
      gdriveConfigured: isGoogleDriveConfigured(),
    };
  }),

  runNow: protectedProcedure
    .input(z.object({ language: z.enum(["zh", "en"]).default("zh"), includeMedia: z.boolean().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ctx.user.id, "backup", USER_LIMITS.backup.limit, USER_LIMITS.backup.windowMs);
      return runBackup(ctx.user.id, "manual", { zh: (input?.language ?? "zh") === "zh", includeMedia: input?.includeMedia });
    }),

  download: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const [row] = await database.select().from(backups).where(and(eq(backups.id, input.id), eq(backups.userId, ctx.user.id))).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Backup not found" });
    const filename = row.storageKey.split("/").pop() ?? `backup.${row.format}`;
    if (isStorageConfigured()) {
      return { url: await storageGetSignedUrl(row.storageKey), inline: null, filename, format: row.format };
    }
    const inline = __inlineBackupPayload(row.id);
    if (!inline) throw new TRPCError({ code: "NOT_FOUND", message: "Backup payload is no longer available on this instance" });
    return { url: null, inline, filename, format: row.format };
  }),

  delete: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const result = await database.delete(backups).where(and(eq(backups.id, input.id), eq(backups.userId, ctx.user.id)));
    return { deleted: Number((result[0] as { affectedRows?: number }).affectedRows ?? 0) };
  }),

  /* ---------------------------------------------------------------- */
  /* P10 — off-site target (WebDAV: Nextcloud / 坚果云 / Synology …)      */
  /* ---------------------------------------------------------------- */

  /**
   * Save (or replace) the off-site target after a live credential probe.
   *   webdav  {url, username, password}
   *   s3      {url: endpoint, username: accessKeyId, password: secretAccessKey, config: {bucket, region, prefix?, pathStyle?}}
   *   gdrive  {code, redirectUri, config: {folderName?}}  — OAuth authorization code from the client consent flow
   */
  setTarget: protectedProcedure
    .input(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("webdav"), label: z.string().trim().max(64).optional(), url: z.string().min(8).max(512), username: z.string().min(1).max(255), password: z.string().min(1).max(512) }),
        z.object({
          kind: z.literal("s3"),
          label: z.string().trim().max(64).optional(),
          url: z.string().min(8).max(512),
          username: z.string().min(1).max(255),
          password: z.string().min(1).max(512),
          config: z.object({ bucket: z.string().min(3).max(128), region: z.string().min(1).max(64).default("us-east-1"), prefix: z.string().max(200).optional(), pathStyle: z.boolean().optional() }),
        }),
        z.object({ kind: z.literal("gdrive"), label: z.string().trim().max(64).optional(), code: z.string().min(10).max(2048), redirectUri: z.string().url(), config: z.object({ folderName: z.string().trim().min(1).max(100).optional() }).optional() }),
      ]),
    )
    .mutation(async ({ input, ctx }) => {
      let url: string;
      let username: string;
      let secret: string;
      let config: Record<string, unknown> = {};
      if (input.kind === "webdav") {
        const u = normalizeDavUrl(input.url);
        if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an https:// WebDAV folder URL" });
        url = u;
        username = input.username;
        secret = input.password;
      } else if (input.kind === "s3") {
        const u = normalizeS3Endpoint(input.url);
        if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an https:// S3 endpoint, e.g. https://s3.us-east-1.amazonaws.com" });
        url = u;
        username = input.username;
        secret = input.password;
        config = input.config;
      } else {
        if (!isGoogleDriveConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google Drive is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)" });
        const ex = await gdriveExchangeCode(input.code, input.redirectUri);
        url = "root";
        username = ex.email ?? ctx.user.email ?? "google";
        secret = ex.refreshToken;
        config = { folderName: input.config?.folderName ?? "GoldenMemory" };
      }
      const probe = await probeTarget({ kind: input.kind, url, username, secret, config });
      if (!probe.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: probe.error });
      const database = await requireDatabase();
      const existing = await loadBackupTargets(ctx.user.id);
      if (existing.length >= MAX_TARGETS) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `At most ${MAX_TARGETS} cloud targets` });
      const secretEnc = sealSecret(secret);
      const configJson = JSON.stringify(config);
      // P13: targets are additive (several in parallel); label defaults to the kind name.
      const label = input.label?.trim() || TARGET_LABELS[input.kind].zh;
      const ins = await database.insert(backupTargets).values({ userId: ctx.user.id, kind: input.kind, label, url, username, secretEnc, config: configJson, lastError: null, lastSuccessAt: null, health: "ok", lastCheckedAt: new Date() });
      return { saved: true as const, id: Number(ins[0].insertId), kind: input.kind, label, url, username, detail: probe.detail ?? null };
    }),

  /** Re-probe a saved target (Settings → 测试连接). P13: by id (defaults to first). */
  testTarget: protectedProcedure.input(z.object({ id: z.number().int().positive() }).optional()).mutation(async ({ input, ctx }) => {
    const t = input?.id ? await loadBackupTargetById(ctx.user.id, input.id) : await loadBackupTarget(ctx.user.id);
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "No backup target configured" });
    const probe = await probeTarget(resolveTarget(t));
    const database = await requireDatabase();
    await database.update(backupTargets).set({ lastError: probe.ok ? null : probe.error, health: probe.ok ? "ok" : "down", lastCheckedAt: new Date() }).where(eq(backupTargets.id, t.id));
    return probe;
  }),

  /** P13: rename / enable / disable a target. */
  updateTarget: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), label: z.string().trim().min(1).max(64).optional(), enabled: z.boolean().optional(), keepCount: z.number().int().min(1).max(100).nullable().optional(), storageClass: z.enum(S3_STORAGE_CLASSES).nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
    const t = await loadBackupTargetById(ctx.user.id, input.id);
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    const patch: Partial<typeof backupTargets.$inferInsert> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.keepCount !== undefined) patch.keepCount = input.keepCount;
    if (input.storageClass !== undefined) {
      if (input.storageClass && t.kind !== "s3") throw new TRPCError({ code: "BAD_REQUEST", message: "Storage class applies to S3 targets only" });
      patch.storageClass = input.storageClass;
    }
    const database = await requireDatabase();
    if (Object.keys(patch).length) await database.update(backupTargets).set(patch).where(eq(backupTargets.id, t.id));
    return { ok: true as const };
  }),

  /** P14: usage of our folder + provider quota; persists the snapshot. */
  targetQuota: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const t = await loadBackupTargetById(ctx.user.id, input.id);
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    try {
      const q = await probeQuota(resolveTarget(t));
      const database = await requireDatabase();
      await database.update(backupTargets).set({ usedBytes: q.usedBytes, quotaBytes: q.quotaBytes, quotaCheckedAt: new Date() }).where(eq(backupTargets.id, t.id));
      return { ...q, estMonthlyUsd: t.kind === "s3" ? estimateMonthlyUsd(q.usedBytes, t.storageClass ?? "STANDARD") : null };
    } catch (e) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: e instanceof Error ? e.message : "Quota probe failed" });
    }
  }),

  /** P14: apply the keep-N retention on a target right now. */
  /* P15 — copy backups between targets (background, verified) */
  copyTarget: protectedProcedure
    .input(z.object({ fromTargetId: z.number().int().positive(), toTargetId: z.number().int().positive(), keys: z.array(z.string().max(512)).max(500).optional(), storageClass: z.enum(S3_STORAGE_CLASSES).optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return { jobId: await enqueueCopy({ userId: ctx.user.id, ...input, keys: input.keys ?? null, storageClass: input.storageClass ?? null }) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "copy failed";
        throw new TRPCError({ code: msg === "Target not found" ? "NOT_FOUND" : "PRECONDITION_FAILED", message: msg });
      }
    }),
  copyJobs: protectedProcedure.input(z.object({ take: z.number().int().min(1).max(50).default(10) }).optional()).query(({ input, ctx }) => listCopyJobs(ctx.user.id, input?.take ?? 10)),
  copyJob: protectedProcedure.input(z.object({ jobId: z.string().uuid() })).query(async ({ input, ctx }) => {
    const job = await getCopyJob(ctx.user.id, input.jobId);
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    return job;
  }),
  cancelCopy: protectedProcedure.input(z.object({ jobId: z.string().uuid() })).mutation(async ({ input, ctx }) => ({ cancelled: await cancelCopy(ctx.user.id, input.jobId) })),

  pruneTarget: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const t = await loadBackupTargetById(ctx.user.id, input.id);
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    if (!t.keepCount) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Set a keep count first" });
    try {
      const removed = await applyRetention(resolveTarget(t), t.keepCount);
      return { removed };
    } catch (e) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: e instanceof Error ? e.message : "Retention failed" });
    }
  }),

  /** P13: per-backup per-target upload status (for the backup list rows). */
  remoteUploads: protectedProcedure.input(z.object({ backupId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const rows = await database
      .select({ id: backupRemoteUploads.id, targetId: backupRemoteUploads.targetId, status: backupRemoteUploads.status, attempts: backupRemoteUploads.attempts, nextAttemptAt: backupRemoteUploads.nextAttemptAt, lastError: backupRemoteUploads.lastError, uploadedAt: backupRemoteUploads.uploadedAt, label: backupTargets.label, kind: backupTargets.kind })
      .from(backupRemoteUploads)
      .leftJoin(backupTargets, eq(backupTargets.id, backupRemoteUploads.targetId))
      .where(and(eq(backupRemoteUploads.backupId, input.backupId), eq(backupRemoteUploads.userId, ctx.user.id)));
    return rows;
  }),

  /** P13: retry a failed / queued remote upload right now. */
  retryRemote: protectedProcedure.input(z.object({ uploadId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const [u] = await database.select().from(backupRemoteUploads).where(and(eq(backupRemoteUploads.id, input.uploadId), eq(backupRemoteUploads.userId, ctx.user.id))).limit(1);
    if (!u) throw new TRPCError({ code: "NOT_FOUND" });
    await database.update(backupRemoteUploads).set({ status: "queued", nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(backupRemoteUploads.id, u.id));
    const r = await retryRemoteUploads(new Date(), 50);
    await refreshBackupRemoteStatus(u.backupId);
    const [after] = await database.select().from(backupRemoteUploads).where(eq(backupRemoteUploads.id, u.id)).limit(1);
    return { retried: r.retried, status: after?.status ?? "failed", lastError: after?.lastError ?? null };
  }),

  /** P11: URL the client opens to start Google consent (offline access → refresh token). */
  gdriveAuthUrl: protectedProcedure.input(z.object({ redirectUri: z.string().url() })).query(({ input }) => {
    if (!isGoogleDriveConfigured()) return { url: null, configured: false as const };
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    u.searchParams.set("redirect_uri", input.redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file openid email");
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    return { url: u.toString(), configured: true as const };
  }),

  /** Remove one target (P13: by id) or all when no id given. */
  removeTarget: protectedProcedure.input(z.object({ id: z.number().int().positive() }).optional()).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const where = input?.id ? and(eq(backupTargets.userId, ctx.user.id), eq(backupTargets.id, input.id)) : eq(backupTargets.userId, ctx.user.id);
    const r = await database.delete(backupTargets).where(where);
    return { removed: Number((r[0] as { affectedRows?: number }).affectedRows ?? 0) > 0 };
  }),

  /* ---------------------------------------------------------------- */
  /* P11 — restore / import                                             */
  /* ---------------------------------------------------------------- */

  /** Presigned PUT for a user-supplied backup file (zip / json) to restore from. */
  presignImport: protectedProcedure
    .input(z.object({ fileName: z.string().min(1).max(255), fileSize: z.number().int().positive().max(RESTORE_MAX_ARCHIVE_BYTES) }))
    .mutation(async ({ input, ctx }) => {
      if (!isStorageConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is not configured — restore from an existing backup instead" });
      const ext = input.fileName.toLowerCase().endsWith(".zip") ? "zip" : "json";
      const key = buildBackupKey(ctx.user.id, new Date(), ext).replace("/backups/", "/backups/import-");
      const { url } = await storagePresignPut(key, ext === "zip" ? "application/zip" : "application/json");
      return { importKey: key, presignedUrl: url };
    }),

  /**
   * Inspect a backup (by row id or import key) against a family: which albums
   * would be created / reused, how many files, how many already restored.
   */
  restorePlan: protectedProcedure
    .input(restoreSourceInput)
    .mutation(async ({ input, ctx }) => {
      await requireFamilyEditor(ctx.user.id, input.familyId);
      const buf = await loadArtefact(ctx.user.id, input);
      const parsed = filterManifestItems(filterManifestAlbums(parseBackupArtefact(buf), input.albums), input.items);
      return planRestore(input.familyId, parsed, input.options ?? null);
    }),

  /** P14: per-item visual diff (backup vs existing) for the restore preview. */
  restorePreview: protectedProcedure.input(restoreSourceInput.extend({ limit: z.number().int().min(1).max(1000).default(400) })).mutation(async ({ input, ctx }) => {
    await requireFamilyEditor(ctx.user.id, input.familyId);
    const buf = await loadArtefact(ctx.user.id, input);
    const parsed = filterManifestAlbums(parseBackupArtefact(buf), input.albums);
    const items = await previewRestoreItems(input.familyId, parsed, input.options ?? null, input.limit);
    return { total: parsed.manifest.items.length, items };
  }),

  /** P14: roll back a completed restore (deletes what that run created). */
  undoRestore: protectedProcedure.input(z.object({ jobId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    try {
      return await undoRestoreJob(ctx.user.id, input.jobId);
    } catch (e) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: e instanceof Error ? e.message : "Undo failed" });
    }
  }),

  /** Run the restore synchronously (small archives). Prefer `restoreAsync` for zips. */
  restore: protectedProcedure
    .input(restoreSourceInput)
    .mutation(async ({ input, ctx }): Promise<RestoreResult> => {
      await requireFamilyEditor(ctx.user.id, input.familyId);
      await assertUserRateLimit(ctx.user.id, "restore", USER_LIMITS.backup.limit, USER_LIMITS.backup.windowMs);
      const buf = await loadArtefact(ctx.user.id, input);
      const parsed = filterManifestItems(filterManifestAlbums(parseBackupArtefact(buf), input.albums), input.items);
      return runRestore({ userId: ctx.user.id, familyId: input.familyId, parsed, options: input.options ?? null });
    }),

  /* ---------------------------------------------------------------- */
  /* P12 — background restore jobs + cloud target history               */
  /* ---------------------------------------------------------------- */

  /** Queue a restore; poll `restoreJob` for progress. */
  restoreAsync: protectedProcedure.input(restoreSourceInput).mutation(async ({ input, ctx }) => {
    await requireFamilyEditor(ctx.user.id, input.familyId);
    await assertUserRateLimit(ctx.user.id, "restore", USER_LIMITS.backup.limit, USER_LIMITS.backup.windowMs);
    const jobId = await enqueueRestore({ userId: ctx.user.id, familyId: input.familyId, source: input, albums: input.albums ?? null, options: input.options ?? null, items: input.items ?? null });
    return { jobId };
  }),

  restoreJob: protectedProcedure.input(z.object({ jobId: z.string().uuid() })).query(async ({ input, ctx }) => {
    const job = await getRestoreJob(ctx.user.id, input.jobId);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Restore job not found" });
    return job;
  }),

  restoreJobs: protectedProcedure.input(z.object({ take: z.number().int().min(1).max(50).default(10) }).optional()).query(({ input, ctx }) => listRestoreJobs(ctx.user.id, input?.take ?? 10)),

  /** Backups stored on the user's cloud target (newest first). P13: pick a target by id. */
  remoteList: protectedProcedure.input(z.object({ targetId: z.number().int().positive().optional() }).optional()).query(async ({ input, ctx }) => {
    const t = input?.targetId ? await loadBackupTargetById(ctx.user.id, input.targetId) : await loadBackupTarget(ctx.user.id);
    if (!t) return { target: null, entries: [] as Awaited<ReturnType<typeof listTarget>> };
    try {
      const entries = await listTarget(resolveTarget(t));
      return { target: { id: t.id, kind: t.kind, label: TARGET_LABELS[t.kind], name: t.label }, entries };
    } catch (error) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Could not list the cloud target" });
    }
  }),
});



/** Shared with the background worker (owner-checked; supports backupId / importKey / remoteKey). */
async function loadArtefact(userId: number, input: { backupId?: number; importKey?: string; remoteKey?: string }): Promise<Buffer> {
  try {
    return await loadRestoreArtefact(userId, input);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not load backup";
    const code = /not found|no longer available/i.test(msg) ? "NOT_FOUND" : /belong|configured/i.test(msg) ? "FORBIDDEN" : "BAD_REQUEST";
    throw new TRPCError({ code, message: msg });
  }
}
