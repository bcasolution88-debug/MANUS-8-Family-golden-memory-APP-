import { afterEach, describe, expect, it } from "vitest";

import { __resetUserBuckets, consumeUserToken } from "../server/_core/rateLimit";
import { shareStatus } from "../server/interactionRouter";
import {
  buildMediaKey,
  buildVoiceKey,
  isValidStorageKey,
  parseStorageKey,
  sanitizeFileName,
  storageProxyPath,
} from "../server/storage";

/* DB-free unit tests for the P3 helpers. */

describe("storage keys (private S3 model)", () => {
  it("builds owner-prefixed media keys and parses them back", () => {
    const key = buildMediaKey(12, 34, "9b2f9a20-0000-4000-8000-000000000000", "我的 照片 (1).JPG");
    expect(key).toBe("families/12/albums/34/9b2f9a20-0000-4000-8000-000000000000/1_.JPG");
    expect(parseStorageKey(key)).toEqual({ kind: "media", familyId: 12, albumId: 34 });
    expect(isValidStorageKey(key)).toBe(true);
    expect(storageProxyPath(`/${key}`)).toBe(`/manus-storage/${key}`);
  });

  it("builds per-user voice keys", () => {
    const key = buildVoiceKey(7, "m4a");
    expect(key.startsWith("users/7/voice/")).toBe(true);
    expect(key.endsWith(".m4a")).toBe(true);
    expect(parseStorageKey(key)).toEqual({ kind: "user", userId: 7 });
  });

  it("rejects traversal, control chars and unknown layouts", () => {
    expect(isValidStorageKey("families/1/albums/2/../../etc/passwd")).toBe(false);
    expect(isValidStorageKey("families/1/albums/2/a\u0000b.jpg")).toBe(false);
    expect(isValidStorageKey("")).toBe(false);
    expect(isValidStorageKey("x".repeat(513))).toBe(false);
    expect(parseStorageKey("public/whatever.jpg")).toEqual({ kind: "unknown" });
  });

  it("sanitizes file names without losing the extension", () => {
    expect(sanitizeFileName("../../evil.sh")).toBe("evil.sh");
    expect(sanitizeFileName("Family Trip — 2026.heic")).toBe("Family_Trip_2026.heic");
    expect(sanitizeFileName("")).toBe("file");
  });
});

describe("share lifecycle", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  it("derives status with revoked winning over expired", () => {
    expect(shareStatus({ expiresAt: null, revokedAt: null }, now)).toBe("active");
    expect(shareStatus({ expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: null }, now)).toBe("active");
    expect(shareStatus({ expiresAt: new Date("2026-11-01T00:00:00Z"), revokedAt: null }, now)).toBe("expired");
    expect(shareStatus({ expiresAt: new Date("2026-11-01T00:00:00Z"), revokedAt: now }, now)).toBe("revoked");
    expect(shareStatus({ expiresAt: now, revokedAt: null }, now)).toBe("expired");
  });
});

describe("per-user rate limiter", () => {
  afterEach(() => __resetUserBuckets());

  it("allows `limit` calls per window then blocks with a retry delay", () => {
    for (let i = 0; i < 3; i++) expect(consumeUserToken("t:1", 3, 60_000)).toBe(0);
    const retry = consumeUserToken("t:1", 3, 60_000);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60_000);
  });

  it("isolates buckets per key", () => {
    for (let i = 0; i < 3; i++) consumeUserToken("t:1", 3, 60_000);
    expect(consumeUserToken("t:2", 3, 60_000)).toBe(0);
  });
});

describe("rate limiter backend selection", () => {
  it("reports memory when REDIS_URL is unset", async () => {
    const { rateLimitBackend } = await import("../server/_core/rateLimit");
    expect(rateLimitBackend()).toBe("memory");
  });
});
