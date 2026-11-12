/**
 * P11 — off-site backup destinations beyond WebDAV.
 *
 *   s3      any S3-compatible bucket (AWS, MinIO, R2, Backblaze B2, 阿里云 OSS / 腾讯云 COS
 *           的 S3 兼容端点) — SigV4 signed PUT via fetch, no SDK
 *   gdrive  Google Drive — OAuth 2 refresh token → access token → multipart upload
 *           (optionally into a named folder, created on demand)
 *
 * `uploadToTarget()` is the single entry point used by backupService; the
 * WebDAV branch delegates to webdav.ts. Each kind also exposes a `probe` that
 * is run before saving the target so credentials are validated up front.
 */
import { createHash, createHmac } from "node:crypto";

import type { BackupTargetKind } from "@/drizzle/schema";
import { ENV } from "./env";
import { probeWebDav, putFile } from "./webdav";

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

export interface ResolvedTarget {
  /** P14: S3 storage class for new uploads (ignored by other kinds). */
  storageClass?: string | null;
  kind: BackupTargetKind;
  url: string;
  username: string;
  secret: string;
  config: Record<string, unknown>;
}

export type ProbeResult = { ok: true; detail?: string } | { ok: false; error: string };

export function parseTargetConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* S3 (SigV4)                                                          */
/* ------------------------------------------------------------------ */

export interface S3Config {
  bucket: string;
  region: string;
  prefix?: string;
  /** Path-style addressing (MinIO / most self-hosted). Virtual-host style otherwise. */
  pathStyle?: boolean;
}

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encode every path segment (S3 wants '/' kept, everything else encoded). */
function encodeS3Path(p: string): string {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export function normalizeS3Endpoint(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && !(u.protocol === "http:" && !ENV.isProduction)) return null;
    if (u.username || u.password) return null;
    u.pathname = "/";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function s3ObjectUrl(endpoint: string, cfg: S3Config, key: string): { url: URL; host: string; canonicalPath: string } {
  const ep = new URL(endpoint);
  const objectPath = encodeS3Path(key);
  if (cfg.pathStyle) {
    const url = new URL(`${ep.origin}/${encodeURIComponent(cfg.bucket)}/${objectPath}`);
    return { url, host: url.host, canonicalPath: `/${encodeURIComponent(cfg.bucket)}/${objectPath}` };
  }
  const url = new URL(`${ep.protocol}//${cfg.bucket}.${ep.host}/${objectPath}`);
  return { url, host: url.host, canonicalPath: `/${objectPath}` };
}

/**
 * Build SigV4 headers for a single request with a payload hash.
 * Exported for unit tests (deterministic given `now`).
 */
export function signS3Request(opts: {
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  host: string;
  canonicalPath: string;
  region: string;
  accessKey: string;
  secretKey: string;
  payloadHash: string;
  contentType?: string;
  /** Pre-sorted, RFC3986-encoded query string (empty for object PUT/GET). */
  canonicalQuery?: string;
  /** P14: additional signed headers (lower-case names), e.g. x-amz-storage-class. */
  extraHeaders?: Record<string, string>;
  now?: Date;
}): Record<string, string> {
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260101T000000Z
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: opts.host,
    "x-amz-content-sha256": opts.payloadHash,
    "x-amz-date": amzDate,
    ...(opts.contentType ? { "content-type": opts.contentType } : {}),
    ...Object.fromEntries(Object.entries(opts.extraHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]!.trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [opts.method, opts.canonicalPath, opts.canonicalQuery ?? "", canonicalHeaders, signedHeaders, opts.payloadHash].join("\n");
  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${opts.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const { host: _h, ...rest } = headers;
  return {
    ...rest,
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export const S3_STORAGE_CLASSES = ["STANDARD", "STANDARD_IA", "ONEZONE_IA", "GLACIER_IR", "GLACIER", "DEEP_ARCHIVE"] as const;
export type S3StorageClass = (typeof S3_STORAGE_CLASSES)[number];

export async function s3Put(t: ResolvedTarget, key: string, body: Buffer, contentType: string): Promise<string> {
  const cfg = t.config as unknown as S3Config;
  const fullKey = `${(cfg.prefix ?? "").replace(/^\/+|\/+$/g, "")}${cfg.prefix ? "/" : ""}${key}`;
  const { url, host, canonicalPath } = s3ObjectUrl(t.url, cfg, fullKey);
  // P14: cold archive via x-amz-storage-class (signed header).
  const storageClass = t.storageClass && (S3_STORAGE_CLASSES as readonly string[]).includes(t.storageClass) ? t.storageClass : null;
  const headers = signS3Request({ method: "PUT", host, canonicalPath, region: cfg.region, accessKey: t.username, secretKey: t.secret, payloadHash: sha256Hex(body), contentType, extraHeaders: storageClass ? { "x-amz-storage-class": storageClass } : undefined });
  const res = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Length": String(body.byteLength) }, body: body as unknown as BodyInit });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 PUT failed (${res.status}) ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 160)}`);
  }
  return url.toString();
}

/** Write + delete a tiny probe object to prove the key pair can write to the bucket. */
export async function probeS3(t: ResolvedTarget, timeoutMs = 10_000): Promise<ProbeResult> {
  const cfg = t.config as unknown as S3Config;
  if (!cfg.bucket || !cfg.region) return { ok: false, error: "Bucket and region are required" };
  try {
    const probeKey = `.golden-memory-probe-${Date.now()}`;
    const fullKey = `${(cfg.prefix ?? "").replace(/^\/+|\/+$/g, "")}${cfg.prefix ? "/" : ""}${probeKey}`;
    const { url, host, canonicalPath } = s3ObjectUrl(t.url, cfg, fullKey);
    const body = Buffer.from("ok");
    const put = await fetch(url, {
      method: "PUT",
      headers: { ...signS3Request({ method: "PUT", host, canonicalPath, region: cfg.region, accessKey: t.username, secretKey: t.secret, payloadHash: sha256Hex(body), contentType: "text/plain" }), "Content-Length": "2" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (put.status === 403) return { ok: false, error: "Access denied — check access key / secret / bucket policy" };
    if (put.status === 404) return { ok: false, error: "Bucket not found (check bucket name, region and path-style setting)" };
    if (!put.ok) return { ok: false, error: `Server responded ${put.status}` };
    // Probe objects are tiny and prefixed with a dot; a lifecycle rule or the
    // next backup overwrite keeps the bucket tidy — no DELETE permission needed.
    return { ok: true, detail: `${cfg.bucket} @ ${new URL(t.url).host}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Connection failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Google Drive                                                        */
/* ------------------------------------------------------------------ */

export interface GDriveConfig {
  folderName?: string;
  /** Resolved folder id, cached after first upload. */
  folderId?: string;
}

export function isGoogleDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Exchange the long-lived refresh token for a short-lived access token. */
export async function gdriveAccessToken(refreshToken: string): Promise<string> {
  if (!isGoogleDriveConfigured()) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}) ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google returned no access token");
  return json.access_token;
}

/** Exchange an authorization code (from the client-side consent flow) for a refresh token + email. */
export async function gdriveExchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; email: string | null }> {
  if (!isGoogleDriveConfigured()) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google code exchange failed (${res.status}) ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as { refresh_token?: string; access_token?: string; id_token?: string };
  if (!json.refresh_token) throw new Error("Google did not return a refresh token — re-consent with access_type=offline&prompt=consent");
  let email: string | null = null;
  if (json.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(json.id_token.split(".")[1]!, "base64url").toString("utf8")) as { email?: string };
      email = payload.email ?? null;
    } catch {
      /* ignore */
    }
  }
  return { refreshToken: json.refresh_token, email };
}

async function gdriveEnsureFolder(accessToken: string, name: string): Promise<string> {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents`);
  const found = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (found.ok) {
    const json = (await found.json()) as { files?: Array<{ id: string }> };
    if (json.files?.[0]?.id) return json.files[0].id;
  }
  const created = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!created.ok) throw new Error(`Drive folder create failed (${created.status})`);
  return ((await created.json()) as { id: string }).id;
}

export async function gdriveUpload(t: ResolvedTarget, filename: string, body: Buffer, contentType: string): Promise<string> {
  const cfg = t.config as GDriveConfig;
  const token = await gdriveAccessToken(t.secret);
  const folderId = cfg.folderId ?? (await gdriveEnsureFolder(token, cfg.folderName || "GoldenMemory"));
  const boundary = `gm${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name: filename, parents: [folderId] });
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`, "utf8");
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const payload = Buffer.concat([head, body, tail]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(payload.byteLength) },
    body: payload as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive upload failed (${res.status}) ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view`;
}

export async function probeGDrive(t: ResolvedTarget): Promise<ProbeResult> {
  try {
    const token = await gdriveAccessToken(t.secret);
    const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota(limit,usage)", { headers: { Authorization: `Bearer ${token}` } });
    if (!about.ok) return { ok: false, error: `Drive responded ${about.status}` };
    const json = (await about.json()) as { user?: { emailAddress?: string }; storageQuota?: { limit?: string; usage?: string } };
    const used = Number(json.storageQuota?.usage ?? 0) / 1024 ** 3;
    const limit = Number(json.storageQuota?.limit ?? 0) / 1024 ** 3;
    return { ok: true, detail: `${json.user?.emailAddress ?? t.username}${limit ? ` · ${used.toFixed(1)} / ${limit.toFixed(0)} GB` : ""}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Google Drive check failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export async function probeTarget(t: ResolvedTarget): Promise<ProbeResult> {
  if (t.kind === "webdav") return probeWebDav({ url: t.url, username: t.username, password: t.secret });
  if (t.kind === "s3") return probeS3(t);
  return probeGDrive(t);
}

/** Upload one backup artefact. Returns a URL / link to the stored copy. */
export async function uploadToTarget(t: ResolvedTarget, filename: string, body: Buffer, contentType: string): Promise<string> {
  if (t.kind === "webdav") return putFile({ url: t.url, username: t.username, password: t.secret }, `GoldenMemory/${filename}`, body, contentType);
  if (t.kind === "s3") return s3Put(t, `GoldenMemory/${filename}`, body, contentType);
  return gdriveUpload(t, filename, body, contentType);
}

/* ------------------------------------------------------------------ */
/* P12 — list + download backups stored on the target                  */
/* ------------------------------------------------------------------ */

export interface RemoteEntry {
  /** Kind-specific key: WebDAV relative path · S3 object key · Drive file id */
  key: string;
  name: string;
  bytes: number | null;
  modifiedAt: Date | null;
  format: "zip" | "json" | "other";
}

const fmtOf = (name: string): RemoteEntry["format"] => (name.endsWith(".zip") ? "zip" : name.endsWith(".json") ? "json" : "other");
const ours = (name: string) => /\.(zip|json)$/i.test(name) && !name.startsWith(".");

async function listWebDav(t: ResolvedTarget): Promise<RemoteEntry[]> {
  const folder = new URL("GoldenMemory/", t.url).toString();
  const res = await fetch(folder, { method: "PROPFIND", headers: { Authorization: `Basic ${Buffer.from(`${t.username}:${t.secret}`).toString("base64")}`, Depth: "1" } });
  if (res.status === 404) return [];
  if (!(res.status === 207 || res.ok)) throw new Error(`WebDAV PROPFIND failed (${res.status})`);
  const xml = await res.text();
  const out: RemoteEntry[] = [];
  for (const m of xml.matchAll(/<(?:[a-zA-Z0-9]+:)?response>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?response>/g)) {
    const block = m[1]!;
    const href = /<(?:[a-zA-Z0-9]+:)?href>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/.exec(block)?.[1] ?? "";
    const name = decodeURIComponent(href.replace(/\/$/, "").split("/").pop() ?? "");
    if (!ours(name)) continue;
    const len = /<(?:[a-zA-Z0-9]+:)?getcontentlength>(\d+)</.exec(block)?.[1];
    const mod = /<(?:[a-zA-Z0-9]+:)?getlastmodified>([^<]+)</.exec(block)?.[1];
    out.push({ key: `GoldenMemory/${name}`, name, bytes: len ? Number(len) : null, modifiedAt: mod ? new Date(mod) : null, format: fmtOf(name) });
  }
  return out.sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));
}

async function downloadWebDav(t: ResolvedTarget, key: string): Promise<Buffer> {
  const url = new URL(key.split("/").map(encodeURIComponent).join("/"), t.url).toString();
  const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${t.username}:${t.secret}`).toString("base64")}` } });
  if (!res.ok) throw new Error(`WebDAV GET failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function listS3(t: ResolvedTarget): Promise<RemoteEntry[]> {
  const cfg = t.config as unknown as S3Config;
  const prefix = `${(cfg.prefix ?? "").replace(/^\/+|\/+$/g, "")}${cfg.prefix ? "/" : ""}GoldenMemory/`;
  const ep = new URL(t.url);
  const base = cfg.pathStyle ? `${ep.origin}/${encodeURIComponent(cfg.bucket)}/` : `${ep.protocol}//${cfg.bucket}.${ep.host}/`;
  const url = new URL(base);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("max-keys", "200");
  // Query params must be in the canonical request; the signer here only covers header-auth with empty query,
  // so we sign a canonical query string explicitly.
  const canonicalQuery = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const headers = signS3Request({ method: "GET", host: url.host, canonicalPath: cfg.pathStyle ? `/${encodeURIComponent(cfg.bucket)}/` : "/", region: cfg.region, accessKey: t.username, secretKey: t.secret, payloadHash: sha256Hex(""), canonicalQuery });
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`S3 list failed (${res.status})`);
  const xml = await res.text();
  const out: RemoteEntry[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const b = m[1]!;
    const key = /<Key>([^<]+)<\/Key>/.exec(b)?.[1] ?? "";
    const name = key.split("/").pop() ?? key;
    if (!ours(name)) continue;
    out.push({ key, name, bytes: Number(/<Size>(\d+)<\/Size>/.exec(b)?.[1] ?? 0), modifiedAt: new Date(/<LastModified>([^<]+)<\/LastModified>/.exec(b)?.[1] ?? 0), format: fmtOf(name) });
  }
  return out.sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));
}

async function downloadS3(t: ResolvedTarget, key: string): Promise<Buffer> {
  const cfg = t.config as unknown as S3Config;
  const { url, host, canonicalPath } = s3ObjectUrl(t.url, cfg, key);
  const headers = signS3Request({ method: "GET", host, canonicalPath, region: cfg.region, accessKey: t.username, secretKey: t.secret, payloadHash: sha256Hex("") });
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`S3 GET failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function listGDrive(t: ResolvedTarget): Promise<RemoteEntry[]> {
  const cfg = t.config as GDriveConfig;
  const token = await gdriveAccessToken(t.secret);
  const folderId = cfg.folderId ?? (await gdriveEnsureFolder(token, cfg.folderName || "GoldenMemory"));
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=200`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
  const json = (await res.json()) as { files?: Array<{ id: string; name: string; size?: string; modifiedTime?: string }> };
  return (json.files ?? []).filter((f) => ours(f.name)).map((f) => ({ key: f.id, name: f.name, bytes: f.size ? Number(f.size) : null, modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null, format: fmtOf(f.name) }));
}

async function downloadGDrive(t: ResolvedTarget, fileId: string): Promise<Buffer> {
  const token = await gdriveAccessToken(t.secret);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function listTarget(t: ResolvedTarget): Promise<RemoteEntry[]> {
  if (t.kind === "webdav") return listWebDav(t);
  if (t.kind === "s3") return listS3(t);
  return listGDrive(t);
}

export async function downloadFromTarget(t: ResolvedTarget, key: string): Promise<Buffer> {
  if (t.kind === "webdav") return downloadWebDav(t, key);
  if (t.kind === "s3") return downloadS3(t, key);
  return downloadGDrive(t, key);
}

/* ------------------------------------------------------------------ */
/* P14 — delete (retention) + quota                                    */
/* ------------------------------------------------------------------ */

async function deleteWebDav(t: ResolvedTarget, key: string): Promise<void> {
  const url = new URL(key.split("/").map(encodeURIComponent).join("/"), t.url).toString();
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Basic ${Buffer.from(`${t.username}:${t.secret}`).toString("base64")}` } });
  if (!(res.ok || res.status === 404)) throw new Error(`WebDAV DELETE failed (${res.status})`);
}

async function deleteS3(t: ResolvedTarget, key: string): Promise<void> {
  const cfg = t.config as unknown as S3Config;
  const { url, host, canonicalPath } = s3ObjectUrl(t.url, cfg, key);
  const headers = signS3Request({ method: "DELETE", host, canonicalPath, region: cfg.region, accessKey: t.username, secretKey: t.secret, payloadHash: sha256Hex("") });
  const res = await fetch(url, { method: "DELETE", headers });
  if (!(res.ok || res.status === 404)) throw new Error(`S3 DELETE failed (${res.status})`);
}

async function deleteGDrive(t: ResolvedTarget, fileId: string): Promise<void> {
  const token = await gdriveAccessToken(t.secret);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!(res.ok || res.status === 404)) throw new Error(`Drive delete failed (${res.status})`);
}

export async function deleteFromTarget(t: ResolvedTarget, key: string): Promise<void> {
  if (t.kind === "webdav") return deleteWebDav(t, key);
  if (t.kind === "s3") return deleteS3(t, key);
  return deleteGDrive(t, key);
}

/** Pure: which entries exceed the keep count (newest first kept). */
export function entriesToPrune(entries: RemoteEntry[], keepCount: number | null | undefined): RemoteEntry[] {
  if (!keepCount || keepCount < 1) return [];
  const sorted = [...entries].filter((e) => e.format !== "other").sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));
  return sorted.slice(keepCount);
}

/** Delete backups beyond `keepCount` on the target; returns removed names. */
export async function applyRetention(t: ResolvedTarget, keepCount: number | null | undefined): Promise<string[]> {
  const victims = entriesToPrune(await listTarget(t), keepCount);
  const removed: string[] = [];
  for (const v of victims) {
    await deleteFromTarget(t, v.key);
    removed.push(v.name);
  }
  return removed;
}

export interface TargetQuota {
  /** bytes used by our GoldenMemory/ backups (sum of listed entries) */
  usedBytes: number;
  /** provider-wide quota when the API exposes it (WebDAV quota-available-bytes, Drive storageQuota); null for S3 */
  quotaBytes: number | null;
  /** provider-wide usage when exposed */
  providerUsedBytes: number | null;
  entries: number;
}

async function webdavQuota(t: ResolvedTarget): Promise<{ quotaBytes: number | null; usedBytes: number | null }> {
  const res = await fetch(t.url, {
    method: "PROPFIND",
    headers: { Authorization: `Basic ${Buffer.from(`${t.username}:${t.secret}`).toString("base64")}`, Depth: "0", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-available-bytes/><d:quota-used-bytes/></d:prop></d:propfind>`,
  });
  if (!(res.status === 207 || res.ok)) return { quotaBytes: null, usedBytes: null };
  const xml = await res.text();
  const avail = /<(?:[a-zA-Z0-9]+:)?quota-available-bytes>(-?\d+)</.exec(xml)?.[1];
  const used = /<(?:[a-zA-Z0-9]+:)?quota-used-bytes>(\d+)</.exec(xml)?.[1];
  const usedN = used ? Number(used) : null;
  const availN = avail ? Number(avail) : null;
  return { usedBytes: usedN, quotaBytes: availN != null && availN >= 0 && usedN != null ? availN + usedN : null };
}

async function gdriveQuota(t: ResolvedTarget): Promise<{ quotaBytes: number | null; usedBytes: number | null }> {
  const token = await gdriveAccessToken(t.secret);
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=storageQuota", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { quotaBytes: null, usedBytes: null };
  const j = (await res.json()) as { storageQuota?: { limit?: string; usage?: string } };
  return { quotaBytes: j.storageQuota?.limit ? Number(j.storageQuota.limit) : null, usedBytes: j.storageQuota?.usage ? Number(j.storageQuota.usage) : null };
}

/** Usage of our folder + provider quota where available. */
export async function probeQuota(t: ResolvedTarget): Promise<TargetQuota> {
  const entries = await listTarget(t);
  const usedBytes = entries.reduce((n, e) => n + (e.bytes ?? 0), 0);
  const provider = t.kind === "webdav" ? await webdavQuota(t).catch(() => ({ quotaBytes: null, usedBytes: null })) : t.kind === "gdrive" ? await gdriveQuota(t).catch(() => ({ quotaBytes: null, usedBytes: null })) : { quotaBytes: null, usedBytes: null };
  return { usedBytes, quotaBytes: provider.quotaBytes, providerUsedBytes: provider.usedBytes, entries: entries.length };
}

/** Rough monthly cost estimate (USD) per GB for S3 storage classes — order-of-magnitude, for the UI only. */
export const S3_CLASS_USD_PER_GB_MONTH: Record<S3StorageClass, number> = { STANDARD: 0.023, STANDARD_IA: 0.0125, ONEZONE_IA: 0.01, GLACIER_IR: 0.004, GLACIER: 0.0036, DEEP_ARCHIVE: 0.00099 };

export function estimateMonthlyUsd(bytes: number, cls: string | null | undefined): number | null {
  const rate = cls && cls in S3_CLASS_USD_PER_GB_MONTH ? S3_CLASS_USD_PER_GB_MONTH[cls as S3StorageClass] : null;
  if (rate == null) return null;
  return Math.round((bytes / 1024 ** 3) * rate * 10000) / 10000;
}

export const TARGET_LABELS: Record<BackupTargetKind, { zh: string; en: string }> = {
  webdav: { zh: "WebDAV 云盘", en: "WebDAV drive" },
  s3: { zh: "S3 兼容对象存储", en: "S3-compatible bucket" },
  gdrive: { zh: "Google Drive", en: "Google Drive" },
};
