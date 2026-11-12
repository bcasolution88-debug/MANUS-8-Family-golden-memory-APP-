/**
 * Rate limiting (P3 / P4).
 *
 * Two layers:
 *  1. HTTP layer (express-rate-limit, per-IP) — protects the whole API surface,
 *     with stricter buckets for auth callbacks and the storage proxy.
 *  2. tRPC layer (`assertUserRateLimit`, per-user) — protects expensive
 *     procedures (presign, transcription, share creation) that an authenticated
 *     user could otherwise hammer from a single IP-rotating client.
 *
 * Store (P4): when `REDIS_URL` is set both layers share a Redis backend so the
 * limits hold across multiple API instances; otherwise they fall back to
 * process memory (fine for a single instance / local dev). If Redis becomes
 * unreachable the per-user layer fails open (logs once, allows traffic) rather
 * than taking the API down.
 *
 * Set `RATE_LIMIT_DISABLED=1` to turn both layers off (integration tests).
 */
import { TRPCError } from "@trpc/server";
import rateLimit, { ipKeyGenerator, type Options, type Store } from "express-rate-limit";
import type { Request } from "express";

import { ENV } from "./env";

const disabled = process.env.RATE_LIMIT_DISABLED === "1";
const redisUrl = process.env.REDIS_URL ?? "";
const keyPrefix = process.env.RATE_LIMIT_PREFIX ?? "gm:rl:";

const num = (name: string, fallback: number) => {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

/* ------------------------------------------------------------------ */
/* Optional Redis connection (lazy, shared by both layers)             */
/* ------------------------------------------------------------------ */

type RedisLike = {
  call(command: string, ...args: (string | number)[]): Promise<unknown>;
  on(event: "error", cb: (err: Error) => void): unknown;
};

let redis: RedisLike | null = null;
let redisWarned = false;

function getRedis(): RedisLike | null {
  if (!redisUrl || disabled) return null;
  if (redis) return redis;
  try {
    // Lazy require keeps ioredis out of the bundle path when REDIS_URL is unset.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require("ioredis") as new (url: string, opts?: Record<string, unknown>) => RedisLike;
    redis = new IORedis(redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redis.on("error", (err) => {
      if (!redisWarned) {
        redisWarned = true;
        console.error("[rateLimit] redis error — falling back to fail-open for user buckets", err.message);
      }
    });
    console.log("[rateLimit] using Redis store");
    return redis;
  } catch (error) {
    console.error("[rateLimit] failed to init redis, using memory store", error);
    return null;
  }
}

export const rateLimitBackend = (): "redis" | "memory" => (getRedis() ? "redis" : "memory");

/** express-rate-limit store: Redis when configured, otherwise the library default (memory). */
function makeHttpStore(scope: string): Store | undefined {
  const client = getRedis();
  if (!client) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RedisStore } = require("rate-limit-redis") as {
    RedisStore: new (opts: { sendCommand: (...args: string[]) => Promise<unknown>; prefix?: string }) => Store;
  };
  return new RedisStore({
    prefix: `${keyPrefix}${scope}:`,
    sendCommand: (...args: string[]) => client.call(args[0], ...args.slice(1)),
  });
}

/* ------------------------------------------------------------------ */
/* HTTP layer                                                          */
/* ------------------------------------------------------------------ */

const baseOptions: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => disabled,
  // In development `trust proxy` is false; Metro/web preview often sits
  // behind a tunnel that adds X-Forwarded-For, which would otherwise log a
  // noisy validation error on every request.
  validate: ENV.isProduction ? undefined : { xForwardedForHeader: false },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "Too many requests, please slow down." },
};

/** Whole-API bucket. Health check is excluded so uptime probes never trip it. */
export const globalLimiter = rateLimit({
  ...baseOptions,
  store: makeHttpStore("global"),
  windowMs: 15 * 60 * 1000,
  limit: num("RATE_LIMIT_GLOBAL", 600),
  skip: (req) => disabled || req.path === "/api/health",
});

/** OAuth callback / token exchange — brute-force & replay protection. */
export const authLimiter = rateLimit({
  ...baseOptions,
  store: makeHttpStore("auth"),
  windowMs: 15 * 60 * 1000,
  limit: num("RATE_LIMIT_AUTH", 30),
});

/** Signed-URL redirects: cheap for us, but each one costs a Forge presign call. */
export const storageProxyLimiter = rateLimit({
  ...baseOptions,
  store: makeHttpStore("storage"),
  windowMs: 60 * 1000,
  limit: num("RATE_LIMIT_STORAGE", 120),
});

/* ------------------------------------------------------------------ */
/* Per-user tRPC limiter (fixed window) — memory or Redis              */
/* ------------------------------------------------------------------ */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Opportunistic GC so the map cannot grow unbounded on a long-lived process.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/** Memory implementation. Returns retry delay (ms) when over the limit, else 0. */
export function consumeUserToken(key: string, limit: number, windowMs: number): number {
  if (disabled) return 0;
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  if (bucket.count >= limit) return bucket.resetAt - now;
  bucket.count += 1;
  return 0;
}

/**
 * Redis implementation (INCR + PEXPIRE on first hit, PTTL when exhausted).
 * Fails open on connection errors so a Redis outage degrades to "unlimited"
 * rather than "unavailable".
 */
async function consumeUserTokenRedis(
  client: RedisLike,
  key: string,
  limit: number,
  windowMs: number,
): Promise<number> {
  const redisKey = `${keyPrefix}user:${key}`;
  try {
    const count = Number(await client.call("INCR", redisKey));
    if (count === 1) await client.call("PEXPIRE", redisKey, windowMs);
    if (count <= limit) return 0;
    const ttl = Number(await client.call("PTTL", redisKey));
    return ttl > 0 ? ttl : windowMs;
  } catch {
    return 0;
  }
}

/** Throws TOO_MANY_REQUESTS when the per-user bucket for `scope` is exhausted. */
export async function assertUserRateLimit(
  userId: number,
  scope: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  if (disabled) return;
  const key = `${scope}:${userId}`;
  const client = getRedis();
  const retryMs = client
    ? await consumeUserTokenRedis(client, key, limit, windowMs)
    : consumeUserToken(key, limit, windowMs);
  if (retryMs > 0) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded for ${scope}. Retry in ${Math.ceil(retryMs / 1000)}s.`,
    });
  }
}

/** Preset buckets used by routers. */
export const USER_LIMITS = {
  presign: { limit: num("RATE_LIMIT_USER_PRESIGN", 60), windowMs: 60 * 1000 },
  transcribe: { limit: num("RATE_LIMIT_USER_TRANSCRIBE", 10), windowMs: 60 * 1000 },
  share: { limit: num("RATE_LIMIT_USER_SHARE", 30), windowMs: 60 * 60 * 1000 },
  write: { limit: num("RATE_LIMIT_USER_WRITE", 120), windowMs: 60 * 1000 },
  /** P7: server-side video renders are CPU heavy. */
  studio: { limit: num("RATE_LIMIT_USER_STUDIO", 6), windowMs: 60 * 60 * 1000 },
  /** P7: LLM caption suggestions. */
  ai: { limit: num("RATE_LIMIT_USER_AI", 20), windowMs: 60 * 60 * 1000 },
  /** P8: email/password login + register attempts per IP bucket. */
  authAttempt: { limit: num("RATE_LIMIT_AUTH_ATTEMPT", 10), windowMs: 15 * 60 * 1000 },
  /** P8: AI photo analysis (vision LLM). */
  analyze: { limit: num("RATE_LIMIT_USER_ANALYZE", 30), windowMs: 60 * 60 * 1000 },
  /** P9: manual backups. */
  backup: { limit: num("RATE_LIMIT_USER_BACKUP", 3), windowMs: 60 * 60 * 1000 },
} as const;

/** Test-only helper. */
export function __resetUserBuckets() {
  buckets.clear();
}
