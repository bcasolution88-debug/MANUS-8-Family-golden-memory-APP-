/**
 * P9 — data export builder + backup worker.
 *
 *   buildExport(userId, {format, includeLinks})  shared by profile.exportData and backups
 *   runBackup(userId, trigger)                   JSON export → users/{uid}/backups/*.json (private) → `backups` row → email
 *   runScheduledBackups()                        for every user with autoBackup=true whose last backup is > 7 days old
 *   startBackupScheduler()                       hourly tick (single-instance friendly: BACKUP_SCHEDULER=0 disables)
 *
 * Backups contain metadata + 15-minute signed links at creation time; the
 * JSON itself lives in private storage and is downloaded via a fresh signed
 * URL (`backup.download`). Without storage configured the worker still records
 * the run but keeps the payload inline for `download` to return directly.
 */
import * as archiverNs from "archiver";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { PassThrough } from "node:stream";
import { hostname } from "node:os";

import { albums, backupRemoteUploads, backups, backupTargets, media, userPreferences, users, type BackupTarget } from "@/drizzle/schema";
import { runIfLeader } from "@/server/_core/coordination";
import { recordMetric } from "@/server/_core/metrics";
import { backupEmail, sendMail } from "@/server/_core/mailer";
import { applyRetention, parseTargetConfig, probeQuota, probeTarget, uploadToTarget, type ResolvedTarget } from "@/server/_core/remoteTargets";
import { openSecret } from "@/server/_core/webdav";
import { getDb } from "@/server/db";
import { isStorageConfigured, sanitizeFileName, storageGetSignedUrl, storagePresignPut } from "@/server/storage";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
  count: number;
}

/** Raw rows for a user's uploads (shared by the export + zip builders). */
async function loadUserMedia(userId: number) {
  const database = await requireDatabase();
  return database
    .select({
      id: media.id,
      type: media.type,
      title: media.title,
      description: media.description,
      albumId: media.albumId,
      albumName: albums.name,
      familyId: media.familyId,
      fileSize: media.fileSize,
      duration: media.duration,
      likeCount: media.likeCount,
      commentCount: media.commentCount,
      createdAt: media.createdAt,
      storageKey: media.storageKey,
      url: media.url,
    })
    .from(media)
    .leftJoin(albums, eq(albums.id, media.albumId))
    .where(eq(media.uploadedBy, userId))
    .orderBy(desc(media.createdAt))
    .limit(5000);
}

export async function buildExport(user: { id: number; email: string | null; name: string | null }, opts: { format: "csv" | "json"; includeLinks: boolean }): Promise<ExportFile> {
  const rows = await loadUserMedia(user.id);
  const signed = isStorageConfigured() && opts.includeLinks;
  const items = await Promise.all(
    rows.map(async ({ storageKey, url, ...r }) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      downloadUrl: opts.includeLinks ? (signed && storageKey ? await storageGetSignedUrl(storageKey) : url) : undefined,
    })),
  );
  const exportedAt = new Date().toISOString();
  if (opts.format === "json") {
    return {
      filename: `golden-memory-export-${exportedAt.slice(0, 10)}.json`,
      mimeType: "application/json",
      content: JSON.stringify({ exportedAt, user: { id: user.id, email: user.email, name: user.name }, count: items.length, items }, null, 2),
      count: items.length,
    };
  }
  const cols = ["id", "type", "title", "description", "albumId", "albumName", "familyId", "fileSize", "duration", "likeCount", "commentCount", "createdAt", ...(opts.includeLinks ? ["downloadUrl"] : [])] as const;
  const esc = (v: unknown) => {
    const str = v == null ? "" : String(v);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [cols.join(","), ...items.map((it) => cols.map((c) => esc((it as Record<string, unknown>)[c])).join(","))];
  return {
    filename: `golden-memory-export-${exportedAt.slice(0, 10)}.csv`,
    mimeType: "text/csv",
    content: "\ufeff" + lines.join("\r\n"),
    count: items.length,
  };
}

/* ------------------------------------------------------------------ */
/* Backups                                                             */
/* ------------------------------------------------------------------ */

export const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const BACKUP_KEEP = 8;

/** In-memory payloads for the dev / no-storage path (`download` serves them). */
const inlinePayloads = new Map<number, string>();
export function __inlineBackupPayload(id: number) {
  return inlinePayloads.get(id);
}

export type BackupFormat = "json" | "zip";

export function buildBackupKey(userId: number, when = new Date(), format: BackupFormat = "json"): string {
  return `users/${userId}/backups/${when.toISOString().replace(/[:.]/g, "-")}.${format}`;
}

/** P10: total media bytes bundled into one zip (default 2 GB) and per-file cap (default 500 MB). */
export const BACKUP_ZIP_MAX_BYTES = Number(process.env.BACKUP_ZIP_MAX_BYTES ?? 2 * 1024 * 1024 * 1024);
export const BACKUP_FILE_MAX_BYTES = Number(process.env.BACKUP_FILE_MAX_BYTES ?? 500 * 1024 * 1024);

export interface ZipBuildResult {
  buffer: Buffer;
  bytes: number;
  itemCount: number;
  mediaCount: number;
  skippedCount: number;
}

/**
 * P10 — manifest.json + every original photo / video the user uploaded, laid
 * out as `media/{albumName}/{id}_{title}.{ext}`. Files that exceed the per-file
 * cap, would push the archive past BACKUP_ZIP_MAX_BYTES, or fail to download
 * are listed in `manifest.skipped` instead of aborting the backup.
 */
export async function buildMediaZip(user: { id: number; email: string | null; name: string | null }): Promise<ZipBuildResult> {
  const rows = await loadUserMedia(user.id);
  // CJS default-export interop: works under tsx (ESM) and the esbuild bundle alike.
  const archiver = ((archiverNs as unknown as { default?: typeof archiverNs }).default ?? archiverNs) as unknown as (format: "zip", opts?: archiverNs.ArchiverOptions) => archiverNs.Archiver;
  const archive = archiver("zip", { zlib: { level: 1 } }); // media is already compressed; favour speed
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    archive.on("error", reject);
    archive.on("warning", (w: Error) => console.warn("[backup] zip warning", w.message));
  });
  archive.pipe(sink);

  let budget = BACKUP_ZIP_MAX_BYTES;
  let mediaCount = 0;
  const skipped: Array<{ id: number; reason: string }> = [];
  const manifestItems: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    const { storageKey, url, ...meta } = r;
    const ext = (storageKey ?? url).split("?")[0]!.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || (r.type === "video" ? "mp4" : "jpg");
    const folder = sanitizeFileName(r.albumName ?? `album-${r.albumId}`);
    const entry = `media/${folder}/${r.id}_${sanitizeFileName(r.title ?? r.type)}.${ext}`;
    const item: Record<string, unknown> = { ...meta, createdAt: r.createdAt.toISOString(), file: null as string | null };
    const size = r.fileSize ?? 0;
    let reason: string | null = null;
    if (!isStorageConfigured() || !storageKey) reason = "not_in_storage";
    else if (size > BACKUP_FILE_MAX_BYTES) reason = "file_too_large";
    else if (size > budget) reason = "archive_budget_exceeded";
    if (!reason) {
      try {
        const signed = await storageGetSignedUrl(storageKey!);
        const res = await fetch(signed);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > BACKUP_FILE_MAX_BYTES || buf.byteLength > budget) throw new Error("size");
        archive.append(buf, { name: entry, date: r.createdAt });
        budget -= buf.byteLength;
        mediaCount += 1;
        item.file = entry;
        item.contentHash = createHash("sha256").update(buf).digest("hex"); // P13: restore de-dup
      } catch (error) {
        reason = `download_failed:${error instanceof Error ? error.message : "unknown"}`.slice(0, 80);
      }
    }
    if (reason) skipped.push({ id: r.id, reason });
    manifestItems.push(item);
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email, name: user.name },
    count: manifestItems.length,
    mediaCount,
    skipped,
    items: manifestItems,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  await archive.finalize();
  await finished;
  const buffer = Buffer.concat(chunks);
  return { buffer, bytes: buffer.byteLength, itemCount: manifestItems.length, mediaCount, skippedCount: skipped.length };
}

/* ------------------------------------------------------------------ */
/* Off-site copy (WebDAV)                                              */
/* ------------------------------------------------------------------ */

/** P13: all of a user's targets (enabled first, oldest first). */
export async function loadBackupTargets(userId: number): Promise<BackupTarget[]> {
  const database = await requireDatabase();
  return database.select().from(backupTargets).where(eq(backupTargets.userId, userId)).orderBy(desc(backupTargets.enabled), backupTargets.id);
}

/** Back-compat: the user's first enabled target (used by single-target paths). */
export async function loadBackupTarget(userId: number): Promise<BackupTarget | null> {
  const all = await loadBackupTargets(userId);
  return all.find((t) => t.enabled) ?? all[0] ?? null;
}

/** P13: one target by id, owner-checked. */
export async function loadBackupTargetById(userId: number, id: number): Promise<BackupTarget | null> {
  const database = await requireDatabase();
  const [t] = await database.select().from(backupTargets).where(and(eq(backupTargets.id, id), eq(backupTargets.userId, userId))).limit(1);
  return t ?? null;
}

/** P11: decrypt + parse a stored row into what the uploaders need. */
export function resolveTarget(row: { kind: ResolvedTarget["kind"]; url: string; username: string; secretEnc: string; config: string | null; storageClass?: string | null }): ResolvedTarget {
  return { kind: row.kind, url: row.url, username: row.username, secret: openSecret(row.secretEnc), config: parseTargetConfig(row.config), storageClass: row.storageClass ?? null };
}

/* ------------------------------------------------------------------ */
/* P13 — parallel multi-target sync + retry queue + health probes     */
/* ------------------------------------------------------------------ */

export const REMOTE_MAX_ATTEMPTS = Math.max(1, Number(process.env.REMOTE_MAX_ATTEMPTS ?? 5));
/** Exponential backoff: 5 min, 15, 45, 135, 405 … capped at 24 h. */
export function remoteRetryDelayMs(attempt: number): number {
  return Math.min(24 * 3_600_000, 5 * 60_000 * Math.pow(3, Math.max(0, attempt - 1)));
}

type RemoteOutcome = { targetId: number; label: string; kind: ResolvedTarget["kind"]; ok: boolean; error?: string };

/** Upload one artefact to one target, updating target health + the upload row. */
async function uploadOnce(t: BackupTarget, uploadRowId: number, filename: string, body: Buffer, contentType: string): Promise<RemoteOutcome> {
  const database = await requireDatabase();
  const label = t.label ?? t.kind;
  try {
    await uploadToTarget(resolveTarget(t), filename, body, contentType);
    // P14: per-target retention (keep newest N) — best effort, never fails the upload.
    if (t.keepCount) await applyRetention(resolveTarget(t), t.keepCount).catch((e) => console.warn(`[remote] retention on target ${t.id} failed`, e));
    await database.update(backupTargets).set({ lastSuccessAt: new Date(), lastError: null, health: "ok", lastCheckedAt: new Date() }).where(eq(backupTargets.id, t.id));
    await database.update(backupRemoteUploads).set({ status: "uploaded", uploadedAt: new Date(), lastError: null, nextAttemptAt: null }).where(eq(backupRemoteUploads.id, uploadRowId));
    recordMetric("backup_remote", true, { detail: `${t.kind}:uploaded` });
    return { targetId: t.id, label, kind: t.kind, ok: true };
  } catch (error) {
    const msg = (error instanceof Error ? error.message : "upload failed").slice(0, 500);
    const [row] = await database.select({ attempts: backupRemoteUploads.attempts }).from(backupRemoteUploads).where(eq(backupRemoteUploads.id, uploadRowId)).limit(1);
    const attempts = (row?.attempts ?? 0) + 1;
    const giveUp = attempts >= REMOTE_MAX_ATTEMPTS;
    await database
      .update(backupRemoteUploads)
      .set({ status: giveUp ? "failed" : "queued", attempts, lastError: msg, nextAttemptAt: giveUp ? null : new Date(Date.now() + remoteRetryDelayMs(attempts)) })
      .where(eq(backupRemoteUploads.id, uploadRowId));
    await database.update(backupTargets).set({ lastError: msg, health: "degraded", lastCheckedAt: new Date() }).where(eq(backupTargets.id, t.id));
    recordMetric("backup_remote", false, { detail: `${t.kind}:${msg}`.slice(0, 120) });
    return { targetId: t.id, label, kind: t.kind, ok: false, error: msg };
  }
}

/**
 * Copy a fresh backup to every enabled target in parallel. Failures are queued
 * for retry (see `retryRemoteUploads`). Returns a per-target summary.
 */
async function copyToTargets(userId: number, backupId: number, filename: string, body: Buffer, contentType: string): Promise<{ status: "uploaded" | "partial" | "failed" | null; error?: string; outcomes: RemoteOutcome[] }> {
  const targets = (await loadBackupTargets(userId)).filter((t) => t.enabled);
  if (targets.length === 0) return { status: null, outcomes: [] };
  const database = await requireDatabase();
  const rows = await Promise.all(
    targets.map(async (t) => {
      const ins = await database.insert(backupRemoteUploads).values({ backupId, targetId: t.id, userId, status: "queued", attempts: 0 });
      return { t, rowId: Number(ins[0].insertId) };
    }),
  );
  const outcomes = await Promise.all(rows.map(({ t, rowId }) => uploadOnce(t, rowId, filename, body, contentType)));
  const ok = outcomes.filter((o) => o.ok).length;
  const status = ok === outcomes.length ? "uploaded" : ok === 0 ? "failed" : "partial";
  const error = outcomes
    .filter((o) => !o.ok)
    .map((o) => `${o.label}: ${o.error}`)
    .join(" · ")
    .slice(0, 500);
  return { status, error: error || undefined, outcomes };
}

/** Re-download the backup artefact (storage or inline) for a retry. */
async function loadArtefactForRetry(backupId: number): Promise<{ body: Buffer; filename: string; contentType: string } | null> {
  const database = await requireDatabase();
  const [b] = await database.select().from(backups).where(eq(backups.id, backupId)).limit(1);
  if (!b) return null;
  const filename = b.storageKey.split("/").pop()!;
  const contentType = b.format === "zip" ? "application/zip" : "application/json";
  if (isStorageConfigured()) {
    const res = await fetch(await storageGetSignedUrl(b.storageKey));
    if (!res.ok) return null;
    return { body: Buffer.from(await res.arrayBuffer()), filename, contentType };
  }
  const inline = inlinePayloads.get(backupId);
  return inline ? { body: Buffer.from(inline, "utf8"), filename, contentType } : null;
}

/** Leader-only: retry queued remote uploads whose backoff has elapsed. */
export async function retryRemoteUploads(now = new Date(), limit = 20): Promise<{ retried: number; ok: number }> {
  const database = await requireDatabase();
  const due = await database
    .select()
    .from(backupRemoteUploads)
    .where(and(eq(backupRemoteUploads.status, "queued"), lt(backupRemoteUploads.nextAttemptAt, now)))
    .orderBy(backupRemoteUploads.nextAttemptAt)
    .limit(limit);
  let ok = 0;
  for (const u of due) {
    const [t] = await database.select().from(backupTargets).where(eq(backupTargets.id, u.targetId)).limit(1);
    if (!t || !t.enabled) {
      await database.update(backupRemoteUploads).set({ status: "failed", lastError: "target removed or disabled", nextAttemptAt: null }).where(eq(backupRemoteUploads.id, u.id));
      continue;
    }
    const art = await loadArtefactForRetry(u.backupId);
    if (!art) {
      await database.update(backupRemoteUploads).set({ status: "failed", lastError: "backup payload no longer available", nextAttemptAt: null }).where(eq(backupRemoteUploads.id, u.id));
      continue;
    }
    const r = await uploadOnce(t, u.id, art.filename, art.body, art.contentType);
    if (r.ok) ok += 1;
  }
  // Roll the aggregate status up to the backups row.
  const touched = [...new Set(due.map((d) => d.backupId))];
  for (const backupId of touched) await refreshBackupRemoteStatus(backupId);
  return { retried: due.length, ok };
}

/** Recompute backups.remoteStatus from its upload rows. */
export async function refreshBackupRemoteStatus(backupId: number): Promise<void> {
  const database = await requireDatabase();
  const rows = await database.select({ status: backupRemoteUploads.status, lastError: backupRemoteUploads.lastError }).from(backupRemoteUploads).where(eq(backupRemoteUploads.backupId, backupId));
  if (rows.length === 0) return;
  const uploaded = rows.filter((r) => r.status === "uploaded").length;
  const queued = rows.filter((r) => r.status === "queued").length;
  const status = uploaded === rows.length ? "uploaded" : uploaded === 0 && queued === 0 ? "failed" : "partial";
  const err = rows.map((r) => r.lastError).filter(Boolean).join(" · ").slice(0, 500) || null;
  await database.update(backups).set({ remoteStatus: status, remoteError: status === "uploaded" ? null : err }).where(eq(backups.id, backupId));
}

export const TARGET_PROBE_INTERVAL_MS = Number(process.env.TARGET_PROBE_INTERVAL_MS ?? 6 * 3_600_000);

/** Leader-only: probe every enabled target not checked within the interval; sets health ok / down. */
export async function probeTargetsHealth(now = new Date(), limit = 50): Promise<{ checked: number; down: number }> {
  const database = await requireDatabase();
  const cutoff = new Date(now.getTime() - TARGET_PROBE_INTERVAL_MS);
  const rows = await database
    .select()
    .from(backupTargets)
    .where(and(eq(backupTargets.enabled, true), sql`(${backupTargets.lastCheckedAt} IS NULL OR ${backupTargets.lastCheckedAt} < ${cutoff})`))
    .limit(limit);
  let down = 0;
  for (const t of rows) {
    const r = await probeTarget(resolveTarget(t));
    if (!r.ok) down += 1;
    await database.update(backupTargets).set({ health: r.ok ? "ok" : "down", lastError: r.ok ? null : r.error.slice(0, 500), lastCheckedAt: now }).where(eq(backupTargets.id, t.id));
    // P14: quota snapshot alongside the health probe (best effort).
    if (r.ok) {
      try {
        const q = await probeQuota(resolveTarget(t));
        await database.update(backupTargets).set({ usedBytes: q.usedBytes, quotaBytes: q.quotaBytes, quotaCheckedAt: now }).where(eq(backupTargets.id, t.id));
      } catch {
        /* quota is informational */
      }
    }
  }
  return { checked: rows.length, down };
}

let remoteTimer: NodeJS.Timeout | null = null;
export function startRemoteSyncScheduler(intervalMs = 10 * 60 * 1000): void {
  if (process.env.REMOTE_SYNC_SCHEDULER === "0" || remoteTimer) return;
  const tick = () =>
    void runIfLeader("remote-sync", 8 * 60 * 1000, async () => {
      const r = await retryRemoteUploads();
      const h = await probeTargetsHealth();
      if (r.retried || h.checked) console.log(`[remote-sync] retried ${r.retried} (${r.ok} ok), probed ${h.checked} (${h.down} down)`);
      return r;
    }).catch((e) => console.error("[remote-sync] tick failed", e));
  remoteTimer = setInterval(tick, intervalMs);
  remoteTimer.unref?.();
  setTimeout(tick, 45_000).unref?.();
}

export function stopRemoteSyncScheduler(): void {
  if (remoteTimer) clearInterval(remoteTimer);
  remoteTimer = null;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export interface RunBackupResult {
  id: number;
  bytes: number;
  itemCount: number;
  storageKey: string;
  format: BackupFormat;
  mediaCount: number;
  skippedCount: number;
  delivered: boolean;
  remoteStatus: "uploaded" | "partial" | "failed" | null;
  remoteError?: string;
  /** P13: per-target outcome */
  remoteOutcomes?: Array<{ targetId: number; label: string; kind: ResolvedTarget["kind"]; ok: boolean; error?: string }>;
}

export async function runBackup(
  userId: number,
  trigger: "scheduled" | "manual",
  opts: { notify?: boolean; zh?: boolean; includeMedia?: boolean } = {},
): Promise<RunBackupResult> {
  const started = Date.now();
  try {
    const r = await runBackupInner(userId, trigger, opts);
    recordMetric("backup", true, { durationMs: Date.now() - started, detail: `${trigger}:${r.format}` });
    return r;
  } catch (error) {
    recordMetric("backup", false, { durationMs: Date.now() - started, detail: error instanceof Error ? error.message : "failed" });
    throw error;
  }
}

async function runBackupInner(
  userId: number,
  trigger: "scheduled" | "manual",
  opts: { notify?: boolean; zh?: boolean; includeMedia?: boolean },
): Promise<RunBackupResult> {
  const database = await requireDatabase();
  const [user] = await database.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");

  // Scheduled runs follow the user's preference; manual runs may override.
  let includeMedia = opts.includeMedia;
  if (includeMedia === undefined) {
    const [p] = await database.select({ v: userPreferences.backupIncludeMedia }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    includeMedia = p?.v ?? false;
  }
  const format: BackupFormat = includeMedia ? "zip" : "json";

  let body: Buffer;
  let itemCount: number;
  let mediaCount = 0;
  let skippedCount = 0;
  let contentType: string;
  if (format === "zip") {
    const zip = await buildMediaZip(user);
    body = zip.buffer;
    itemCount = zip.itemCount;
    mediaCount = zip.mediaCount;
    skippedCount = zip.skippedCount;
    contentType = "application/zip";
  } else {
    const file = await buildExport(user, { format: "json", includeLinks: true });
    body = Buffer.from(file.content, "utf8");
    itemCount = file.count;
    contentType = "application/json";
  }
  const bytes = body.byteLength;
  const storageKey = buildBackupKey(userId, new Date(), format);

  if (isStorageConfigured()) {
    const { url } = await storagePresignPut(storageKey, contentType);
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: body as unknown as BodyInit });
    if (!res.ok) throw new Error(`Backup upload failed (${res.status})`);
  }

  const inserted = await database.insert(backups).values({ userId, storageKey, bytes, itemCount, trigger, format, mediaCount, skippedCount, remoteStatus: null, remoteError: null });
  const id = Number(inserted[0].insertId);
  if (!isStorageConfigured() && format === "json") inlinePayloads.set(id, body.toString("utf8"));

  // P10/P13: off-site copies to every enabled target in parallel (best-effort; failures queue for retry).
  const remote = await copyToTargets(userId, id, storageKey.split("/").pop()!, body, contentType);
  if (remote.status) await database.update(backups).set({ remoteStatus: remote.status, remoteError: remote.error ?? null }).where(eq(backups.id, id));

  // Retention: keep the newest BACKUP_KEEP rows.
  const old = await database
    .select({ id: backups.id })
    .from(backups)
    .where(eq(backups.userId, userId))
    .orderBy(desc(backups.createdAt))
    .offset(BACKUP_KEEP)
    .limit(100);
  if (old.length) {
    await database.delete(backups).where(inArray(backups.id, old.map((o) => o.id)));
    for (const o of old) inlinePayloads.delete(o.id);
  }

  let delivered = false;
  if (opts.notify !== false && user.email) {
    const downloadUrl = isStorageConfigured() ? await storageGetSignedUrl(storageKey).catch(() => undefined) : undefined;
    const mail = await sendMail({ to: user.email, ...backupEmail({ name: user.name, itemCount, bytes, downloadUrl, zh: opts.zh ?? true }) });
    delivered = mail.delivered;
  }
  return { id, bytes, itemCount, storageKey, format, mediaCount, skippedCount, delivered, remoteStatus: remote.status, remoteError: remote.error, remoteOutcomes: remote.outcomes };
}

/** Users with autoBackup=true whose newest backup is older than a week (or absent). */
export async function findDueBackupUsers(now = new Date()): Promise<number[]> {
  const database = await requireDatabase();
  const optedIn = await database.select({ userId: userPreferences.userId }).from(userPreferences).where(eq(userPreferences.autoBackup, true));
  if (optedIn.length === 0) return [];
  const ids = optedIn.map((r) => r.userId);
  const recent = await database
    .select({ userId: backups.userId, last: sql<Date>`max(${backups.createdAt})` })
    .from(backups)
    .where(and(inArray(backups.userId, ids), gte(backups.createdAt, new Date(now.getTime() - BACKUP_INTERVAL_MS))))
    .groupBy(backups.userId);
  const fresh = new Set(recent.map((r) => r.userId));
  return ids.filter((id) => !fresh.has(id));
}

export async function runScheduledBackups(): Promise<{ ran: number; failed: number }> {
  const due = await findDueBackupUsers();
  let ran = 0;
  let failed = 0;
  for (const userId of due) {
    try {
      await runBackup(userId, "scheduled");
      ran += 1;
    } catch (error) {
      failed += 1;
      console.error(`[backup] scheduled backup failed for user ${userId}`, error);
    }
  }
  if (ran || failed) console.log(`[backup] scheduled run on ${hostname()}: ${ran} ok, ${failed} failed`);
  return { ran, failed };
}

let schedulerTimer: NodeJS.Timeout | null = null;
/**
 * Hourly tick. P10: leader-only + locked (`runIfLeader`) so a multi-instance
 * deployment runs each pass exactly once; without Redis every instance is its
 * own leader (single-instance behaviour unchanged).
 */
export function startBackupScheduler(intervalMs = 60 * 60 * 1000): void {
  if (process.env.BACKUP_SCHEDULER === "0" || schedulerTimer) return;
  const tick = () => void runIfLeader("scheduled-backups", 50 * 60 * 1000, () => runScheduledBackups()).catch((e) => console.error("[backup] scheduler tick failed", e));
  schedulerTimer = setInterval(tick, intervalMs);
  schedulerTimer.unref?.();
  // First run shortly after boot so a restarted server catches up.
  setTimeout(tick, 15_000).unref?.();
}

export function stopBackupScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

export async function pruneOldBackups(days = 90): Promise<number> {
  const database = await requireDatabase();
  const result = await database.delete(backups).where(lt(backups.createdAt, new Date(Date.now() - days * 86_400_000)));
  return Number((result[0] as { affectedRows?: number }).affectedRows ?? 0);
}
