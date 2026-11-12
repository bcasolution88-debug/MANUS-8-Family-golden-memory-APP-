import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildAvatarKey, isValidStorageKey, parseStorageKey } from "../server/storage";
import { canAccessStorageKey } from "../server/_core/storageProxy";
import { STUDIO_TEMPLATES, STUDIO_TEMPLATE_IDS } from "../server/studioRouter";
import { isFfmpegAvailable, renderSlideshow } from "../server/_core/videoRender";

/* DB-free unit tests for the P7 helpers. */

describe("avatar storage keys", () => {
  it("builds per-user avatar keys that parse as `avatar`", () => {
    const key = buildAvatarKey(42, "png");
    expect(key.startsWith("users/42/avatar/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(isValidStorageKey(key)).toBe(true);
    expect(parseStorageKey(key)).toEqual({ kind: "avatar", userId: 42 });
  });

  it("keeps voice keys private to the owner but avatars readable by any signed-in user", async () => {
    expect(await canAccessStorageKey(1, "users/42/avatar/x.jpg")).toBe(true);
    expect(await canAccessStorageKey(42, "users/42/voice/x.m4a")).toBe(true);
    expect(await canAccessStorageKey(1, "users/42/voice/x.m4a")).toBe(false);
  });
});

describe("studio templates", () => {
  it("exposes one template per id with sane pacing", () => {
    expect(STUDIO_TEMPLATES.map((t) => t.id).sort()).toEqual([...STUDIO_TEMPLATE_IDS].sort());
    for (const t of STUDIO_TEMPLATES) {
      expect(t.secondsPerSlide).toBeGreaterThanOrEqual(2);
      expect(t.secondsPerSlide).toBeLessThanOrEqual(6);
      expect(t.accent).toMatch(/^[0-9A-F]{6}$/i);
    }
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("slideshow renderer (ffmpeg)", () => {
  it("renders title + 2 slides with captions into an mp4 and poster", async () => {
    expect(await isFfmpegAvailable()).toBe(true);
    const dir = await mkdtemp(path.join(tmpdir(), "gm-test-"));
    try {
      // Generate two small solid-colour JPEGs with ffmpeg itself.
      const srcs: string[] = [];
      for (const [i, color] of ["0x3366cc", "0xcc6633"].entries()) {
        const p = path.join(dir, `p${i}.jpg`);
        const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=640x480:d=0.1`, "-frames:v", "1", p]);
        expect(r.status).toBe(0);
        srcs.push(p);
      }
      const stages: string[] = [];
      const result = await renderSlideshow({
        slides: srcs.map((s, i) => ({ source: s, caption: i === 0 ? "第一张 · First" : undefined })),
        title: "测试 · Test: 100%",
        subtitle: "Golden Memory",
        secondsPerSlide: 2,
        transition: "fade",
        width: 320,
        height: 180,
        fps: 10,
        onProgress: (_d, _t, stage) => stages.push(stage),
      });
      try {
        expect((await stat(result.videoPath)).size).toBeGreaterThan(1000);
        expect((await stat(result.posterPath)).size).toBeGreaterThan(200);
        // 3 clips × 2s − 2 × 0.5s xfade
        expect(result.durationSeconds).toBeCloseTo(5, 1);
        expect(stages).toEqual(expect.arrayContaining(["title", "download", "slide", "concat", "poster"]));
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", result.videoPath]);
        expect(probe.stdout.toString().trim()).toBe("320,180");
      } finally {
        await result.cleanup();
      }
      await expect(stat(result.videoPath)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("rejects empty / oversized slide lists", async () => {
    await expect(renderSlideshow({ slides: [] })).rejects.toThrow(/at least one/i);
    await expect(renderSlideshow({ slides: new Array(13).fill({ source: "x" }) })).rejects.toThrow(/at most 12/i);
  });

  it("cleans up when a slide cannot be read", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gm-test-"));
    const bad = path.join(dir, "bad.jpg");
    await writeFile(bad, "not an image");
    try {
      await expect(renderSlideshow({ slides: [{ source: bad }], width: 160, height: 90, fps: 5 })).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* P8                                                                  */
/* ------------------------------------------------------------------ */

import { hashPassword, verifyPassword } from "../server/passwordAuthRouter";
import { wantsNotification } from "../server/notifications";
import { DEFAULT_PREFERENCES } from "../server/preferencesRouter";

describe("P8 password hashing (scrypt)", () => {
  it("hashes with a random salt and verifies in constant time", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("Correct horse battery", a)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "bcrypt$garbage")).toBe(false);
  });
});

describe("P8 notification preference gating", () => {
  it("maps each type to its switch and keeps invites/system when all off", () => {
    const prefs = { ...DEFAULT_PREFERENCES };
    expect(wantsNotification(prefs, "like")).toBe(true);
    expect(wantsNotification({ ...prefs, notifyLikes: false }, "like")).toBe(false);
    expect(wantsNotification({ ...prefs, notifyComments: false }, "reply")).toBe(false);
    expect(wantsNotification({ ...prefs, notifyUploads: false }, "upload")).toBe(false);
    expect(wantsNotification({ ...prefs, notifyAnniversaries: false }, "anniversary")).toBe(false);
    expect(wantsNotification({ ...prefs, notifyShares: false }, "share")).toBe(false);
    // member_joined has no switch → always delivered while enabled
    expect(wantsNotification({ ...prefs, notifyLikes: false, notifyComments: false }, "member_joined")).toBe(true);
    const off = { ...prefs, notifyEnabled: false };
    expect(wantsNotification(off, "like")).toBe(false);
    expect(wantsNotification(off, "member_joined")).toBe(false);
    expect(wantsNotification(off, "invite")).toBe(true);
    expect(wantsNotification(off, "system")).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg)("P8 generated music track", () => {
  it("muxes an AAC track that matches the video length", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gm-test-"));
    try {
      const p = path.join(dir, "p.jpg");
      expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x336699:s=320x240:d=0.1", "-frames:v", "1", p]).status).toBe(0);
      const result = await renderSlideshow({ slides: [{ source: p }, { source: p }], secondsPerSlide: 2, width: 160, height: 90, fps: 10, music: "joy" });
      try {
        expect(result.hasAudio).toBe(true);
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "csv=p=0", result.videoPath]);
        const streams = probe.stdout.toString().trim().split("\n").sort();
        expect(streams).toEqual(["aac,audio", "h264,video"]);
        const dur = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", result.videoPath]);
        expect(Number(dur.stdout.toString().trim())).toBeCloseTo(result.durationSeconds, 0);
      } finally {
        await result.cleanup();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("stays silent when music is none", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gm-test-"));
    try {
      const p = path.join(dir, "p.jpg");
      spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x996633:s=320x240:d=0.1", "-frames:v", "1", p]);
      const result = await renderSlideshow({ slides: [{ source: p }], secondsPerSlide: 2, width: 160, height: 90, fps: 10 });
      try {
        expect(result.hasAudio).toBe(false);
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", result.videoPath]);
        expect(probe.stdout.toString().trim()).toBe("video");
      } finally {
        await result.cleanup();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* P9                                                                  */
/* ------------------------------------------------------------------ */

import { codeEmail, backupEmail, isMailConfigured, sendMail } from "../server/_core/mailer";
import { generateCode, CODE_TTL_MS, CODE_MAX_ATTEMPTS } from "../server/verificationRouter";
import { buildBackupKey, BACKUP_INTERVAL_MS, BACKUP_KEEP } from "../server/backupService";
import { STUDIO_CONCURRENCY, STUDIO_STALE_MS, WORKER_ID, __queueState } from "../server/studioRouter";

describe("P9 verification codes", () => {
  it("generates zero-padded 6-digit codes with sane policy constants", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
    expect(CODE_TTL_MS).toBe(10 * 60 * 1000);
    expect(CODE_MAX_ATTEMPTS).toBe(5);
  });
});

describe("P9 mailer", () => {
  it("falls back to the console transport when nothing is configured", async () => {
    const saved = { r: process.env.RESEND_API_KEY, s: process.env.SMTP_URL };
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_URL;
    try {
      expect(isMailConfigured()).toBe(false);
      const res = await sendMail({ to: "a@example.test", subject: "x", text: "y" });
      expect(res).toMatchObject({ delivered: false, transport: "console" });
    } finally {
      if (saved.r) process.env.RESEND_API_KEY = saved.r;
      if (saved.s) process.env.SMTP_URL = saved.s;
    }
  });

  it("renders bilingual code emails with the code in subject + body and escapes HTML", () => {
    const zh = codeEmail({ code: "123456", purpose: "password_reset", name: "<王>", minutes: 10, zh: true });
    expect(zh.subject).toContain("123456");
    expect(zh.text).toContain("123456");
    expect(zh.html).toContain("&lt;王&gt;");
    expect(zh.html).not.toContain("<王>");
    const en = codeEmail({ code: "000001", purpose: "login_2fa", minutes: 10, zh: false });
    expect(en.subject).toMatch(/sign-in code/i);
    const b = backupEmail({ name: null, itemCount: 3, bytes: 2048, downloadUrl: "https://x/y", zh: false });
    expect(b.text).toContain("https://x/y");
    expect(b.subject).toContain("3 items");
  });
});

describe("P9 backups + storage ACL", () => {
  it("builds owner-prefixed backup keys that only the owner can read", async () => {
    const key = buildBackupKey(7, new Date("2026-01-02T03:04:05.000Z"));
    expect(key).toBe("users/7/backups/2026-01-02T03-04-05-000Z.json");
    expect(parseStorageKey(key)).toEqual({ kind: "backup", userId: 7 });
    expect(await canAccessStorageKey(7, key)).toBe(true);
    expect(await canAccessStorageKey(8, key)).toBe(false);
    expect(BACKUP_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(BACKUP_KEEP).toBeGreaterThanOrEqual(3);
  });
});

describe("P9 studio queue", () => {
  it("exposes a per-process concurrency cap and worker id", () => {
    expect(STUDIO_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(STUDIO_STALE_MS).toBeGreaterThan(60_000);
    expect(WORKER_ID).toMatch(/^.+:\d+$/);
    expect(__queueState()).toMatchObject({ active: 0, concurrency: STUDIO_CONCURRENCY, workerId: WORKER_ID });
  });
});

/* ------------------------------------------------------------------ */
/* P10                                                                 */
/* ------------------------------------------------------------------ */

import { codeSms, isSmsConfigured, maskPhone, normalizePhone, sendSms, smsTransportName } from "../server/_core/sms";
import { mailDiagnostics, mailFromDomain, mailTransportName } from "../server/_core/mailer";
import { isExpoPushToken, pushCopy, sendExpoPush, PUSH_BATCH } from "../server/_core/push";
import { LeaderElection, __resetLocalLocks, acquireLock, coordinationBackend, runIfLeader, schedulerLeader, withLock } from "../server/_core/coordination";
import { normalizeDavUrl, openSecret, sealSecret } from "../server/_core/webdav";
import { daysUntilAnniversary, nextOccurrenceYear, reminderPreview, REMINDER_DAYS_BEFORE } from "../server/reminderService";
import { buildMusicKey } from "../server/storage";
import { BACKUP_FILE_MAX_BYTES, BACKUP_ZIP_MAX_BYTES } from "../server/backupService";
import { MUSIC_CONTENT_TYPES, MUSIC_MAX_BYTES } from "../server/_core/videoRender";

describe("P10 SMS channel", () => {
  it("normalises and masks E.164 numbers", () => {
    expect(normalizePhone("+86 138 0013 8000")).toBe("+8613800138000");
    expect(normalizePhone("0086-13800138000")).toBe("+8613800138000");
    expect(normalizePhone("13800138000")).toBeNull();
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
    expect(maskPhone("+8613800138000")).toMatch(/\*\*\*\*8000$/);
    expect(maskPhone("+8613800138000")).not.toContain("0013");
  });

  it("falls back to console when no transport is configured and keeps texts short", async () => {
    const saved = { a: process.env.TWILIO_ACCOUNT_SID, b: process.env.TWILIO_AUTH_TOKEN, c: process.env.TWILIO_FROM, d: process.env.SMS_WEBHOOK_URL };
    for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "SMS_WEBHOOK_URL"]) delete process.env[k];
    try {
      expect(isSmsConfigured()).toBe(false);
      expect(smsTransportName()).toBe("console");
      const res = await sendSms({ to: "+8613800138000", text: "hi" });
      expect(res).toMatchObject({ delivered: false, transport: "console" });
      const zh = codeSms({ code: "123456", purpose: "login_2fa", minutes: 10, zh: true });
      expect(zh).toContain("123456");
      expect(zh.length).toBeLessThan(70);
      expect(codeSms({ code: "654321", purpose: "verify_phone", minutes: 10, zh: false })).toMatch(/654321/);
    } finally {
      if (saved.a) process.env.TWILIO_ACCOUNT_SID = saved.a;
      if (saved.b) process.env.TWILIO_AUTH_TOKEN = saved.b;
      if (saved.c) process.env.TWILIO_FROM = saved.c;
      if (saved.d) process.env.SMS_WEBHOOK_URL = saved.d;
    }
  });
});

describe("P10 mail diagnostics", () => {
  it("extracts the sending domain and reports an actionable hint when unconfigured", async () => {
    expect(mailFromDomain("金色韶华 <no-reply@golden-memory.app>")).toBe("golden-memory.app");
    expect(mailFromDomain("ops@Example.COM")).toBe("example.com");
    expect(mailFromDomain("nonsense")).toBeNull();
    const saved = { r: process.env.RESEND_API_KEY, s: process.env.SMTP_URL };
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_URL;
    try {
      expect(mailTransportName()).toBe("console");
      const d = await mailDiagnostics();
      expect(d.configured).toBe(false);
      expect(d.hint).toMatch(/RESEND_API_KEY/);
    } finally {
      if (saved.r) process.env.RESEND_API_KEY = saved.r;
      if (saved.s) process.env.SMTP_URL = saved.s;
    }
  });
});

describe("P10 Expo push", () => {
  it("validates token shape, writes bilingual copy, and dry-runs without network", async () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc_DEF-123456789]")).toBe(true);
    expect(isExpoPushToken("not-a-token")).toBe(false);
    expect(PUSH_BATCH).toBe(100);
    const c = pushCopy("comment", { actor: "外婆", preview: "真好看", zh: true });
    expect(c.title).toBe("新评论");
    expect(c.body).toContain("外婆");
    expect(c.body).toContain("真好看");
    expect(pushCopy("anniversary", { preview: "金婚还有 7 天", zh: false }).body).toContain("金婚");
    const saved = process.env.PUSH_DRY_RUN;
    process.env.PUSH_DRY_RUN = "1";
    try {
      const tickets = await sendExpoPush([{ to: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", title: "t", body: "b" }]);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]!.status).toBe("ok");
    } finally {
      if (saved === undefined) delete process.env.PUSH_DRY_RUN;
      else process.env.PUSH_DRY_RUN = saved;
    }
  });
});

describe("P10 coordination (memory backend)", () => {
  it("locks are exclusive until released or expired", async () => {
    __resetLocalLocks();
    expect(coordinationBackend()).toBe("memory");
    const release = await acquireLock("t1", 60_000);
    expect(release).not.toBeNull();
    expect(await acquireLock("t1", 60_000)).toBeNull();
    await release!();
    const again = await acquireLock("t1", 60_000);
    expect(again).not.toBeNull();
    await again!();
    const expired = await acquireLock("t2", 1);
    await new Promise((r) => setTimeout(r, 5));
    const stolen = await acquireLock("t2", 1000);
    expect(stolen).not.toBeNull();
    await expired!();
    await stolen!();
  });

  it("withLock reports contention and runIfLeader only runs on the leader", async () => {
    __resetLocalLocks();
    let runs = 0;
    const [a, b] = await Promise.all([
      withLock("job", 1000, async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 20));
        return "a";
      }),
      new Promise<Awaited<ReturnType<typeof withLock>>>((resolve) => setTimeout(() => resolve(withLock("job", 1000, async () => "b")), 2)),
    ]);
    expect(runs).toBe(1);
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);

    // Not yet elected → skipped
    expect(schedulerLeader.isLeader).toBe(false);
    const skipped = await runIfLeader("x", 1000, async () => 1);
    expect(skipped).toEqual({ ran: false, reason: "not_leader" });
    // Memory mode: a tick makes this process leader
    expect(await schedulerLeader.tick()).toBe(true);
    const ran = await runIfLeader("x", 1000, async () => 42);
    expect(ran).toEqual({ ran: true, result: 42 });
    await schedulerLeader.stop();
    expect(schedulerLeader.isLeader).toBe(false);

    const other = new LeaderElection("unit", 1000, 100);
    expect(other.status()).toMatchObject({ name: "unit", isLeader: false, backend: "memory" });
    await other.tick();
    expect(other.isLeader).toBe(true);
    await other.stop();
  });
});

describe("P10 WebDAV target", () => {
  it("normalises folder URLs and round-trips sealed secrets", () => {
    expect(normalizeDavUrl("https://dav.jianguoyun.com/dav/GoldenMemory?x=1#f")).toBe("https://dav.jianguoyun.com/dav/GoldenMemory/");
    expect(normalizeDavUrl("https://user:pw@host/dav/")).toBeNull();
    expect(normalizeDavUrl("ftp://host/dav/")).toBeNull();
    const sealed = sealSecret("app-password-✓");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("app-password");
    expect(openSecret(sealed)).toBe("app-password-✓");
    expect(sealSecret("same")).not.toBe(sealSecret("same")); // random IV
    expect(() => openSecret("v1.bad")).toThrow();
  });
});

describe("P10 anniversary reminders", () => {
  it("computes days-until and the next-occurrence anniversary number", () => {
    const today = new Date("2026-06-10T00:00:00Z");
    const wedding = new Date("1976-06-17T00:00:00Z");
    expect(daysUntilAnniversary(wedding, today)).toBe(7);
    expect(daysUntilAnniversary(new Date("1976-06-10T00:00:00Z"), today)).toBe(0);
    expect(daysUntilAnniversary(new Date("1976-06-09T00:00:00Z"), today)).toBe(364);
    expect(nextOccurrenceYear(wedding, today)).toBe(2026);
    expect(nextOccurrenceYear(new Date("1976-01-01T00:00:00Z"), today)).toBe(2027);
    const text = reminderPreview({ type: "golden", couple: "爷爷奶奶", date: wedding }, 7, today);
    expect(text).toContain("金婚");
    expect(text).toContain("还有 7 天");
    expect(text).toContain("50 周年");
    expect(reminderPreview({ type: "silver", couple: "A", date: wedding }, 0, today)).toContain("就是今天");
    expect(REMINDER_DAYS_BEFORE).toBeGreaterThanOrEqual(1);
  });
});

describe("P10 storage keys + caps", () => {
  it("music keys are owner-scoped and backup / music caps are sane", async () => {
    const key = buildMusicKey(5, "MP3");
    expect(key).toMatch(/^users\/5\/music\/[0-9a-f-]{36}\.mp3$/);
    expect(parseStorageKey(key)).toEqual({ kind: "music", userId: 5 });
    expect(await canAccessStorageKey(5, key)).toBe(true);
    expect(await canAccessStorageKey(6, key)).toBe(false);
    expect(buildBackupKey(1, new Date("2026-01-02T03:04:05.000Z"), "zip")).toBe("users/1/backups/2026-01-02T03-04-05-000Z.zip");
    expect(MUSIC_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(MUSIC_CONTENT_TYPES).toContain("audio/mpeg");
    expect(BACKUP_FILE_MAX_BYTES).toBeLessThanOrEqual(BACKUP_ZIP_MAX_BYTES);
  });
});

/* ------------------------------------------------------------------ */
/* P11                                                                 */
/* ------------------------------------------------------------------ */

import { normalizeS3Endpoint, parseTargetConfig, signS3Request, TARGET_LABELS } from "../server/_core/remoteTargets";
import { isSafeEntryName, parseBackupArtefact, RESTORE_MAX_ITEMS } from "../server/restoreService";
import { pushRoute } from "../server/_core/push";
import { isSafeInternalRoute } from "../lib/push-route";
import * as archiverNs from "archiver";
import type { Archiver } from "archiver";

describe("P11 S3 SigV4", () => {
  it("produces the documented AWS example signature (GET object, empty payload)", () => {
    // AWS SigV4 test vector: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
    const h = signS3Request({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      canonicalPath: "/test.txt",
      region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h["x-amz-date"]).toBe("20130524T000000Z");
    expect(h.Authorization).toContain("Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request");
    expect(h.Authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
    // Deterministic for the same inputs; differs with a different secret.
    const again = signS3Request({ method: "GET", host: "examplebucket.s3.amazonaws.com", canonicalPath: "/test.txt", region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", now: new Date("2013-05-24T00:00:00Z") });
    expect(again.Authorization).toBe(h.Authorization);
    const other = signS3Request({ method: "GET", host: "examplebucket.s3.amazonaws.com", canonicalPath: "/test.txt", region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "different", payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", now: new Date("2013-05-24T00:00:00Z") });
    expect(other.Authorization).not.toBe(h.Authorization);
    expect(/Signature=[0-9a-f]{64}$/.test(h.Authorization)).toBe(true);
  });

  it("normalises endpoints and parses target config defensively", () => {
    expect(normalizeS3Endpoint("https://s3.us-east-1.amazonaws.com/some/path?x=1")).toBe("https://s3.us-east-1.amazonaws.com");
    expect(normalizeS3Endpoint("https://ak:sk@minio.local")).toBeNull();
    expect(normalizeS3Endpoint("not a url")).toBeNull();
    expect(parseTargetConfig('{"bucket":"b","pathStyle":true}')).toEqual({ bucket: "b", pathStyle: true });
    expect(parseTargetConfig("garbage")).toEqual({});
    expect(parseTargetConfig(null)).toEqual({});
    expect(TARGET_LABELS.gdrive.en).toBe("Google Drive");
  });
});

describe("P11 restore", () => {
  it("parses json and zip artefacts, rejects garbage, and guards entry names", async () => {
    const manifest = { exportedAt: "2026-01-01T00:00:00.000Z", count: 1, items: [{ id: 7, type: "photo", title: "t", description: null, albumId: 1, albumName: "A", fileSize: 10, duration: null, createdAt: "2026-01-01T00:00:00.000Z" }] };
    const json = parseBackupArtefact(Buffer.from(JSON.stringify(manifest)));
    expect(json.format).toBe("json");
    expect(json.manifest.items[0]!.id).toBe(7);

    const archiver = ((archiverNs as unknown as { default?: unknown }).default ?? archiverNs) as unknown as (f: "zip") => Archiver;
    const a = archiver("zip");
    const chunks: Buffer[] = [];
    a.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((r) => a.on("end", () => r()));
    a.append(JSON.stringify({ ...manifest, items: [{ ...manifest.items[0], file: "media/A/7_t.jpg" }] }), { name: "manifest.json" });
    a.append(Buffer.from("fakejpg"), { name: "media/A/7_t.jpg" });
    await a.finalize();
    await done;
    const zip = parseBackupArtefact(Buffer.concat(chunks));
    expect(zip.format).toBe("zip");
    expect(zip.zip!.getEntry("media/A/7_t.jpg")!.getData().toString()).toBe("fakejpg");

    expect(() => parseBackupArtefact(Buffer.from("not json"))).toThrow(/neither/);
    expect(() => parseBackupArtefact(Buffer.from(JSON.stringify({ items: [{ id: "x", type: "photo" }] })))).toThrow(/Malformed/);
    expect(isSafeEntryName("media/Album/1_x.jpg")).toBe(true);
    expect(isSafeEntryName("media/../etc/passwd")).toBe(false);
    expect(isSafeEntryName("/media/a/b.jpg")).toBe(false);
    expect(isSafeEntryName("media/a/b/c.jpg")).toBe(false);
    expect(RESTORE_MAX_ITEMS).toBeGreaterThan(100);
  });
});

describe("P11 push deep links", () => {
  it("maps notification types to in-app routes and rejects unsafe routes", () => {
    expect(pushRoute("comment", { mediaId: 5, commentId: 9 })).toBe("/photo/5?commentId=9");
    expect(pushRoute("like", { mediaId: 5 })).toBe("/photo/5");
    expect(pushRoute("upload", { albumId: 3 })).toBe("/album?albumId=3");
    expect(pushRoute("upload", {})).toBe("/(tabs)/album");
    expect(pushRoute("invite", {})).toBe("/members");
    expect(pushRoute("anniversary", {})).toBe("/anniversary");
    expect(pushRoute("system", {})).toBe("/(tabs)/messages");
    expect(isSafeInternalRoute("/photo/5")).toBe(true);
    expect(isSafeInternalRoute("//evil.com")).toBe(false);
    expect(isSafeInternalRoute("https://evil.com")).toBe(false);
    expect(isSafeInternalRoute(42)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* P12                                                                 */
/* ------------------------------------------------------------------ */
import { ALERT_MIN_RATE, __resetAlertState, alertCandidates, alertEmail, type MetricSummary } from "../server/_core/metrics";
import { inQuietHours, localMinutes, pushSuppressReason } from "../server/_core/push";
import { filterManifestAlbums } from "../server/restoreService";

describe("P12 metrics alerts", () => {
  const mk = (kind: MetricSummary["kind"], ok: number, total: number): MetricSummary => ({
    kind,
    ok,
    total,
    rate: total ? ok / total : null,
    avgMs: null,
    lastFailure: ok < total ? { at: new Date("2026-11-11T00:00:00Z"), detail: "boom" } : null,
  });

  it("flags only kinds below the rate with enough samples", () => {
    __resetAlertState();
    const summary = [mk("push", 2, 10), mk("mail", 9, 10), mk("sms", 0, 2), mk("backup", 0, 0)];
    const bad = alertCandidates(summary, { minRate: 0.8, minSamples: 5 });
    expect(bad.map((b) => b.kind)).toEqual(["push"]);
    expect(ALERT_MIN_RATE).toBeGreaterThan(0);
    expect(ALERT_MIN_RATE).toBeLessThanOrEqual(1);
  });

  it("builds a readable alert email", () => {
    const { subject, text } = alertEmail([mk("push", 2, 10)], 6);
    expect(subject).toContain("push");
    expect(subject).toContain("告警");
    expect(text).toContain("2/10");
    expect(text).toContain("boom");
    expect(text).toContain("6 小时");
  });
});

describe("P12 quiet hours + mutes", () => {
  const prefs = { pushEnabled: true, quietStart: 22 * 60, quietEnd: 7 * 60, quietTz: "Asia/Shanghai", pushMutedTypes: null, pushMutedFamilies: null };

  it("computes local minutes in the given zone", () => {
    const t = new Date("2026-11-11T15:30:00Z"); // 23:30 in Shanghai
    expect(localMinutes(t, "Asia/Shanghai")).toBe(23 * 60 + 30);
    expect(localMinutes(t, "UTC")).toBe(15 * 60 + 30);
    expect(localMinutes(t, "Not/AZone")).toBe(15 * 60 + 30); // falls back to UTC
  });

  it("handles windows that wrap midnight", () => {
    expect(inQuietHours(prefs, new Date("2026-11-11T15:30:00Z"))).toBe(true); // 23:30 CST
    expect(inQuietHours(prefs, new Date("2026-11-11T20:00:00Z"))).toBe(true); // 04:00 CST
    expect(inQuietHours(prefs, new Date("2026-11-11T04:00:00Z"))).toBe(false); // 12:00 CST
    expect(inQuietHours({ ...prefs, quietStart: null }, new Date())).toBe(false);
    expect(inQuietHours({ ...prefs, quietStart: 600, quietEnd: 600 }, new Date())).toBe(false);
  });

  it("orders suppression reasons and lets invites/system through", () => {
    const night = new Date("2026-11-11T15:30:00Z");
    expect(pushSuppressReason({ ...prefs, pushEnabled: false }, "like", 1, night)).toBe("disabled");
    expect(pushSuppressReason(prefs, "invite", 1, night)).toBeNull();
    expect(pushSuppressReason(prefs, "system", 1, night)).toBeNull();
    expect(pushSuppressReason({ ...prefs, pushMutedTypes: JSON.stringify(["like"]) }, "like", 1, night)).toBe("type");
    expect(pushSuppressReason({ ...prefs, pushMutedFamilies: JSON.stringify([7]) }, "comment", 7, night)).toBe("family");
    expect(pushSuppressReason({ ...prefs, pushMutedFamilies: JSON.stringify([7]) }, "comment", 8, night)).toBe("quiet");
    expect(pushSuppressReason({ ...prefs, pushMutedTypes: "{not json" }, "comment", 8, new Date("2026-11-11T04:00:00Z"))).toBeNull();
  });
});

describe("P12 selective restore", () => {
  const parsed = {
    format: "json" as const,
    zip: null,
    manifest: {
      count: 3,
      items: [
        { id: 1, albumName: "旅行" },
        { id: 2, albumName: " 旅行 " },
        { id: 3, albumName: null },
      ],
    } as any,
  };

  it("keeps everything when no filter", () => {
    expect(filterManifestAlbums(parsed, null).manifest.items).toHaveLength(3);
    expect(filterManifestAlbums(parsed, []).manifest.items).toHaveLength(3);
  });

  it("narrows to the chosen albums (trimmed, default bucket)", () => {
    const a = filterManifestAlbums(parsed, ["旅行"]);
    expect(a.manifest.items.map((i: any) => i.id)).toEqual([1, 2]);
    expect(a.manifest.count).toBe(2);
    const b = filterManifestAlbums(parsed, ["已恢复的照片"]);
    expect(b.manifest.items.map((i: any) => i.id)).toEqual([3]);
    expect(parsed.manifest.items).toHaveLength(3); // input untouched
  });
});

describe("P12 S3 listing signature", () => {
  it("includes the canonical query deterministically", () => {
    const base = {
      method: "GET" as const,
      host: "bucket.s3.amazonaws.com",
      canonicalPath: "/",
      region: "us-east-1",
      accessKey: "AKIA",
      secretKey: "secret",
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      now: new Date("2026-11-11T00:00:00Z"),
    };
    const a = signS3Request({ ...base, canonicalQuery: "list-type=2&prefix=gm%2F" });
    const b = signS3Request({ ...base, canonicalQuery: "list-type=2&prefix=gm%2F" });
    const c = signS3Request({ ...base, canonicalQuery: "list-type=2&prefix=other%2F" });
    expect(a.Authorization).toBe(b.Authorization);
    expect(a.Authorization).not.toBe(c.Authorization);
    expect(a.Authorization).toContain("AWS4-HMAC-SHA256");
  });
});

/* ------------------------------------------------------------------ */
/* P13                                                                 */
/* ------------------------------------------------------------------ */
import { buildChannelBody, dingtalkSign, validateChannelUrl } from "../server/_core/alertChannels";
import { defaultRule, evaluateRules, type EffectiveRule } from "../server/_core/metrics";
import { copyVariantB, copyVariantFor, digestCopy, digestDue, wantsDigest } from "../server/_core/pushDigest";
import { COPY_SUFFIX, parseRestoreOptions, resolveAlbumName, sha256 } from "../server/restoreService";
import { remoteRetryDelayMs } from "../server/backupService";
import { canUndo, ledgerRowCount, mergeAuditCsv, type MergeLedger } from "../server/mergeService";

describe("P13 alert channels", () => {
  it("validates vendor URLs by host and requires https", () => {
    expect(validateChannelUrl("slack", "https://hooks.slack.com/services/T/B/x")).toMatchObject({ ok: true });
    expect(validateChannelUrl("slack", "https://evil.example/hooks")).toMatchObject({ ok: false });
    expect(validateChannelUrl("wecom", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k")).toMatchObject({ ok: true });
    expect(validateChannelUrl("dingtalk", "https://oapi.dingtalk.com/robot/send?access_token=t")).toMatchObject({ ok: true });
    expect(validateChannelUrl("webhook", "http://example.com/hook")).toMatchObject({ ok: false });
    expect(validateChannelUrl("webhook", "not a url")).toMatchObject({ ok: false });
  });

  it("signs DingTalk URLs with timestamp + HMAC-SHA256", () => {
    const u = new URL(dingtalkSign("https://oapi.dingtalk.com/robot/send?access_token=t", "SEC", 1_700_000_000_000));
    expect(u.searchParams.get("timestamp")).toBe("1700000000000");
    expect(u.searchParams.get("sign")).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(u.searchParams.get("access_token")).toBe("t");
    // deterministic
    expect(dingtalkSign("https://oapi.dingtalk.com/robot/send?access_token=t", "SEC", 1_700_000_000_000)).toBe(u.toString());
  });

  it("builds vendor-specific bodies", () => {
    const p = { title: "T", text: "line1\nline2", kinds: ["push"], at: new Date("2026-11-11T00:00:00Z") };
    expect(buildChannelBody("slack", p)).toMatchObject({ text: "T\nline1\nline2" });
    expect((buildChannelBody("slack", p) as { blocks: unknown[] }).blocks).toHaveLength(3);
    expect(buildChannelBody("wecom", p)).toMatchObject({ msgtype: "markdown" });
    expect((buildChannelBody("dingtalk", p) as { markdown: { title: string } }).markdown.title).toBe("T");
    expect(buildChannelBody("webhook", p)).toMatchObject({ source: "golden-memory", kinds: ["push"], at: "2026-11-11T00:00:00.000Z" });
  });
});

describe("P13 per-kind alert rules", () => {
  const sum = (kind: string, ok: number, total: number) => ({ kind: kind as never, ok, total, rate: total ? ok / total : null, avgMs: null, lastFailure: null });
  it("honours enabled / silence / per-rule window", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const rules: EffectiveRule[] = [
      { ...defaultRule("push"), minRate: 0.9, minSamples: 5, windowHours: 6 },
      { ...defaultRule("mail"), enabled: false },
      { ...defaultRule("sms"), silencedUntil: new Date("2026-11-11T13:00:00Z") },
      { ...defaultRule("backup"), windowHours: 24, minRate: 0.5, minSamples: 2 },
    ];
    const byWindow = (w: number) => (w === 6 ? [sum("push", 8, 10), sum("mail", 0, 10), sum("sms", 0, 10)] : w === 24 ? [sum("backup", 0, 3)] : undefined);
    const bad = evaluateRules(byWindow, rules, now);
    expect(bad.map((b) => b.kind).sort()).toEqual(["backup", "push"]);
    // silence expires
    expect(evaluateRules(byWindow, rules, new Date("2026-11-11T14:00:00Z")).map((b) => b.kind).sort()).toEqual(["backup", "push", "sms"]);
  });
});

describe("P13 push digest + A/B", () => {
  it("decides which types are digested", () => {
    expect(wantsDigest({ pushDigest: "daily" }, "like")).toBe(true);
    expect(wantsDigest({ pushDigest: "daily" }, "invite")).toBe(false);
    expect(wantsDigest({ pushDigest: "daily" }, "anniversary")).toBe(false);
    expect(wantsDigest({ pushDigest: "off" }, "like")).toBe(false);
  });

  it("is due only at the configured local hour with spacing", () => {
    const base = { pushDigest: "daily" as const, pushDigestHour: 20, quietTz: "Asia/Shanghai", lastDigestAt: null };
    expect(digestDue(base, new Date("2026-11-11T12:30:00Z"))).toBe(true); // 20:30 CST
    expect(digestDue(base, new Date("2026-11-11T13:30:00Z"))).toBe(false); // 21:30 CST
    expect(digestDue({ ...base, lastDigestAt: new Date("2026-11-11T02:00:00Z") }, new Date("2026-11-11T12:30:00Z"))).toBe(false); // <20h ago
    // weekly → Sunday only (2026-11-15 is a Sunday)
    expect(digestDue({ ...base, pushDigest: "weekly" }, new Date("2026-11-11T12:30:00Z"))).toBe(false);
    expect(digestDue({ ...base, pushDigest: "weekly" }, new Date("2026-11-15T12:30:00Z"))).toBe(true);
  });

  it("summarises queued rows into one line", () => {
    const rows = [
      { type: "like" as const, actorName: "妈妈" },
      { type: "like" as const, actorName: "小雅" },
      { type: "comment" as const, actorName: "妈妈" },
      { type: "upload" as const, actorName: null },
    ];
    const zh = digestCopy(rows, "daily", true);
    expect(zh.title).toBe("今日家庭动态");
    expect(zh.body).toBe("2 赞 · 1 评论 · 1 新照片 — 来自 妈妈、小雅");
    const en = digestCopy(rows, "weekly", false);
    expect(en.title).toBe("This week in your family");
    expect(en.body).toContain("2 likes");
  });

  it("assigns a stable variant and only when the experiment is on", () => {
    delete process.env.PUSH_COPY_EXPERIMENT;
    expect(copyVariantFor(1)).toBe("A");
    process.env.PUSH_COPY_EXPERIMENT = "1";
    const v1 = copyVariantFor(1);
    expect(copyVariantFor(1)).toBe(v1);
    const dist = new Set(Array.from({ length: 50 }, (_, i) => copyVariantFor(i + 1)));
    expect(dist.size).toBe(2);
    delete process.env.PUSH_COPY_EXPERIMENT;
    expect(copyVariantB("like", { actor: "妈妈" })?.title).toContain("妈妈");
    expect(copyVariantB("invite", {})).toBeNull();
  });
});

describe("P13 restore strategy", () => {
  it("parses options with safe defaults", () => {
    expect(parseRestoreOptions(null)).toEqual({ albumConflict: "merge", dedupeByHash: true });
    expect(parseRestoreOptions('{"albumConflict":"copy","dedupeByHash":false}')).toEqual({ albumConflict: "copy", dedupeByHash: false });
    expect(parseRestoreOptions('{"albumConflict":"nope"}')).toMatchObject({ albumConflict: "merge" });
    expect(parseRestoreOptions("{bad json")).toEqual({ albumConflict: "merge", dedupeByHash: true });
  });
  it("resolves the target album per strategy", () => {
    expect(resolveAlbumName("旅行", false, "skip")).toBe("旅行");
    expect(resolveAlbumName("旅行", true, "merge")).toBe("旅行");
    expect(resolveAlbumName("旅行", true, "copy")).toBe(`旅行${COPY_SUFFIX}`);
    expect(resolveAlbumName("旅行", true, "skip")).toBeNull();
  });
  it("hashes content with sha256", () => {
    expect(sha256(Buffer.from(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("P13 remote retry backoff", () => {
  it("grows 3x per attempt and caps at 24h", () => {
    expect(remoteRetryDelayMs(1)).toBe(5 * 60_000);
    expect(remoteRetryDelayMs(2)).toBe(15 * 60_000);
    expect(remoteRetryDelayMs(3)).toBe(45 * 60_000);
    expect(remoteRetryDelayMs(10)).toBe(24 * 3_600_000);
  });
});

describe("P13 merge undo + audit CSV", () => {
  it("knows when a merge can still be undone", () => {
    const now = new Date("2026-11-11T00:00:00Z");
    expect(canUndo({ undoDeadline: new Date("2026-11-20T00:00:00Z"), undoneAt: null, purgedAt: null }, now)).toBe(true);
    expect(canUndo({ undoDeadline: new Date("2026-11-01T00:00:00Z"), undoneAt: null, purgedAt: null }, now)).toBe(false);
    expect(canUndo({ undoDeadline: new Date("2026-11-20T00:00:00Z"), undoneAt: now, purgedAt: null }, now)).toBe(false);
    expect(canUndo({ undoDeadline: null, undoneAt: null, purgedAt: null }, now)).toBe(false);
  });
  it("counts ledger rows", () => {
    const ledger: MergeLedger = { v: 1, repointed: { media: { column: "uploadedBy", ids: [1, 2, 3] }, albums: { column: "createdBy", ids: [9] } }, membershipsDropped: [{ familyId: 1, role: "editor", joinedAt: "2026-01-01T00:00:00Z" }], rolesRaised: [], likesDropped: [{ mediaId: 1, createdAt: "2026-01-01T00:00:00Z" }], targetPatched: [], source: { email: "a@b.c", phone: null, phoneVerifiedAt: null, openId: "x" }, sourcePreferences: null, backupTargetsMoved: [4], backupTargetsDropped: 0 };
    expect(ledgerRowCount(ledger)).toBe(7);
  });
  it("renders CSV with flattened moved counts and escaping", () => {
    const csv = mergeAuditCsv([
      { id: 1, targetUserId: 10, sourceUserId: 20, sourceEmail: 'weird,"name"@x.y', sourcePhone: null, moved: JSON.stringify({ media: 3, albums: 1 }), undoDeadline: new Date("2026-11-20T00:00:00Z"), undoneAt: null, purgedAt: null, createdAt: new Date("2026-11-11T00:00:00Z") },
      { id: 2, targetUserId: 10, sourceUserId: 21, sourceEmail: "b@x.y", sourcePhone: "+8613800138000", moved: JSON.stringify({ media: 0 }), undoDeadline: null, undoneAt: new Date("2026-11-12T00:00:00Z"), purgedAt: null, createdAt: new Date("2026-11-11T01:00:00Z") },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("id,createdAt,targetUserId,sourceUserId,sourceEmail,sourcePhone,status,undoDeadline,undoneAt,purgedAt,moved_albums,moved_media");
    expect(lines[1]).toContain('"weird,""name""@x.y"');
    expect(lines[1]).toContain(",merged,");
    expect(lines[1].endsWith(",1,3")).toBe(true);
    expect(lines[2]).toContain(",undone,");
    expect(lines[2].endsWith(",0,0")).toBe(true);
  });
});

// ───────────────────────── P14: escalation · visual restore · personalized digests · quota/retention · merge wizard ─────────────────────────
import { appendTimeline, escalationDue, MAX_TIER, nextTier, parseTimeline } from "../server/_core/alertIncidents";
import { __setPromotedWinner, decideWinner, groupByFamily, PUSH_COPY_EXPERIMENT, smartHourFrom } from "../server/_core/pushDigest";
import { filterManifestItems } from "../server/restoreService";
import { entriesToPrune, estimateMonthlyUsd, S3_STORAGE_CLASSES, type RemoteEntry } from "../server/_core/remoteTargets";
import { defaultChoice, resolveChoices } from "../server/mergeService";

describe("P14 alert escalation chain", () => {
  const opened = new Date("2026-11-11T00:00:00Z");
  const at = (min: number) => new Date(opened.getTime() + min * 60_000);
  it("escalates to tier 2 after N minutes and tier 3 after 2N, capped at MAX_TIER", () => {
    const inc = { tier: 1, openedAt: opened, status: "open" as const };
    expect(nextTier(inc, at(5), 30)).toBe(1);
    expect(nextTier(inc, at(30), 30)).toBe(2);
    expect(nextTier(inc, at(61), 30)).toBe(3);
    expect(nextTier(inc, at(10_000), 30)).toBe(MAX_TIER);
    expect(escalationDue(inc, at(29), 30)).toBe(false);
    expect(escalationDue(inc, at(31), 30)).toBe(true);
  });
  it("never lowers the tier and freezes once acked / resolved", () => {
    expect(nextTier({ tier: 3, openedAt: opened, status: "open" }, at(1), 30)).toBe(3);
    expect(nextTier({ tier: 1, openedAt: opened, status: "acked" }, at(500), 30)).toBe(1);
    expect(escalationDue({ tier: 1, openedAt: opened, status: "resolved" }, at(500), 30)).toBe(false);
  });
  it("keeps a bounded JSON timeline and tolerates garbage", () => {
    let raw = appendTimeline(null, { event: "opened", at: opened });
    raw = appendTimeline(raw, { event: "escalated", detail: "tier 2", at: at(30) });
    raw = appendTimeline(raw, { event: "acked", by: 7, detail: "on it", at: at(35) });
    const tl = parseTimeline(raw);
    expect(tl.map((e) => e.event)).toEqual(["opened", "escalated", "acked"]);
    expect(tl[2]).toMatchObject({ by: 7, detail: "on it", at: at(35).toISOString() });
    expect(tl[0]!.by).toBeNull();
    expect(parseTimeline("not json")).toEqual([]);
    expect(parseTimeline(JSON.stringify({ a: 1 }))).toEqual([]);
    let big: string | null = null;
    for (let i = 0; i < 250; i++) big = appendTimeline(big, { event: "note", detail: String(i) });
    expect(parseTimeline(big).length).toBe(200);
    expect(parseTimeline(big)[0]!.detail).toBe("50");
  });
});

describe("P14 digest personalization + A/B auto-promotion", () => {
  it("decides a winner only with enough sends, significance and lift", () => {
    expect(decideWinner({ sentA: 50, sentB: 500, openA: 10, openB: 200 }, 200, 0.15)).toBeNull(); // arm A under-powered
    expect(decideWinner({ sentA: 500, sentB: 500, openA: 0, openB: 0 }, 200, 0.15)).toBeNull();
    expect(decideWinner({ sentA: 500, sentB: 500, openA: 100, openB: 105 }, 200, 0.15)).toBeNull(); // not significant
    expect(decideWinner({ sentA: 500, sentB: 500, openA: 100, openB: 160 }, 200, 0.15)).toBe("B");
    expect(decideWinner({ sentA: 500, sentB: 500, openA: 160, openB: 100 }, 200, 0.15)).toBe("A");
    // significant but tiny relative lift is rejected by minLift
    expect(decideWinner({ sentA: 100_000, sentB: 100_000, openA: 50_000, openB: 51_500 }, 200, 0.15)).toBeNull();
  });
  it("promoted winner overrides the hashed assignment for everyone", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const prev = process.env.PUSH_COPY_EXPERIMENT;
    process.env.PUSH_COPY_EXPERIMENT = "1";
    try {
      const before = ids.map((id) => copyVariantFor(id, PUSH_COPY_EXPERIMENT));
      expect(new Set(before).size).toBe(2);
      __setPromotedWinner(PUSH_COPY_EXPERIMENT, "B");
      expect(ids.every((id) => copyVariantFor(id, PUSH_COPY_EXPERIMENT) === "B")).toBe(true);
      __setPromotedWinner(PUSH_COPY_EXPERIMENT, null);
      expect(ids.map((id) => copyVariantFor(id, PUSH_COPY_EXPERIMENT))).toEqual(before);
    } finally {
      __setPromotedWinner(PUSH_COPY_EXPERIMENT, null);
      if (prev === undefined) delete process.env.PUSH_COPY_EXPERIMENT;
      else process.env.PUSH_COPY_EXPERIMENT = prev;
    }
    expect(copyVariantFor(3, PUSH_COPY_EXPERIMENT)).toBe("A"); // experiment off → everyone on A
  });
  it("learns the most frequent local open hour (ties → earliest, too few → null)", () => {
    const utc = (h: number) => new Date(Date.UTC(2026, 10, 11, h, 15));
    const opens = [utc(12), utc(12), utc(12), utc(3), utc(20), utc(20)];
    expect(smartHourFrom(opens, "UTC", 5)).toBe(12);
    expect(smartHourFrom(opens, "Asia/Shanghai", 5)).toBe(20); // 12 UTC → 20:15 CST
    expect(smartHourFrom([utc(1), utc(1), utc(2), utc(2)], "UTC", 3)).toBe(1);
    expect(smartHourFrom(opens.slice(0, 3), "UTC", 5)).toBeNull();
  });
  it("groups queued rows by family and titles digests with the family name", () => {
    const groups = groupByFamily([
      { familyId: 1, type: "like" },
      { familyId: null, type: "share" },
      { familyId: 1, type: "comment" },
      { familyId: 2, type: "upload" },
    ] as Array<{ familyId: number | null; type: string }>);
    expect(groups.map((g) => g.familyId)).toEqual([1, null, 2]);
    expect(groups[0]!.rows.length).toBe(2);
    const zh = digestCopy([{ type: "like", actorName: "奶奶" }], "daily", true, "王家");
    expect(zh.title).toBe("今日家庭动态 · 王家");
    const en = digestCopy([{ type: "like", actorName: "Grandma" }], "weekly", false, "Wangs");
    expect(en.title).toBe("This week in your family · Wangs");
    expect(digestCopy([{ type: "like", actorName: null }], "daily", true, null).title).toBe("今日家庭动态");
  });
});

describe("P14 restore per-item selection", () => {
  const parsed = parseBackupArtefact(Buffer.from(JSON.stringify({ version: 1, familyId: 1, exportedAt: "2026-11-11T00:00:00Z", count: 3, items: [
    { id: 11, type: "photo", url: "https://x/a.jpg", albumName: "A", createdAt: "2026-01-01T00:00:00Z" },
    { id: 12, type: "photo", url: "https://x/b.jpg", albumName: "B", createdAt: "2026-01-01T00:00:00Z" },
    { id: 13, type: "video", url: "https://x/c.mp4", albumName: "A", createdAt: "2026-01-01T00:00:00Z" },
  ] })));
  it("narrows the manifest to the chosen ids and updates count", () => {
    const sub = filterManifestItems(parsed, [13, 11, 999]);
    expect(sub.manifest.items.map((i) => i.id)).toEqual([11, 13]);
    expect(sub.manifest.count).toBe(2);
    expect(filterManifestItems(parsed, null)).toBe(parsed);
    expect(filterManifestItems(parsed, [])).toBe(parsed);
    expect(parsed.manifest.items.length).toBe(3); // input untouched
  });
  it("composes with album filtering", () => {
    const sub = filterManifestItems(filterManifestAlbums(parsed, ["A"]), [11]);
    expect(sub.manifest.items.map((i) => i.id)).toEqual([11]);
  });
});

describe("P14 target retention · storage class · cost", () => {
  const e = (name: string, day: number, format: RemoteEntry["format"] = "zip"): RemoteEntry => ({ key: name, name, bytes: 1, modifiedAt: new Date(Date.UTC(2026, 0, day)), format });
  it("prunes everything beyond the newest N backups, ignoring foreign files", () => {
    const entries = [e("b.zip", 2), e("readme.txt", 9, "other"), e("a.zip", 1), e("d.json", 4), e("c.zip", 3)];
    expect(entriesToPrune(entries, 2).map((x) => x.name)).toEqual(["b.zip", "a.zip"]);
    expect(entriesToPrune(entries, 10)).toEqual([]);
    expect(entriesToPrune(entries, null)).toEqual([]);
    expect(entriesToPrune(entries, 0)).toEqual([]);
  });
  it("estimates monthly cost per S3 storage class", () => {
    const gb = 1024 ** 3;
    expect(estimateMonthlyUsd(100 * gb, "STANDARD")).toBeCloseTo(2.3, 2);
    expect(estimateMonthlyUsd(100 * gb, "DEEP_ARCHIVE")).toBeCloseTo(0.099, 3);
    expect(estimateMonthlyUsd(100 * gb, "WEIRD")).toBeNull();
    expect(estimateMonthlyUsd(100 * gb, null)).toBeNull();
    expect(S3_STORAGE_CLASSES).toContain("GLACIER");
  });
  it("signs extra headers (storage class) and DELETE deterministically", () => {
    const base = { host: "b.s3.amazonaws.com", canonicalPath: "/k.zip", region: "us-east-1", accessKey: "AK", secretKey: "SK", payloadHash: "UNSIGNED-PAYLOAD", now: new Date("2026-01-01T00:00:00Z") } as const;
    const put = signS3Request({ ...base, method: "PUT", extraHeaders: { "X-Amz-Storage-Class": "GLACIER" } });
    expect(put["x-amz-storage-class"]).toBe("GLACIER");
    expect(put.Authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-storage-class");
    const plain = signS3Request({ ...base, method: "PUT" });
    expect(plain.Authorization).not.toBe(put.Authorization);
    const del = signS3Request({ ...base, method: "DELETE" });
    expect(del.Authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(del.Authorization).not.toBe(signS3Request({ ...base, method: "GET" }).Authorization);
  });
});

describe("P14 merge wizard choices", () => {
  it("defaults to the side holding the higher role", () => {
    expect(defaultChoice("owner", "member")).toBe("target");
    expect(defaultChoice("member", "admin")).toBe("source");
    expect(defaultChoice("member", "member")).toBe("target");
    expect(defaultChoice("member", "unknown-role")).toBe("target");
  });
  it("applies explicit choices, ignores unknown families and bad values", () => {
    const conflicts = [
      { familyId: 1, targetRole: "owner", sourceRole: "member" },
      { familyId: 2, targetRole: "member", sourceRole: "admin" },
      { familyId: 3, targetRole: "member", sourceRole: "member" },
    ];
    const r = resolveChoices(conflicts, { "1": "source", "2": "target", "3": "banana" as never, "99": "source" });
    expect([...r.entries()]).toEqual([[1, "source"], [2, "target"], [3, "target"]]);
    expect(r.has(99)).toBe(false);
    const d = resolveChoices(conflicts, null);
    expect([...d.values()]).toEqual(["target", "source", "target"]);
  });
});

// ───────────────────────── P15: on-call · orphans · highlights · copy jobs · ownership audit ─────────────────────────
import { localClock, pickOnDuty, rosterPreview, shiftCovers } from "../server/_core/onCall";
import { diffOrphans, familyOfKey } from "../server/storageOrphans";
import { highlightsCaption, pickHighlights, type HighlightCandidate } from "../server/_core/pushDigest";
import { copyJobProgress, needsDeferredVerify, planCopyKeys } from "../server/targetCopyService";
import { ledgerToProvenance, ownershipAuditCsv } from "../server/mergeService";

describe("P15 on-call roster", () => {
  const base = { kind: "weekly", startsAt: null, endsAt: null, enabled: true, order: 0, tier: 1 } as const;
  // 2026-11-11 is a Wednesday
  const wed10 = new Date("2026-11-11T02:00:00Z"); // 10:00 Asia/Shanghai
  const wed23 = new Date("2026-11-11T15:00:00Z"); // 23:00 Asia/Shanghai
  const thu02 = new Date("2026-11-11T18:00:00Z"); // Thu 02:00 Asia/Shanghai
  it("resolves local weekday/hour in a zone", () => {
    expect(localClock(wed10, "Asia/Shanghai")).toEqual({ weekday: 3, hour: 10 });
    expect(localClock(thu02, "Asia/Shanghai").weekday).toBe(4);
    expect(localClock(wed10, "not/a-zone").weekday).toBe(3); // falls back to UTC
  });
  it("covers day shifts, wraps past midnight, honours range + enabled", () => {
    const day = { ...base, userId: 1, weekday: 3, startHour: 9, endHour: 18, tz: "Asia/Shanghai" };
    const night = { ...base, userId: 2, weekday: 3, startHour: 22, endHour: 6, tz: "Asia/Shanghai" };
    expect(shiftCovers(day, wed10)).toBe(true);
    expect(shiftCovers(day, wed23)).toBe(false);
    expect(shiftCovers(night, wed23)).toBe(true);
    expect(shiftCovers(night, thu02)).toBe(true); // next-day tail of a wrapped shift
    expect(shiftCovers(night, wed10)).toBe(false);
    expect(shiftCovers({ ...day, enabled: false }, wed10)).toBe(false);
    expect(shiftCovers({ ...day, startHour: 0, endHour: 0 }, wed23)).toBe(true); // whole day
    const range = { ...base, kind: "range" as const, userId: 3, weekday: null, startHour: 0, endHour: 24, tz: "UTC", startsAt: new Date("2026-11-11T00:00:00Z"), endsAt: new Date("2026-11-12T00:00:00Z") };
    expect(shiftCovers(range, wed10)).toBe(true);
    expect(shiftCovers(range, new Date("2026-11-12T00:00:00Z"))).toBe(false);
    expect(shiftCovers({ ...range, endsAt: null }, wed10)).toBe(false);
  });
  it("picks the lowest order among covering shifts for the tier only", () => {
    const shifts = [
      { ...base, userId: 1, weekday: 3, startHour: 0, endHour: 24, tz: "Asia/Shanghai", order: 5 },
      { ...base, userId: 2, weekday: 3, startHour: 9, endHour: 18, tz: "Asia/Shanghai", order: 1 },
      { ...base, userId: 9, weekday: 3, startHour: 0, endHour: 24, tz: "Asia/Shanghai", order: -1, tier: 2 },
    ];
    expect(pickOnDuty(shifts, 1, wed10)?.userId).toBe(2);
    expect(pickOnDuty(shifts, 1, wed23)?.userId).toBe(1);
    expect(pickOnDuty(shifts, 2, wed23)?.userId).toBe(9);
    expect(pickOnDuty(shifts, 3, wed23)).toBeNull();
  });
  it("roster preview collapses consecutive hours into segments", () => {
    const shifts = [{ ...base, userId: 2, weekday: 3, startHour: 9, endHour: 18, tz: "Asia/Shanghai" }];
    const from = new Date("2026-11-10T16:00:00Z"); // Wed 00:00 Asia/Shanghai
    const seg = rosterPreview(shifts, 1, from, 24, 1);
    expect(seg.map((s) => s.userId)).toEqual([null, 2, null]);
    expect(seg[1]!.at.toISOString()).toBe("2026-11-11T01:00:00.000Z"); // 09:00 CST
    expect(seg[2]!.at.toISOString()).toBe("2026-11-11T10:00:00.000Z"); // 18:00 CST
  });
});

describe("P15 storage orphans", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const obj = (key: string, hoursOld: number | null, bytes = 10) => ({ key, bytes, modifiedAt: hoursOld == null ? null : new Date(now.getTime() - hoursOld * 3_600_000) });
  it("flags unreferenced objects older than the grace period", () => {
    const objects = [obj("families/1/albums/2/a/x.jpg", 48), obj("families/1/albums/2/b/y.jpg", 48), obj("families/1/albums/2/c/fresh.jpg", 1), obj("families/1/albums/2/d/unknown.jpg", null)];
    const referenced = new Set(["families/1/albums/2/a/x.jpg"]);
    expect(diffOrphans(objects, referenced, now, 24).map((o) => o.key)).toEqual(["families/1/albums/2/b/y.jpg", "families/1/albums/2/d/unknown.jpg"]);
    expect(diffOrphans(objects, referenced, now, 0).length).toBe(3);
  });
  it("extracts the family id from a media key", () => {
    expect(familyOfKey("families/42/albums/7/u/f.jpg")).toBe(42);
    expect(familyOfKey("users/3/backups/x.zip")).toBeNull();
  });
});

describe("P15 digest highlights", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const c = (id: number, likes: number, comments: number, extra: Partial<HighlightCandidate> = {}): HighlightCandidate => ({ id, familyId: 1, type: "photo", title: `p${id}`, likeCount: likes, commentCount: comments, createdAt: new Date(now.getTime() - 5 * 86_400_000), thumbnailKey: `k${id}`, storageKey: null, isPrivate: false, ...extra });
  it("ranks by likes×2 + comments×3 with a recency bonus; filters videos / private / zero-score / no key", () => {
    const rows = [c(1, 3, 0), c(2, 0, 2), c(3, 1, 1), c(4, 10, 10, { type: "video" }), c(5, 10, 10, { isPrivate: true }), c(6, 0, 0), c(7, 9, 9, { thumbnailKey: null, storageKey: null })];
    expect(pickHighlights(rows, now).map((r) => r.id)).toEqual([1, 2, 3]); // 6, 6, 5
    // recency: a 48h-fresh photo with the same raw score wins
    const fresh = c(8, 3, 0, { createdAt: new Date(now.getTime() - 3_600_000) });
    expect(pickHighlights([c(1, 3, 0), fresh], now)[0]!.id).toBe(8);
    expect(pickHighlights(rows, now, 1)).toHaveLength(1);
  });
  it("builds the caption", () => {
    expect(highlightsCaption([], true)).toBe("");
    expect(highlightsCaption([{ title: "海边", likeCount: 4, commentCount: 2 }], true)).toBe(" · 本周精选：「海边」4 赞 2 评");
    expect(highlightsCaption([{ title: null, likeCount: 1, commentCount: 0 }, { title: "x", likeCount: 0, commentCount: 1 }], true)).toContain("一张照片");
    expect(highlightsCaption([{ title: "Beach", likeCount: 4, commentCount: 2 }, { title: "x", likeCount: 0, commentCount: 1 }], false)).toBe(" · Picks: “Beach” 4 likes 2 comments and 1 more");
  });
});

describe("P15 target copy jobs", () => {
  const e = (name: string, bytes: number | null, day: number, format: "zip" | "json" | "other" = "zip") => ({ key: `GoldenMemory/${name}`, name, bytes, modifiedAt: new Date(Date.UTC(2026, 0, day)), format });
  it("plans oldest-first, skips foreign files and same-size duplicates, honours an explicit key list", () => {
    const src = [e("b.zip", 10, 2), e("a.zip", 10, 1), e("note.txt", 1, 3, "other"), e("c.json", 5, 3), e("d.zip", 7, 4)];
    const dst = [e("a.zip", 10, 1), e("d.zip", 99, 4)];
    expect(planCopyKeys(src, dst, null).map((x) => x.name)).toEqual(["b.zip", "c.json", "d.zip"]);
    expect(planCopyKeys(src, [], ["GoldenMemory/c.json"]).map((x) => x.name)).toEqual(["c.json"]);
    expect(planCopyKeys(src, dst, []).length).toBe(3);
  });
  it("defers verification for cold classes and reports progress", () => {
    expect(needsDeferredVerify("GLACIER")).toBe(true);
    expect(needsDeferredVerify("DEEP_ARCHIVE")).toBe(true);
    expect(needsDeferredVerify("STANDARD_IA")).toBe(false);
    expect(needsDeferredVerify(null)).toBe(false);
    expect(copyJobProgress({ total: 0, done: 0, failed: 0, status: "queued" })).toBe(0);
    expect(copyJobProgress({ total: 0, done: 0, failed: 0, status: "running" })).toBe(1);
    expect(copyJobProgress({ total: 10, done: 4, failed: 1, status: "running" })).toBe(50);
    expect(copyJobProgress({ total: 10, done: 10, failed: 0, status: "running" })).toBe(99);
    expect(copyJobProgress({ total: 10, done: 10, failed: 0, status: "completed" })).toBe(100);
  });
});

describe("P15 merge ownership audit", () => {
  const ledger: MergeLedger = { v: 1, repointed: { media: { column: "uploadedBy", ids: [10, 11] }, albums: { column: "createdBy", ids: [5] } }, membershipsDropped: [{ familyId: 7, role: "member", joinedAt: "2026-01-01T00:00:00Z" }], rolesRaised: [], likesDropped: [{ mediaId: 10, createdAt: "2026-01-01T00:00:00Z" }], targetPatched: [], source: { email: "s@x.y", phone: null, phoneVerifiedAt: null, openId: "o" }, sourcePreferences: null, backupTargetsMoved: [], backupTargetsDropped: 0 };
  const merge = { id: 3, targetUserId: 1, sourceUserId: 2, ledger: JSON.stringify(ledger), createdAt: new Date("2026-11-01T00:00:00Z"), undoneAt: null, purgedAt: null };
  it("flattens a ledger into per-row provenance incl. dropped duplicates", () => {
    const rows = ledgerToProvenance(merge);
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.table === "media").map((r) => r.rowId)).toEqual([10, 11]);
    expect(rows.find((r) => r.table === "likes")).toMatchObject({ rowId: 10, dropped: true, fromUserId: 2, toUserId: 1, status: "merged" });
    expect(rows.find((r) => r.table === "familyMembers")).toMatchObject({ rowId: 7, dropped: true });
    expect(ledgerToProvenance(merge, "albums")).toHaveLength(1);
    expect(ledgerToProvenance(merge, "likes")).toHaveLength(1);
    expect(ledgerToProvenance({ ...merge, undoneAt: new Date() })[0]!.status).toBe("undone");
    expect(ledgerToProvenance({ ...merge, purgedAt: new Date() })[0]!.status).toBe("purged");
    expect(ledgerToProvenance({ ...merge, ledger: null })).toEqual([]);
    expect(ledgerToProvenance({ ...merge, ledger: "{bad" })).toEqual([]);
  });
  it("exports CSV with escaping", () => {
    const rows = ledgerToProvenance(merge).map((r) => ({ ...r, label: r.table === "media" ? 'a "quoted", title' : null, currentOwnerId: 1, familyId: null }));
    const csv = ownershipAuditCsv(rows);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("mergeId,mergedAt,status,table,column,rowId,fromUserId,toUserId,dropped,currentOwnerId,familyId,label");
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain('"a ""quoted"", title"');
    expect(lines.some((l) => l.includes(",likes,userId,10,2,1,1,"))).toBe(true);
  });
});
