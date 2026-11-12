/**
 * P10 — minimal WebDAV client (Nextcloud / 坚果云 / Synology / 群晖 / ownCloud…)
 * using plain fetch + Basic auth: PROPFIND (probe), MKCOL (ensure folders), PUT.
 *
 * Also provides `sealSecret` / `openSecret`: AES-256-GCM with a key derived
 * from JWT_SECRET, so target passwords never sit in the DB in clear text.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { ENV } from "./env";

export interface WebDavTarget {
  url: string; // base folder URL, e.g. https://dav.jianguoyun.com/dav/GoldenMemory/
  username: string;
  password: string;
}

const auth = (t: WebDavTarget) => `Basic ${Buffer.from(`${t.username}:${t.password}`).toString("base64")}`;

export function normalizeDavUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && !(u.protocol === "http:" && !ENV.isProduction)) return null;
    if (u.username || u.password) return null;
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Fast connectivity + credential check (PROPFIND depth 0 on the base folder). */
export async function probeWebDav(t: WebDavTarget, timeoutMs = 10_000): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(t.url, { method: "PROPFIND", headers: { Authorization: auth(t), Depth: "0" }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Authentication failed (check username / app password)" };
    if (res.status === 404) {
      // Folder missing is fine — we can create it.
      const mk = await fetch(t.url, { method: "MKCOL", headers: { Authorization: auth(t) }, signal: AbortSignal.timeout(timeoutMs) });
      if (mk.status === 201 || mk.status === 405) return { ok: true };
      return { ok: false, error: `Cannot create folder (${mk.status})` };
    }
    if (res.status === 207 || res.ok) return { ok: true };
    return { ok: false, error: `Server responded ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Connection failed" };
  }
}

/** Create every missing folder along `relPath` (idempotent; 405 = exists). */
export async function ensureCollection(t: WebDavTarget, relDir: string): Promise<void> {
  const parts = relDir.split("/").filter(Boolean);
  let cur = t.url;
  for (const p of parts) {
    cur = new URL(`${encodeURIComponent(p)}/`, cur).toString();
    const res = await fetch(cur, { method: "MKCOL", headers: { Authorization: auth(t) } });
    if (!(res.status === 201 || res.status === 405 || res.ok)) throw new Error(`MKCOL ${p} failed (${res.status})`);
  }
}

/** PUT a file (Buffer) to `relPath` under the target folder. Returns the full URL. */
export async function putFile(t: WebDavTarget, relPath: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
  const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  if (dir) await ensureCollection(t, dir);
  const url = new URL(relPath.split("/").map(encodeURIComponent).join("/"), t.url).toString();
  const res = await fetch(url, { method: "PUT", headers: { Authorization: auth(t), "Content-Type": contentType, "Content-Length": String(body.byteLength) }, body: body as unknown as BodyInit });
  if (!(res.status === 201 || res.status === 204 || res.ok)) {
    const text = await res.text().catch(() => "");
    throw new Error(`WebDAV PUT failed (${res.status}) ${text.slice(0, 120)}`);
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* Secret sealing                                                      */
/* ------------------------------------------------------------------ */

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = ENV.cookieSecret || process.env.BACKUP_TARGET_KEY || "dev-only-insecure-key";
  cachedKey = scryptSync(secret, "gm-backup-target-v1", 32);
  return cachedKey;
}

/** `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function openSecret(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Malformed sealed secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
