import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";

import { familyMembers } from "../../drizzle/schema";
import { getDb } from "../db";
import { isValidStorageKey, parseStorageKey, storageGetSignedUrl } from "../storage";
import { ENV } from "./env";
import { sdk } from "./sdk";

/**
 * Object-level authorization for `/manus-storage/{key}` (P3).
 *
 * Keys are laid out so the owner can be derived from the prefix alone — no
 * extra lookup against `media` is needed and orphaned objects (upload started
 * but `completeUpload` never called) are still protected:
 *
 *   families/{familyId}/albums/{albumId}/...  → requester must be a family member
 *   users/{userId}/...                         → requester must be that user
 *   anything else                              → denied (legacy keys are served
 *                                                through media.getSignedUrl only)
 */
export async function canAccessStorageKey(userId: number, key: string): Promise<boolean> {
  const parsed = parseStorageKey(key);
  // P7: avatars are visible to every signed-in user (they appear next to
  // comments / members in any family the owner belongs to).
  if (parsed.kind === "avatar") return true;
  if (parsed.kind === "backup" || parsed.kind === "music" || parsed.kind === "user") return parsed.userId === userId;
  if (parsed.kind !== "media") return false;

  const database = await getDb();
  if (!database) return false;
  const rows = await database
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(and(eq(familyMembers.familyId, parsed.familyId), eq(familyMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

function validateSignedUrl(raw: string): URL | null {
  const signedUrl = new URL(raw);
  const configuredHost = new URL(ENV.forgeApiUrl).hostname;
  const allowedHosts = new Set([
    configuredHost,
    "s3.amazonaws.com",
    "s3.us-east-1.amazonaws.com",
  ]);
  const bucketHostOk = /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(signedUrl.hostname);
  if (signedUrl.protocol !== "https:") return null;
  if (!allowedHosts.has(signedUrl.hostname) && !bucketHostOk) return null;
  return signedUrl;
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req: Request, res: Response) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key || !isValidStorageKey(key)) {
      res.status(400).send("Invalid storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    let userId: number;
    try {
      const user = await sdk.authenticateRequest(req);
      userId = user.id;
    } catch {
      res.status(401).send("Not authenticated");
      return;
    }

    try {
      if (!(await canAccessStorageKey(userId, key))) {
        res.status(403).send("Forbidden");
        return;
      }
      const signedUrl = validateSignedUrl(await storageGetSignedUrl(key));
      if (!signedUrl) {
        res.status(502).send("Invalid storage URL");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, signedUrl.toString());
    } catch (error) {
      console.error("[storageProxy] failed", error);
      res.status(502).send("Storage backend error");
    }
  });
}
