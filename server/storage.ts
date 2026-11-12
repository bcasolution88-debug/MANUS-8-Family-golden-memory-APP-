// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.
//
// P3 — private object model:
//   * The bucket is never public. Every object lives under an ownership prefix
//     (see `buildMediaKey` / `buildVoiceKey`) so the proxy can authorize by key.
//   * DB rows store the *object key* (`media.storageKey`), never a public URL.
//   * Clients fetch a short-lived signed GET URL via `media.getSignedUrl`, or hit
//     `/manus-storage/{key}` which authenticates, authorizes and 307-redirects.

import { ENV } from "./_core/env";

/** Signed GET URLs are valid for this long (seconds). Mirrors Forge default. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export function isStorageConfigured(): boolean {
  return Boolean(ENV.forgeApiUrl && ENV.forgeApiKey);
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

export function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/** Reject traversal / control characters / absurd lengths before touching Forge. */
export function isValidStorageKey(key: string): boolean {
  if (!key || key.length > 512) return false;
  if (key.includes("..") || key.includes("\\") || /[\u0000-\u001f]/.test(key)) return false;
  return /^[A-Za-z0-9._\-/%]+$/.test(key);
}

/** Keep original extension, strip everything that is not URL/S3 safe. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "file").slice(0, 120);
}

/* ------------------------------------------------------------------ */
/* Key layout — the proxy's authorization depends on these prefixes.   */
/* ------------------------------------------------------------------ */

export function buildMediaKey(
  familyId: number,
  albumId: number,
  uploadId: string,
  fileName: string,
): string {
  return `families/${familyId}/albums/${albumId}/${uploadId}/${sanitizeFileName(fileName)}`;
}

export function buildVoiceKey(userId: number, ext = "m4a"): string {
  return `users/${userId}/voice/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
}

/** P7: profile pictures. Readable by any signed-in user (see storageProxy). */
export function buildAvatarKey(userId: number, ext = "jpg"): string {
  return `users/${userId}/avatar/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
}

/** P10: Studio soundtracks uploaded by the user (owner-only via the proxy; the renderer reads via signed URL). */
export function buildMusicKey(userId: number, ext = "mp3"): string {
  return `users/${userId}/music/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp3"}`;
}

export type ParsedStorageKey =
  | { kind: "media"; familyId: number; albumId: number }
  | { kind: "avatar"; userId: number }
  | { kind: "backup"; userId: number }
  | { kind: "music"; userId: number }
  | { kind: "user"; userId: number }
  | { kind: "unknown" };

export function parseStorageKey(key: string): ParsedStorageKey {
  const media = /^families\/(\d+)\/albums\/(\d+)\//.exec(key);
  if (media) return { kind: "media", familyId: Number(media[1]), albumId: Number(media[2]) };
  const avatar = /^users\/(\d+)\/avatar\//.exec(key);
  if (avatar) return { kind: "avatar", userId: Number(avatar[1]) };
  const backup = /^users\/(\d+)\/backups\//.exec(key);
  if (backup) return { kind: "backup", userId: Number(backup[1]) };
  const music = /^users\/(\d+)\/music\//.exec(key);
  if (music) return { kind: "music", userId: Number(music[1]) };
  const user = /^users\/(\d+)\//.exec(key);
  if (user) return { kind: "user", userId: Number(user[1]) };
  return { kind: "unknown" };
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

/* ------------------------------------------------------------------ */
/* Forge calls                                                         */
/* ------------------------------------------------------------------ */

/** Presigned PUT URL for a *specific* key (client uploads directly to S3). */
export async function storagePresignPut(
  relKey: string,
  contentType?: string,
): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);
  if (contentType) presignUrl.searchParams.set("contentType", contentType);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url } = (await presignResp.json()) as { url: string };
  if (!url) throw new Error("Forge returned empty presign URL");
  return { key, url };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const { url: s3Url } = await storagePresignPut(key, contentType);

  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

/** Access-controlled proxy path for a key (what we persist in `media.url`). */
export function storageProxyPath(relKey: string): string {
  return `/manus-storage/${normalizeKey(relKey)}`;
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: storageProxyPath(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}

/* ------------------------------------------------------------------ */
/* P15 — delete + list (orphan sweeps, restore undo)                   */
/* ------------------------------------------------------------------ */

export class StorageUnsupportedError extends Error {
  constructor(op: string) {
    super(`storage_${op}_unsupported`);
    this.name = "StorageUnsupportedError";
  }
}

/**
 * Delete one object. Tries the presigned-DELETE endpoint first, then a direct
 * delete; a 404/405 from both means the backing API has no delete and we
 * surface `StorageUnsupportedError` so callers can degrade (keep the key in
 * the orphan list instead of pretending).
 */
export async function storageDelete(relKey: string): Promise<void> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);
  const presignUrl = new URL("v1/storage/presign/delete", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);
  const presign = await fetch(presignUrl, { headers: { Authorization: `Bearer ${forgeKey}` } });
  if (presign.ok) {
    const { url } = (await presign.json()) as { url: string };
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
    return;
  }
  if (presign.status !== 404 && presign.status !== 405) {
    const msg = await presign.text().catch(() => presign.statusText);
    throw new Error(`Storage delete presign failed (${presign.status}): ${msg}`);
  }
  const direct = new URL("v1/storage/object", forgeUrl + "/");
  direct.searchParams.set("path", key);
  const res = await fetch(direct, { method: "DELETE", headers: { Authorization: `Bearer ${forgeKey}` } });
  if (res.ok || res.status === 204) return;
  if (res.status === 404 || res.status === 405) throw new StorageUnsupportedError("delete");
  throw new Error(`Storage delete failed (${res.status})`);
}

export interface StorageObject {
  key: string;
  bytes: number | null;
  modifiedAt: Date | null;
}

/** List objects under a prefix (paginated). Throws StorageUnsupportedError when the API has no listing. */
export async function storageList(prefix: string, opts: { max?: number } = {}): Promise<StorageObject[]> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const out: StorageObject[] = [];
  let cursor: string | null = null;
  const max = opts.max ?? 10_000;
  do {
    const url = new URL("v1/storage/list", forgeUrl + "/");
    url.searchParams.set("prefix", normalizeKey(prefix));
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${forgeKey}` } });
    if (res.status === 404 || res.status === 405) throw new StorageUnsupportedError("list");
    if (!res.ok) throw new Error(`Storage list failed (${res.status})`);
    const body = (await res.json()) as { objects?: Array<{ key?: string; path?: string; size?: number; bytes?: number; lastModified?: string; modifiedAt?: string }>; cursor?: string | null; nextCursor?: string | null };
    for (const o of body.objects ?? []) {
      const key = o.key ?? o.path;
      if (!key) continue;
      const mod = o.lastModified ?? o.modifiedAt;
      out.push({ key: normalizeKey(key), bytes: o.size ?? o.bytes ?? null, modifiedAt: mod ? new Date(mod) : null });
      if (out.length >= max) return out;
    }
    cursor = body.cursor ?? body.nextCursor ?? null;
  } while (cursor);
  return out;
}
