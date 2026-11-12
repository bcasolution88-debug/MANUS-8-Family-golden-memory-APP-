/**
 * P15 — copy historical backups between cloud targets.
 *
 *   `targetCopyJobs` rows are claimed by a background worker (conditional
 *   UPDATE, like restore jobs). For every source entry: download → sha256 →
 *   upload to the destination (S3 destinations may get a different storage
 *   class) → download back from the destination and compare the hash
 *   (`verifyAfterCopy`, skipped for GLACIER / DEEP_ARCHIVE where immediate
 *   GET is not possible — those are verified by size + ETag only). Progress
 *   (`done / failed / bytes`) is written after every file so the client can
 *   poll; `results` keeps a per-file ledger.
 *
 *   Pure helpers (`planCopyKeys`, `needsDeferredVerify`, `copyJobProgress`) are exported for tests.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { hostname } from "node:os";

import { targetCopyJobs, type BackupTarget, type TargetCopyJobRow } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { recordMetric } from "@/server/_core/metrics";
import { downloadFromTarget, listTarget, S3_STORAGE_CLASSES, uploadToTarget, type RemoteEntry, type ResolvedTarget } from "@/server/_core/remoteTargets";
import { loadBackupTargetById, resolveTarget } from "@/server/backupService";
import { sha256 } from "@/server/restoreService";

export const COPY_WORKER_ID = `${hostname()}:${process.pid}:copy`;
export const COPY_STALE_MS = Number(process.env.COPY_STALE_MS ?? 60 * 60 * 1000);
export const COPY_MAX_FILES = Math.max(1, Number(process.env.COPY_MAX_FILES ?? 500));
const COPY_CONCURRENCY = Math.max(1, Number(process.env.COPY_CONCURRENCY ?? 1));

export interface CopyFileResult {
  key: string;
  name: string;
  ok: boolean;
  bytes: number;
  sha256: string | null;
  verified: boolean | null;
  error?: string;
}

/** Pure: which source entries to copy — our backups only, skipping names already present on the destination (same size). */
export function planCopyKeys(source: RemoteEntry[], dest: RemoteEntry[], wanted: string[] | null | undefined): RemoteEntry[] {
  const destByName = new Map(dest.filter((d) => d.format !== "other").map((d) => [d.name, d]));
  const want = wanted && wanted.length ? new Set(wanted) : null;
  return source
    .filter((e) => e.format !== "other")
    .filter((e) => (want ? want.has(e.key) : true))
    .filter((e) => {
      const d = destByName.get(e.name);
      return !d || (e.bytes != null && d.bytes != null && e.bytes !== d.bytes);
    })
    .sort((a, b) => (a.modifiedAt?.getTime() ?? 0) - (b.modifiedAt?.getTime() ?? 0))
    .slice(0, COPY_MAX_FILES);
}

/** Pure: cold classes cannot be read back right away, so verification is by size only. */
export function needsDeferredVerify(storageClass: string | null | undefined): boolean {
  return storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE";
}

/** Pure: 0–100 for the progress bar. */
export function copyJobProgress(job: Pick<TargetCopyJobRow, "total" | "done" | "failed" | "status">): number {
  if (job.status === "completed") return 100;
  if (job.total <= 0) return job.status === "queued" ? 0 : 1;
  return Math.max(1, Math.min(99, Math.round(((job.done + job.failed) / job.total) * 100)));
}

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export async function enqueueCopy(input: { userId: number; fromTargetId: number; toTargetId: number; keys?: string[] | null; storageClass?: string | null }): Promise<string> {
  const database = await requireDatabase();
  if (input.fromTargetId === input.toTargetId) throw new Error("Source and destination must differ");
  const [from, to] = await Promise.all([loadBackupTargetById(input.userId, input.fromTargetId), loadBackupTargetById(input.userId, input.toTargetId)]);
  if (!from || !to) throw new Error("Target not found");
  if (input.storageClass && (to.kind !== "s3" || !(S3_STORAGE_CLASSES as readonly string[]).includes(input.storageClass))) throw new Error("Storage class only applies to S3 destinations");
  const [running] = await database.select({ id: targetCopyJobs.id }).from(targetCopyJobs).where(and(eq(targetCopyJobs.userId, input.userId), inArray(targetCopyJobs.status, ["queued", "running"]))).limit(1);
  if (running) throw new Error("A copy job is already running");
  const id = randomUUID();
  await database.insert(targetCopyJobs).values({ id, userId: input.userId, fromTargetId: from.id, toTargetId: to.id, keys: input.keys?.length ? JSON.stringify(input.keys) : null, storageClass: input.storageClass ?? null });
  void pumpCopyQueue();
  return id;
}

export async function cancelCopy(userId: number, id: string): Promise<boolean> {
  const database = await requireDatabase();
  const r = await database.update(targetCopyJobs).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(targetCopyJobs.id, id), eq(targetCopyJobs.userId, userId), inArray(targetCopyJobs.status, ["queued", "running"])));
  return Number((r[0] as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

let active = 0;
export async function pumpCopyQueue(): Promise<void> {
  if (active >= COPY_CONCURRENCY) return;
  const database = await getDb();
  if (!database) return;
  const [cand] = await database.select({ id: targetCopyJobs.id }).from(targetCopyJobs).where(and(eq(targetCopyJobs.status, "queued"), isNull(targetCopyJobs.workerId))).orderBy(targetCopyJobs.createdAt).limit(1);
  if (!cand) return;
  const upd = await database.update(targetCopyJobs).set({ status: "running", workerId: COPY_WORKER_ID, startedAt: new Date() }).where(and(eq(targetCopyJobs.id, cand.id), eq(targetCopyJobs.status, "queued"), isNull(targetCopyJobs.workerId)));
  if (Number((upd[0] as { affectedRows?: number }).affectedRows ?? 0) === 0) return pumpCopyQueue();
  active += 1;
  try {
    await runCopyJob(cand.id);
  } finally {
    active -= 1;
    void pumpCopyQueue();
  }
}

async function isCancelled(id: string): Promise<boolean> {
  const database = await requireDatabase();
  const [r] = await database.select({ status: targetCopyJobs.status }).from(targetCopyJobs).where(eq(targetCopyJobs.id, id)).limit(1);
  return r?.status === "cancelled";
}

export async function runCopyJob(id: string): Promise<void> {
  const database = await requireDatabase();
  const [job] = await database.select().from(targetCopyJobs).where(eq(targetCopyJobs.id, id)).limit(1);
  if (!job) return;
  const started = Date.now();
  const results: CopyFileResult[] = [];
  try {
    const [fromRow, toRow] = await Promise.all([loadBackupTargetById(job.userId, job.fromTargetId), loadBackupTargetById(job.userId, job.toTargetId)]);
    if (!fromRow || !toRow) throw new Error("Target no longer exists");
    const from = resolveTarget(fromRow);
    const to: ResolvedTarget = { ...resolveTarget(toRow), storageClass: job.storageClass ?? toRow.storageClass ?? null };
    const [srcEntries, dstEntries] = await Promise.all([listTarget(from), listTarget(to).catch(() => [] as RemoteEntry[])]);
    const plan = planCopyKeys(srcEntries, dstEntries, job.keys ? (JSON.parse(job.keys) as string[]) : null);
    await database.update(targetCopyJobs).set({ total: plan.length }).where(eq(targetCopyJobs.id, id));
    let done = 0;
    let failed = 0;
    let bytes = 0;
    for (const entry of plan) {
      if (await isCancelled(id)) return;
      try {
        const buf = await downloadFromTarget(from, entry.key);
        const hash = sha256(buf);
        const contentType = entry.format === "zip" ? "application/zip" : "application/json";
        await uploadToTarget(to, entry.name, buf, contentType);
        let verified: boolean | null = null;
        if (needsDeferredVerify(to.storageClass)) {
          verified = null; // cold class: trust the PUT (S3 validated the body hash in the signature)
        } else {
          const after = await listTarget(to);
          const match = after.find((e) => e.name === entry.name);
          if (match) {
            try {
              const back = await downloadFromTarget(to, match.key);
              verified = sha256(back) === hash;
            } catch {
              verified = match.bytes == null ? null : match.bytes === buf.byteLength;
            }
          } else verified = false;
          if (verified === false) throw new Error("verification_failed");
        }
        done += 1;
        bytes += buf.byteLength;
        results.push({ key: entry.key, name: entry.name, ok: true, bytes: buf.byteLength, sha256: hash, verified });
      } catch (e) {
        failed += 1;
        results.push({ key: entry.key, name: entry.name, ok: false, bytes: 0, sha256: null, verified: false, error: (e instanceof Error ? e.message : "copy_failed").slice(0, 200) });
      }
      await database.update(targetCopyJobs).set({ done, failed, bytes, results: JSON.stringify(results) }).where(eq(targetCopyJobs.id, id));
    }
    await database.update(targetCopyJobs).set({ status: failed > 0 && done === 0 && plan.length > 0 ? "failed" : "completed", finishedAt: new Date(), error: failed > 0 ? `${failed} file(s) failed` : null }).where(and(eq(targetCopyJobs.id, id), eq(targetCopyJobs.status, "running")));
    recordMetric("backup_remote", failed === 0, { durationMs: Date.now() - started, detail: `copy:${done}/${plan.length}`, userId: job.userId });
  } catch (e) {
    await database.update(targetCopyJobs).set({ status: "failed", finishedAt: new Date(), error: (e instanceof Error ? e.message : "copy_failed").slice(0, 500), results: JSON.stringify(results) }).where(and(eq(targetCopyJobs.id, id), eq(targetCopyJobs.status, "running")));
    recordMetric("backup_remote", false, { durationMs: Date.now() - started, detail: `copy:${e instanceof Error ? e.message : "failed"}`.slice(0, 120), userId: job.userId });
  }
}

export function toPublicCopyJob(row: TargetCopyJobRow) {
  return {
    id: row.id,
    fromTargetId: row.fromTargetId,
    toTargetId: row.toTargetId,
    storageClass: row.storageClass,
    status: row.status,
    total: row.total,
    done: row.done,
    failed: row.failed,
    bytes: row.bytes,
    progress: copyJobProgress(row),
    results: row.results ? (JSON.parse(row.results) as CopyFileResult[]) : [],
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

export async function listCopyJobs(userId: number, take = 10) {
  const database = await requireDatabase();
  const rows = await database.select().from(targetCopyJobs).where(eq(targetCopyJobs.userId, userId)).orderBy(desc(targetCopyJobs.createdAt)).limit(take);
  return rows.map(toPublicCopyJob);
}

export async function getCopyJob(userId: number, id: string) {
  const database = await requireDatabase();
  const [row] = await database.select().from(targetCopyJobs).where(and(eq(targetCopyJobs.id, id), eq(targetCopyJobs.userId, userId))).limit(1);
  return row ? toPublicCopyJob(row) : null;
}

/** Re-queue jobs whose worker went away. */
export async function reapCopyJobs(): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.update(targetCopyJobs).set({ status: "queued", workerId: null }).where(and(eq(targetCopyJobs.status, "running"), lt(targetCopyJobs.updatedAt, new Date(Date.now() - COPY_STALE_MS))));
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startCopyWorker(): void {
  if (process.env.COPY_WORKER === "0" || timer) return;
  timer = setInterval(() => void reapCopyJobs().then(pumpCopyQueue).catch((e) => console.error("[copy] pump failed", e)), 30_000);
  timer.unref?.();
  setTimeout(() => void pumpCopyQueue(), 5_000).unref?.();
}
export function stopCopyWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export type { BackupTarget };
