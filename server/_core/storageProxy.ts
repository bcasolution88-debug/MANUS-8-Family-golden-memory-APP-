import type { Express } from "express";
import { ENV } from "./env";
import { sdk } from "./sdk";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key || key.length > 512 || key.includes("..")) {
      res.status(400).send("Invalid storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      await sdk.authenticateRequest(req);
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });
      if (!forgeResp.ok) {
        res.status(502).send("Storage backend error");
        return;
      }
      const body = (await forgeResp.json()) as { url?: string };
      if (!body.url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      const signedUrl = new URL(body.url);
      const configuredHost = new URL(ENV.forgeApiUrl).hostname;
      const allowedHosts = new Set([
        configuredHost,
        "s3.amazonaws.com",
        "s3.us-east-1.amazonaws.com",
      ]);
      if (
        signedUrl.protocol !== "https:" ||
        !allowedHosts.has(signedUrl.hostname)
      ) {
        res.status(502).send("Invalid storage URL");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, signedUrl.toString());
    } catch {
      res.status(401).send("Not authenticated");
    }
  });
}
