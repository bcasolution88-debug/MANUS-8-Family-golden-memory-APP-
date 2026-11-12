/**
 * P15 — orphan sweep for object storage.
 *
 *   Lists `families/{id}/…` objects and diffs them against every key the
 *   database still references (media.storageKey / thumbnailKey, backups,
 *   restore uploads still pending). Anything unreferenced and older than
 *   ORPHAN_MIN_AGE_HOURS (so in-flight uploads are not caught) is an orphan.
 *   Scans are persisted in `storageOrphanScans`; an admin reviews the list and
 *   purges it (deletes are best-effort, a backend without delete keeps the row
 *   with `error`).
 *
 *   `diffOrphans` is pure and exported for tests.
 */
import { desc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { backups, media, restoreJobs, storageOrphanScans } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { isStorageConfigured, storageList, StorageUnsupportedError, type StorageObject } from "@/server/storage";
import { deleteStorageKeys } from "@/server/restoreService";

export const ORPHAN_MIN_AGE_HOURS = Math.max(0, Number(process.env.ORPHAN_MIN_AGE_HOURS ?? 24));
export const ORPHAN_LIST_CAP = 5000;

/** Pure: objects that no referenced key matches and are old enough. */
export function diffOrphans(objects: StorageObject[], referenced: Set<string>, now = new Date(), minAgeHours = ORPHAN_MIN_AGE_HOURS): StorageObject[] {
  const cutoff = now.getTime() - minAgeHours * 3_600_000;
  return objects.filter((o) => !referenced.has(o.key) && (o.modifiedAt == null || o.modifiedAt.getTime() <= cutoff));
}

/** Pure: the family id encoded in a media key, or null. */
export function familyOfKey(key: string): number | null {
  const m = /^families\/(\d+)\//.exec(key);
  return m ? Number(m[1]) : null;
}

async function referencedKeys(familyId: number | null): Promise<Set<string>> {
  const database = await getDb();
  const set = new Set<string>();
  if (!database) return set;
  const mediaRows = familyId == null ? await database.select({ a: media.storageKey, b: media.thumbnailKey }).from(media).where(or(isNotNull(media.storageKey), isNotNull(media.thumbnailKey))) : await database.select({ a: media.storageKey, b: media.thumbnailKey }).from(media).where(eq(media.familyId, familyId));
  for (const r of mediaRows) {
    if (r.a) set.add(r.a);
    if (r.b) set.add(r.b);
  }
  for (const b of await database.select({ k: backups.storageKey }).from(backups)) set.add(b.k);
  // restore runs still running / queued may have uploaded objects not yet referenced
  for (const j of await database.select({ u: restoreJobs.uploadedKeys }).from(restoreJobs).where(inArray(restoreJobs.status, ["queued", "running"]))) {
    if (j.u) for (const k of JSON.parse(j.u) as string[]) set.add(k);
  }
  return set;
}

export async function scanOrphans(opts: { familyId?: number | null; by?: number | null; now?: Date } = {}): Promise<{ id: number; scanned: number; orphans: number; orphanBytes: number; unsupported: boolean }> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const now = opts.now ?? new Date();
  const familyId = opts.familyId ?? null;
  if (!isStorageConfigured()) {
    const ins = await database.insert(storageOrphanScans).values({ familyId, error: "storage_not_configured", createdBy: opts.by ?? null });
    return { id: Number(ins[0].insertId), scanned: 0, orphans: 0, orphanBytes: 0, unsupported: true };
  }
  let objects: StorageObject[] = [];
  let error: string | null = null;
  try {
    objects = await storageList(familyId == null ? "families/" : `families/${familyId}/`, { max: 50_000 });
  } catch (e) {
    error = e instanceof StorageUnsupportedError ? "storage_list_unsupported" : (e instanceof Error ? e.message : "list_failed").slice(0, 500);
  }
  const referenced = await referencedKeys(familyId);
  const orphans = error ? [] : diffOrphans(objects, referenced, now);
  const orphanBytes = orphans.reduce((n, o) => n + (o.bytes ?? 0), 0);
  const ins = await database.insert(storageOrphanScans).values({
    familyId,
    scanned: objects.length,
    orphans: orphans.length,
    orphanBytes,
    keys: JSON.stringify(orphans.slice(0, ORPHAN_LIST_CAP).map((o) => ({ key: o.key, bytes: o.bytes, modifiedAt: o.modifiedAt?.toISOString() ?? null }))),
    error,
    createdBy: opts.by ?? null,
  });
  return { id: Number(ins[0].insertId), scanned: objects.length, orphans: orphans.length, orphanBytes, unsupported: error === "storage_list_unsupported" };
}

export async function purgeOrphans(scanId: number, opts: { keys?: string[] | null } = {}): Promise<{ deleted: number; failed: number; unsupported: boolean }> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const [scan] = await database.select().from(storageOrphanScans).where(eq(storageOrphanScans.id, scanId)).limit(1);
  if (!scan) throw new Error("Scan not found");
  if (scan.deletedAt) throw new Error("Already purged");
  const listed = scan.keys ? (JSON.parse(scan.keys) as Array<{ key: string }>).map((k) => k.key) : [];
  const want = opts.keys?.length ? listed.filter((k) => opts.keys!.includes(k)) : listed;
  // never delete something that became referenced since the scan
  const referenced = await referencedKeys(scan.familyId ?? null);
  const safe = want.filter((k) => !referenced.has(k));
  const r = await deleteStorageKeys(safe);
  await database.update(storageOrphanScans).set({ deletedCount: r.deleted, deletedAt: new Date(), error: r.unsupported ? "storage_delete_unsupported" : scan.error }).where(eq(storageOrphanScans.id, scanId));
  return r;
}

export async function listOrphanScans(take = 10) {
  const database = await getDb();
  if (!database) return [];
  const rows = await database.select().from(storageOrphanScans).orderBy(desc(storageOrphanScans.createdAt)).limit(take);
  return rows.map((r) => ({ ...r, keys: r.keys ? (JSON.parse(r.keys) as Array<{ key: string; bytes: number | null; modifiedAt: string | null }>).slice(0, 200) : [] }));
}

/* scheduler: weekly scan (leader only), never auto-purges */
let timer: ReturnType<typeof setInterval> | null = null;
export function startOrphanScanScheduler(intervalMs = 7 * 24 * 3_600_000): void {
  if (process.env.ORPHAN_SCAN_SCHEDULER === "0" || timer) return;
  const tick = () =>
    void import("@/server/_core/coordination")
      .then((m) => m.runIfLeader("orphan-scan", 6 * 3_600_000, () => scanOrphans({})))
      .catch((e) => console.error("[orphans] scan failed", e));
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 10 * 60_000).unref?.();
}
export function stopOrphanScanScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
