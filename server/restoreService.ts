/**
 * P11 — restore / import from a backup.
 *
 * Accepts either artefact produced by backupService:
 *   • zip   manifest.json + media/{album}/{id}_{title}.ext   → albums + media rows + files re-uploaded
 *   • json  metadata-only export                             → albums + media rows (files referenced by
 *                                                              `downloadUrl` are fetched if still valid)
 *
 * Rules
 *   - Everything lands in the *target family* chosen by the caller (must be editor+).
 *   - Albums are matched by name inside that family; missing ones are created.
 *   - A media item is skipped when the same (albumName, originalId) was already
 *     restored (idempotent re-runs) — tracked via a `restoredFrom:<id>` marker in
 *     `media.description` tail, which keeps the schema unchanged.
 *   - Files are re-uploaded to fresh private keys; without object storage the
 *     rows are still created with the original URL when it is absolute.
 *   - Dry-run returns the plan (counts) without writing.
 *   - P13: `RestoreOptions.albumConflict` (merge | copy | skip) decides what happens
 *     when an album of the same name exists; `dedupeByHash` skips items whose
 *     sha256 is already in the family. The plan carries a per-album diff.
 */
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { albums, media } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { buildMediaKey, isStorageConfigured, sanitizeFileName, storageDelete, storagePresignPut, storageProxyPath, StorageUnsupportedError } from "@/server/storage";

export const RESTORE_MAX_ARCHIVE_BYTES = Number(process.env.RESTORE_MAX_ARCHIVE_BYTES ?? 2 * 1024 * 1024 * 1024);
export const RESTORE_MAX_ITEMS = 5000;

export interface ManifestItem {
  id: number;
  type: "photo" | "video";
  title: string | null;
  description: string | null;
  albumId: number | null;
  albumName: string | null;
  fileSize: number | null;
  duration: number | null;
  createdAt: string;
  /** zip only — relative path inside the archive */
  file?: string | null;
  /** json export only — signed link (15 min) */
  downloadUrl?: string;
  /** P13: sha256 of the original bytes (zip backups ≥ P13). */
  contentHash?: string | null;
}

export interface Manifest {
  exportedAt: string;
  user?: { id: number; email: string | null; name: string | null };
  count: number;
  items: ManifestItem[];
  skipped?: Array<{ id: number; reason: string }>;
}

/** P13: what to do when an album with the same name already exists in the family. */
export const ALBUM_CONFLICT_STRATEGIES = ["merge", "copy", "skip"] as const;
export type AlbumConflictStrategy = (typeof ALBUM_CONFLICT_STRATEGIES)[number];

export interface RestoreOptions {
  /** merge = add into the existing album (default) · copy = create "<name> (恢复副本)" · skip = leave those items out */
  albumConflict: AlbumConflictStrategy;
  /** Skip items whose sha256 already exists in the family (needs hashes in the manifest or bytes to hash). */
  dedupeByHash: boolean;
}

export const DEFAULT_RESTORE_OPTIONS: RestoreOptions = { albumConflict: "merge", dedupeByHash: true };

export function parseRestoreOptions(raw: string | null | undefined | Partial<RestoreOptions>): RestoreOptions {
  let v: Partial<RestoreOptions> = {};
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw) as Partial<RestoreOptions>;
    } catch {
      v = {};
    }
  } else if (raw) v = raw;
  return {
    albumConflict: ALBUM_CONFLICT_STRATEGIES.includes(v.albumConflict as AlbumConflictStrategy) ? (v.albumConflict as AlbumConflictStrategy) : DEFAULT_RESTORE_OPTIONS.albumConflict,
    dedupeByHash: v.dedupeByHash ?? DEFAULT_RESTORE_OPTIONS.dedupeByHash,
  };
}

export const COPY_SUFFIX = " (恢复副本)";

/** The album name items will actually land in under the chosen strategy (null = skipped). */
export function resolveAlbumName(name: string, exists: boolean, strategy: AlbumConflictStrategy): string | null {
  if (!exists) return name;
  if (strategy === "merge") return name;
  if (strategy === "copy") return `${name}${COPY_SUFFIX}`;
  return null;
}

export interface RestorePlanAlbum {
  name: string;
  items: number;
  exists: boolean;
  /** P13 diff: items in the backup that already exist in the album (by marker or hash) */
  duplicate: number;
  /** items the strategy will actually import */
  willImport: number;
  /** album the items will land in; null = skipped by strategy */
  targetName: string | null;
  action: "create" | "merge" | "copy" | "skip";
  /** P13 diff: how many items the existing album currently holds */
  existingItems: number;
}

export interface RestorePlan {
  format: "zip" | "json";
  exportedAt: string | null;
  totalItems: number;
  albums: RestorePlanAlbum[];
  withFiles: number;
  withoutFiles: number;
  alreadyRestored: number;
  /** P13 */
  duplicateByHash: number;
  skippedByStrategy: number;
  willImport: number;
  options: RestoreOptions;
}

export interface RestoreResult extends RestorePlan {
  albumsCreated: number;
  mediaCreated: number;
  filesUploaded: number;
  skipped: Array<{ id: number; reason: string }>;
  /** P14: what this run created — persisted on the job so it can be undone */
  created: { mediaIds: number[]; albumIds: number[] };
  /** P15: object keys this run uploaded (deleted again on undo). */
  uploadedKeys: string[];
}

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const MARK = (id: number) => `restoredFrom:${id}`;

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

/** Detect + parse the artefact. Throws on anything that is not one of ours. */
export function parseBackupArtefact(buf: Buffer): { format: "zip" | "json"; manifest: Manifest; zip: AdmZip | null } {
  if (buf.byteLength > RESTORE_MAX_ARCHIVE_BYTES) throw new Error("Archive exceeds the restore size limit");
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    const zip = new AdmZip(buf);
    const entry = zip.getEntry("manifest.json");
    if (!entry) throw new Error("Not a Golden Memory backup: manifest.json missing");
    const manifest = JSON.parse(entry.getData().toString("utf8")) as Manifest;
    validateManifest(manifest);
    return { format: "zip", manifest, zip };
  }
  let json: Manifest;
  try {
    json = JSON.parse(buf.toString("utf8")) as Manifest;
  } catch {
    throw new Error("File is neither a zip archive nor a JSON export");
  }
  validateManifest(json);
  return { format: "json", manifest: json, zip: null };
}

function validateManifest(m: Manifest) {
  if (!m || !Array.isArray(m.items)) throw new Error("Malformed manifest: items[] missing");
  if (m.items.length > RESTORE_MAX_ITEMS) throw new Error(`Manifest has too many items (> ${RESTORE_MAX_ITEMS})`);
  for (const it of m.items) {
    if (typeof it.id !== "number" || (it.type !== "photo" && it.type !== "video")) throw new Error(`Malformed manifest item ${JSON.stringify(it).slice(0, 80)}`);
  }
}

/** Entry names must stay inside media/ — no traversal, no absolute paths. */
export function isSafeEntryName(name: string): boolean {
  return /^media\/[^/]+\/[^/]+$/.test(name) && !name.includes("..") && !name.includes("\\");
}

/** P13: sha256 → count already present in the family (only rows that carry a hash). */
async function loadFamilyHashes(familyId: number): Promise<Set<string>> {
  const database = await requireDatabase();
  const rows = await database.select({ h: media.contentHash }).from(media).where(and(eq(media.familyId, familyId), like(media.contentHash, "%")));
  return new Set(rows.map((r) => r.h).filter((h): h is string => !!h));
}

async function loadRestoredIds(familyId: number): Promise<Set<number>> {
  const database = await requireDatabase();
  const rows = await database.select({ description: media.description }).from(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")));
  const out = new Set<number>();
  for (const r of rows) {
    const m = /restoredFrom:(\d+)/.exec(r.description ?? "");
    if (m) out.add(Number(m[1]));
  }
  return out;
}

/** P12: narrow a manifest to the chosen album names (null = all). */
export function filterManifestAlbums(parsed: ReturnType<typeof parseBackupArtefact>, albumsFilter: string[] | null | undefined): ReturnType<typeof parseBackupArtefact> {
  if (!albumsFilter || albumsFilter.length === 0) return parsed;
  const want = new Set(albumsFilter.map((a) => a.trim()));
  const items = parsed.manifest.items.filter((it) => want.has(it.albumName?.trim() || "已恢复的照片"));
  return { ...parsed, manifest: { ...parsed.manifest, items, count: items.length } };
}

/** P14: narrow a manifest to specific item ids (null / empty = all). */
export function filterManifestItems(parsed: ReturnType<typeof parseBackupArtefact>, ids: number[] | null | undefined): ReturnType<typeof parseBackupArtefact> {
  if (!ids || ids.length === 0) return parsed;
  const want = new Set(ids);
  const items = parsed.manifest.items.filter((it) => want.has(it.id));
  return { ...parsed, manifest: { ...parsed.manifest, items, count: items.length } };
}

export interface RestorePreviewItem {
  id: number;
  type: "photo" | "video";
  title: string | null;
  albumName: string;
  createdAt: string;
  fileSize: number | null;
  hasFile: boolean;
  /** why this item would be skipped under the current options (null = will import) */
  skipReason: "already_restored" | "duplicate_hash" | "album_skipped" | null;
  /** the existing media row it collides with (by restoredFrom marker or hash), for side-by-side thumbnails */
  existing: { id: number; thumbnailUrl: string | null; url: string | null; title: string | null; albumName: string | null } | null;
  /** data: URL of a tiny JPEG thumbnail from the zip entry (P14 preview), when available */
  previewDataUrl: string | null;
}

const PREVIEW_MAX_BYTES = 180 * 1024;

/**
 * P14: per-item diff used by the visual restore preview — backup item on the
 * left, matching existing item (if any) on the right. Zip photos ≤ 180 KB are
 * inlined as data URLs so the client can show them without a round-trip.
 */
export async function previewRestoreItems(familyId: number, parsed: ReturnType<typeof parseBackupArtefact>, optsIn?: Partial<RestoreOptions> | null, limit = 400): Promise<RestorePreviewItem[]> {
  const options = parseRestoreOptions(optsIn ?? null);
  const database = await requireDatabase();
  const plan = await planRestore(familyId, parsed, options);
  const albumAction = new Map(plan.albums.map((a) => [a.name, a]));
  const existingRows = await database
    .select({ id: media.id, thumbnail: media.thumbnail, url: media.url, title: media.title, description: media.description, contentHash: media.contentHash, albumName: albums.name })
    .from(media)
    .leftJoin(albums, eq(albums.id, media.albumId))
    .where(eq(media.familyId, familyId));
  const byRestoredId = new Map<number, (typeof existingRows)[number]>();
  const byHash = new Map<string, (typeof existingRows)[number]>();
  for (const r of existingRows) {
    const m = /restoredFrom:(\d+)/.exec(r.description ?? "");
    if (m) byRestoredId.set(Number(m[1]), r);
    if (r.contentHash && !byHash.has(r.contentHash)) byHash.set(r.contentHash, r);
  }
  const out: RestorePreviewItem[] = [];
  for (const it of parsed.manifest.items.slice(0, limit)) {
    const albumName = it.albumName?.trim() || "已恢复的照片";
    const action = albumAction.get(albumName);
    const merging = action?.exists && action.action === "merge";
    const hit = byRestoredId.get(it.id) ?? (it.contentHash ? byHash.get(it.contentHash) : undefined) ?? null;
    let skipReason: RestorePreviewItem["skipReason"] = null;
    if (action?.action === "skip") skipReason = "album_skipped";
    else if (merging && byRestoredId.has(it.id)) skipReason = "already_restored";
    else if (merging && options.dedupeByHash && it.contentHash && byHash.has(it.contentHash)) skipReason = "duplicate_hash";
    let previewDataUrl: string | null = null;
    const hasFile = parsed.format === "zip" ? !!it.file && !!parsed.zip?.getEntry(it.file) : !!it.downloadUrl;
    if (parsed.format === "zip" && it.type === "photo" && it.file && isSafeEntryName(it.file)) {
      const entry = parsed.zip!.getEntry(it.file);
      const size = entry?.header.size ?? 0;
      if (entry && size > 0 && size <= PREVIEW_MAX_BYTES) previewDataUrl = `data:${guessContentType(it.file, "photo")};base64,${entry.getData().toString("base64")}`;
    }
    out.push({
      id: it.id,
      type: it.type,
      title: it.title,
      albumName,
      createdAt: it.createdAt,
      fileSize: it.fileSize,
      hasFile,
      skipReason,
      existing: hit ? { id: hit.id, thumbnailUrl: hit.thumbnail ?? null, url: hit.url, title: hit.title, albumName: hit.albumName } : null,
      previewDataUrl,
    });
  }
  return out;
}

export async function planRestore(familyId: number, parsed: ReturnType<typeof parseBackupArtefact>, optsIn?: Partial<RestoreOptions> | null): Promise<RestorePlan> {
  const options = parseRestoreOptions(optsIn ?? null);
  const database = await requireDatabase();
  const existing = await database.select({ id: albums.id, name: albums.name }).from(albums).where(eq(albums.familyId, familyId));
  const existingNames = new Set(existing.map((a) => a.name));
  const existingCounts = new Map<string, number>();
  if (existing.length) {
    const counts = await database.select({ albumId: media.albumId }).from(media).where(inArray(media.albumId, existing.map((a) => a.id)));
    const byId = new Map<number, number>();
    for (const c of counts) byId.set(c.albumId, (byId.get(c.albumId) ?? 0) + 1);
    for (const a of existing) existingCounts.set(a.name, byId.get(a.id) ?? 0);
  }
  const restored = await loadRestoredIds(familyId);
  const hashes = options.dedupeByHash ? await loadFamilyHashes(familyId) : new Set<string>();
  const byAlbum = new Map<string, { items: number; duplicate: number }>();
  let withFiles = 0;
  let withoutFiles = 0;
  let already = 0;
  let dupHash = 0;
  for (const it of parsed.manifest.items) {
    const name = it.albumName?.trim() || "已恢复的照片";
    const b = byAlbum.get(name) ?? { items: 0, duplicate: 0 };
    b.items += 1;
    const isRestored = restored.has(it.id);
    const isHashDup = !!it.contentHash && hashes.has(it.contentHash);
    if (isRestored) already += 1;
    else if (isHashDup) dupHash += 1;
    if (isRestored || isHashDup) b.duplicate += 1;
    byAlbum.set(name, b);
    const hasFile = parsed.format === "zip" ? !!it.file && !!parsed.zip?.getEntry(it.file) : !!it.downloadUrl;
    if (hasFile) withFiles += 1;
    else withoutFiles += 1;
  }
  let skippedByStrategy = 0;
  const albumsOut: RestorePlanAlbum[] = [...byAlbum.entries()].map(([name, b]) => {
    const exists = existingNames.has(name);
    const targetName = resolveAlbumName(name, exists, options.albumConflict);
    const action: RestorePlanAlbum["action"] = !exists ? "create" : options.albumConflict;
    // Duplicates only matter when merging into the same album; a copy re-imports everything.
    const willImport = targetName === null ? 0 : action === "copy" ? b.items : b.items - b.duplicate;
    if (targetName === null) skippedByStrategy += b.items;
    return { name, items: b.items, exists, duplicate: b.duplicate, willImport, targetName, action, existingItems: existingCounts.get(name) ?? 0 };
  });
  return {
    format: parsed.format,
    exportedAt: parsed.manifest.exportedAt ?? null,
    totalItems: parsed.manifest.items.length,
    albums: albumsOut,
    withFiles,
    withoutFiles,
    alreadyRestored: already,
    duplicateByHash: dupHash,
    skippedByStrategy,
    willImport: albumsOut.reduce((n, a) => n + a.willImport, 0),
    options,
  };
}

async function uploadBuffer(key: string, body: Buffer, contentType: string) {
  const { url } = await storagePresignPut(key, contentType);
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: body as unknown as BodyInit });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

const guessContentType = (name: string, type: "photo" | "video") => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm" };
  return map[ext] ?? (type === "video" ? "video/mp4" : "image/jpeg");
};

export async function runRestore(opts: { userId: number; familyId: number; parsed: ReturnType<typeof parseBackupArtefact>; options?: Partial<RestoreOptions> | null; onProgress?: (done: number, total: number) => void }): Promise<RestoreResult> {
  const { userId, familyId, parsed } = opts;
  const database = await requireDatabase();
  const plan = await planRestore(familyId, parsed, opts.options ?? null);
  const options = plan.options;
  const restored = await loadRestoredIds(familyId);
  const hashes = options.dedupeByHash ? await loadFamilyHashes(familyId) : new Set<string>();

  // Albums: resolve per strategy — merge reuses by name, copy creates "<name> (恢复副本)", skip drops the items.
  const existing = await database.select({ id: albums.id, name: albums.name }).from(albums).where(eq(albums.familyId, familyId));
  const albumIdByName = new Map(existing.map((a) => [a.name, a.id]));
  const targetByAlbum = new Map<string, string | null>();
  const createdAlbumIds: number[] = [];
  const createdMediaIds: number[] = [];
  const uploadedKeys: string[] = [];
  let albumsCreated = 0;
  for (const a of plan.albums) {
    targetByAlbum.set(a.name, a.targetName);
    if (a.targetName === null || albumIdByName.has(a.targetName)) continue;
    const ins = await database.insert(albums).values({ familyId, name: a.targetName, description: `从备份恢复 · ${plan.exportedAt?.slice(0, 10) ?? ""}`.trim(), createdBy: userId, isPrivate: false, category: "restored" });
    albumIdByName.set(a.targetName, Number(ins[0].insertId));
    createdAlbumIds.push(Number(ins[0].insertId));
    albumsCreated += 1;
  }

  let mediaCreated = 0;
  let filesUploaded = 0;
  const skipped: Array<{ id: number; reason: string }> = [];
  const total = parsed.manifest.items.length;
  let done = 0;

  for (const it of parsed.manifest.items) {
    done += 1;
    opts.onProgress?.(done, total);
    const albumName = it.albumName?.trim() || "已恢复的照片";
    const targetName = targetByAlbum.get(albumName) ?? null;
    if (targetName === null) {
      skipped.push({ id: it.id, reason: "album_skipped" });
      continue;
    }
    const mergingIntoExisting = targetName === albumName && plan.albums.find((a) => a.name === albumName)?.exists;
    if (mergingIntoExisting && restored.has(it.id)) {
      skipped.push({ id: it.id, reason: "already_restored" });
      continue;
    }
    if (mergingIntoExisting && options.dedupeByHash && it.contentHash && hashes.has(it.contentHash)) {
      skipped.push({ id: it.id, reason: "duplicate_hash" });
      continue;
    }
    const albumId = albumIdByName.get(targetName)!;

    // Obtain the bytes (zip entry or signed link), if any.
    let bytes: Buffer | null = null;
    let fileName = `${it.id}_${sanitizeFileName(it.title ?? it.type)}.${it.type === "video" ? "mp4" : "jpg"}`;
    try {
      if (parsed.format === "zip" && it.file) {
        if (!isSafeEntryName(it.file)) throw new Error("unsafe_entry");
        const entry = parsed.zip!.getEntry(it.file);
        if (entry) {
          bytes = entry.getData();
          fileName = it.file.split("/").pop() ?? fileName;
        }
      } else if (it.downloadUrl && /^https?:\/\//.test(it.downloadUrl)) {
        const res = await fetch(it.downloadUrl);
        if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
      }
    } catch (error) {
      skipped.push({ id: it.id, reason: `file:${error instanceof Error ? error.message : "read_failed"}`.slice(0, 80) });
    }

    // P13: hash the bytes we actually have; dedupe against the family when merging.
    const contentHash = bytes ? sha256(bytes) : (it.contentHash ?? null);
    if (mergingIntoExisting && options.dedupeByHash && contentHash && hashes.has(contentHash)) {
      skipped.push({ id: it.id, reason: "duplicate_hash" });
      continue;
    }
    if (contentHash) hashes.add(contentHash);

    let url: string | null = null;
    let storageKey: string | null = null;
    if (bytes && isStorageConfigured()) {
      try {
        const uploadId = crypto.randomUUID();
        storageKey = buildMediaKey(familyId, albumId, uploadId, fileName);
        await uploadBuffer(storageKey, bytes, guessContentType(fileName, it.type));
        url = storageProxyPath(storageKey);
        uploadedKeys.push(storageKey);
        filesUploaded += 1;
      } catch (error) {
        skipped.push({ id: it.id, reason: `upload:${error instanceof Error ? error.message : "failed"}`.slice(0, 80) });
        storageKey = null;
      }
    }
    if (!url) {
      // No storage or no bytes: keep an absolute original link if the export had one, else record metadata only.
      if (it.downloadUrl && /^https?:\/\//.test(it.downloadUrl) && !bytes) url = it.downloadUrl;
      else if (!bytes) skipped.push({ id: it.id, reason: "no_file" });
      if (!url) url = "about:blank#restored-metadata-only";
    }

    const created = new Date(it.createdAt);
    const insMedia = await database.insert(media).values({
      albumId,
      familyId,
      uploadedBy: userId,
      type: it.type,
      url,
      thumbnail: it.type === "photo" ? url : null,
      storageKey,
      title: it.title,
      description: [it.description?.trim(), MARK(it.id)].filter(Boolean).join("\n"),
      duration: it.duration,
      fileSize: bytes?.byteLength ?? it.fileSize,
      contentHash,
      createdAt: Number.isNaN(created.getTime()) ? new Date() : created,
    });
    createdMediaIds.push(Number(insMedia[0].insertId));
    mediaCreated += 1;
  }

  return { ...plan, albumsCreated, mediaCreated, filesUploaded, skipped, created: { mediaIds: createdMediaIds, albumIds: createdAlbumIds }, uploadedKeys };
}

/**
 * P14: roll back one restore run — delete the media rows (and their uploaded
 * objects' DB references) and the albums it created, provided the albums are
 * still empty of other content. Returns counts.
 */
export async function undoRestoreCreated(familyId: number, created: { mediaIds: number[]; albumIds: number[] }, uploadedKeys: string[] = []): Promise<{ mediaDeleted: number; albumsDeleted: number; albumsKept: number; objectsDeleted: number; objectsFailed: number; objectsUnsupported: boolean }> {
  const database = await requireDatabase();
  // P15: storage objects this run uploaded — only keys still owned by the rows we are about to delete
  const objects = await deleteStorageKeys(uploadedKeys.filter((k) => k.startsWith(`families/${familyId}/`)));
  let mediaDeleted = 0;
  if (created.mediaIds.length) {
    const r = await database.delete(media).where(and(eq(media.familyId, familyId), inArray(media.id, created.mediaIds)));
    mediaDeleted = Number((r[0] as { affectedRows?: number }).affectedRows ?? 0);
  }
  let albumsDeleted = 0;
  let albumsKept = 0;
  for (const albumId of created.albumIds) {
    const [left] = await database.select({ id: media.id }).from(media).where(eq(media.albumId, albumId)).limit(1);
    if (left) {
      albumsKept += 1;
      continue;
    }
    const r = await database.delete(albums).where(and(eq(albums.id, albumId), eq(albums.familyId, familyId)));
    albumsDeleted += Number((r[0] as { affectedRows?: number }).affectedRows ?? 0);
  }
  return { mediaDeleted, albumsDeleted, albumsKept, objectsDeleted: objects.deleted, objectsFailed: objects.failed, objectsUnsupported: objects.unsupported };
}

/** P15: best-effort delete of object keys; tolerates a backend without delete. */
export async function deleteStorageKeys(keys: string[], concurrency = 4): Promise<{ deleted: number; failed: number; unsupported: boolean }> {
  const out = { deleted: 0, failed: 0, unsupported: false };
  if (!keys.length || !isStorageConfigured()) return out;
  const queue = [...new Set(keys)];
  const worker = async () => {
    while (queue.length && !out.unsupported) {
      const k = queue.shift()!;
      try {
        await storageDelete(k);
        out.deleted += 1;
      } catch (e) {
        if (e instanceof StorageUnsupportedError) {
          out.unsupported = true;
          out.failed += 1 + queue.length;
          queue.length = 0;
          return;
        }
        out.failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}

/* ------------------------------------------------------------------ */
/* P12 — background restore jobs                                       */
/* ------------------------------------------------------------------ */

import { and as andOp, desc as descOp, eq as eqOp, inArray as inArrayOp, isNull as isNullOp, lt as ltOp } from "drizzle-orm";
import { hostname } from "node:os";

import { backups, restoreJobs, type RestoreJobRow } from "@/drizzle/schema";
import { recordMetric } from "@/server/_core/metrics";
import { downloadFromTarget } from "@/server/_core/remoteTargets";
import { __inlineBackupPayload, loadBackupTarget, loadBackupTargetById, resolveTarget } from "@/server/backupService";
import { parseStorageKey, storageGetSignedUrl } from "@/server/storage";

export const RESTORE_WORKER_ID = `${hostname()}:${process.pid}`;
export const RESTORE_STALE_MS = Number(process.env.RESTORE_STALE_MS ?? 30 * 60 * 1000);

export interface RestoreSource {
  backupId?: number | null;
  importKey?: string | null;
  remoteKey?: string | null;
  /** P13: which cloud target `remoteKey` belongs to */
  targetId?: number | null;
}

/** Fetch the artefact bytes for any of the three sources (owner-checked). */
export async function loadRestoreArtefact(userId: number, src: RestoreSource): Promise<Buffer> {
  const database = await requireDatabase();
  if (src.backupId) {
    const [row] = await database.select().from(backups).where(andOp(eqOp(backups.id, src.backupId), eqOp(backups.userId, userId))).limit(1);
    if (!row) throw new Error("Backup not found");
    if (isStorageConfigured()) {
      const res = await fetch(await storageGetSignedUrl(row.storageKey));
      if (!res.ok) throw new Error(`Could not download backup (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }
    const inline = __inlineBackupPayload(row.id);
    if (!inline) throw new Error("Backup payload is no longer available on this instance");
    return Buffer.from(inline, "utf8");
  }
  if (src.importKey) {
    const parsed = parseStorageKey(src.importKey);
    if (parsed.kind !== "backup" || parsed.userId !== userId) throw new Error("Import key does not belong to you");
    if (!isStorageConfigured()) throw new Error("Storage is not configured");
    const res = await fetch(await storageGetSignedUrl(src.importKey));
    if (!res.ok) throw new Error("Uploaded file not found — upload it again");
    return Buffer.from(await res.arrayBuffer());
  }
  if (src.remoteKey) {
    const t = src.targetId ? await loadBackupTargetById(userId, src.targetId) : await loadBackupTarget(userId);
    if (!t) throw new Error("No cloud target configured");
    return downloadFromTarget(resolveTarget(t), src.remoteKey);
  }
  throw new Error("Provide backupId, importKey or remoteKey");
}

export function toPublicRestoreJob(row: RestoreJobRow) {
  return {
    id: row.id,
    familyId: row.familyId,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    albums: row.albums ? (JSON.parse(row.albums) as string[]) : null,
    options: parseRestoreOptions(row.options),
    items: row.items ? (JSON.parse(row.items) as number[]) : null,
    canUndo: row.status === "completed" && !!row.created && !row.undoneAt,
    undoneAt: row.undoneAt,
    source: row.backupId ? `backup:${row.backupId}` : row.importKey ? "import" : row.remoteKey ? "cloud" : "?",
    result: row.result ? (JSON.parse(row.result) as RestoreResult) : null,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function enqueueRestore(input: { userId: number; familyId: number; source: RestoreSource; albums?: string[] | null; options?: Partial<RestoreOptions> | null; items?: number[] | null }): Promise<string> {
  const database = await requireDatabase();
  const id = crypto.randomUUID();
  await database.insert(restoreJobs).values({
    id,
    userId: input.userId,
    familyId: input.familyId,
    backupId: input.source.backupId ?? null,
    importKey: input.source.importKey ?? null,
    remoteKey: input.source.remoteKey ?? null,
    targetId: input.source.targetId ?? null,
    albums: input.albums && input.albums.length ? JSON.stringify(input.albums) : null,
    options: input.options ? JSON.stringify(parseRestoreOptions(input.options)) : null,
    items: input.items && input.items.length ? JSON.stringify(input.items) : null,
  });
  void pumpRestoreQueue();
  return id;
}

let active = 0;
const RESTORE_CONCURRENCY = Math.max(1, Number(process.env.RESTORE_CONCURRENCY ?? 1));

async function claimNextRestore(): Promise<RestoreJobRow | null> {
  const database = await requireDatabase();
  const [cand] = await database.select({ id: restoreJobs.id }).from(restoreJobs).where(andOp(eqOp(restoreJobs.status, "queued"), isNullOp(restoreJobs.workerId))).orderBy(restoreJobs.createdAt).limit(1);
  if (!cand) return null;
  const upd = await database.update(restoreJobs).set({ status: "running", stage: "downloading", workerId: RESTORE_WORKER_ID, progress: 1 }).where(andOp(eqOp(restoreJobs.id, cand.id), eqOp(restoreJobs.status, "queued"), isNullOp(restoreJobs.workerId)));
  if (Number((upd[0] as { affectedRows?: number }).affectedRows ?? 0) !== 1) return null;
  const [row] = await database.select().from(restoreJobs).where(eqOp(restoreJobs.id, cand.id)).limit(1);
  return row ?? null;
}

async function runRestoreJob(row: RestoreJobRow): Promise<void> {
  const database = await requireDatabase();
  const started = Date.now();
  let lastWrite = 0;
  try {
    const buf = await loadRestoreArtefact(row.userId, { backupId: row.backupId, importKey: row.importKey, remoteKey: row.remoteKey, targetId: row.targetId });
    await database.update(restoreJobs).set({ stage: "parsing", progress: 10 }).where(eqOp(restoreJobs.id, row.id));
    const parsed = filterManifestItems(filterManifestAlbums(parseBackupArtefact(buf), row.albums ? (JSON.parse(row.albums) as string[]) : null), row.items ? (JSON.parse(row.items) as number[]) : null);
    await database.update(restoreJobs).set({ stage: "restoring", progress: 15 }).where(eqOp(restoreJobs.id, row.id));
    const result = await runRestore({
      userId: row.userId,
      familyId: row.familyId,
      parsed,
      options: parseRestoreOptions(row.options),
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - lastWrite < 800 && done < total) return;
        lastWrite = now;
        void database.update(restoreJobs).set({ progress: 15 + Math.round((done / Math.max(1, total)) * 83) }).where(eqOp(restoreJobs.id, row.id));
      },
    });
    await database.update(restoreJobs).set({ status: "completed", stage: "done", progress: 100, result: JSON.stringify({ ...result, created: undefined, uploadedKeys: undefined }), created: JSON.stringify(result.created), uploadedKeys: JSON.stringify(result.uploadedKeys) }).where(eqOp(restoreJobs.id, row.id));
    recordMetric("restore", true, { durationMs: Date.now() - started, detail: `${parsed.format}:${result.mediaCreated}` });
  } catch (error) {
    const msg = (error instanceof Error ? error.message : "Restore failed").slice(0, 500);
    await database.update(restoreJobs).set({ status: "failed", stage: "error", error: msg }).where(eqOp(restoreJobs.id, row.id));
    recordMetric("restore", false, { durationMs: Date.now() - started, detail: msg });
  }
}

export async function pumpRestoreQueue(): Promise<void> {
  if (active >= RESTORE_CONCURRENCY) return;
  const database = await getDb();
  if (!database) return;
  while (active < RESTORE_CONCURRENCY) {
    const row = await claimNextRestore();
    if (!row) return;
    active += 1;
    void runRestoreJob(row).finally(() => {
      active -= 1;
      void pumpRestoreQueue();
    });
  }
}

/** Boot / periodic: fail jobs this worker abandoned, requeue stale ones, prune old, pump. */
export async function reapRestoreJobs(): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.update(restoreJobs).set({ status: "failed", stage: "error", error: "Interrupted by server restart — start the restore again", workerId: null }).where(andOp(eqOp(restoreJobs.status, "running"), eqOp(restoreJobs.workerId, RESTORE_WORKER_ID)));
  await database.update(restoreJobs).set({ status: "queued", stage: "requeued", workerId: null, progress: 0 }).where(andOp(eqOp(restoreJobs.status, "running"), ltOp(restoreJobs.updatedAt, new Date(Date.now() - RESTORE_STALE_MS))));
  await database.delete(restoreJobs).where(andOp(inArrayOp(restoreJobs.status, ["completed", "failed"]), ltOp(restoreJobs.createdAt, new Date(Date.now() - 30 * 86_400_000))));
  void pumpRestoreQueue();
}

let restoreTimer: NodeJS.Timeout | null = null;
export function startRestoreWorker(): void {
  if (restoreTimer) return;
  restoreTimer = setInterval(() => void reapRestoreJobs().catch(() => undefined), 5 * 60 * 1000);
  restoreTimer.unref?.();
  const poll = setInterval(() => void pumpRestoreQueue().catch(() => undefined), 10_000);
  poll.unref?.();
}

/** P14: undo a completed restore job (owner only). */
export async function undoRestoreJob(userId: number, jobId: string): Promise<Awaited<ReturnType<typeof undoRestoreCreated>>> {
  const database = await requireDatabase();
  const [row] = await database.select().from(restoreJobs).where(andOp(eqOp(restoreJobs.id, jobId), eqOp(restoreJobs.userId, userId))).limit(1);
  if (!row) throw new Error("Restore job not found");
  if (row.status !== "completed" || !row.created) throw new Error("Only completed restores can be undone");
  if (row.undoneAt) throw new Error("Already undone");
  const created = JSON.parse(row.created) as { mediaIds: number[]; albumIds: number[] };
  const uploadedKeys = row.uploadedKeys ? (JSON.parse(row.uploadedKeys) as string[]) : [];
  const r = await undoRestoreCreated(row.familyId, created, uploadedKeys);
  await database.update(restoreJobs).set({ undoneAt: new Date(), stage: "undone" }).where(eqOp(restoreJobs.id, row.id));
  recordMetric("restore", true, { detail: `undo:${r.mediaDeleted}:obj${r.objectsDeleted}` });
  return r;
}

export async function listRestoreJobs(userId: number, take = 10) {
  const database = await requireDatabase();
  const rows = await database.select().from(restoreJobs).where(eqOp(restoreJobs.userId, userId)).orderBy(descOp(restoreJobs.createdAt)).limit(take);
  return rows.map(toPublicRestoreJob);
}

export async function getRestoreJob(userId: number, id: string) {
  const database = await requireDatabase();
  const [row] = await database.select().from(restoreJobs).where(andOp(eqOp(restoreJobs.id, id), eqOp(restoreJobs.userId, userId))).limit(1);
  return row ? toPublicRestoreJob(row) : null;
}
