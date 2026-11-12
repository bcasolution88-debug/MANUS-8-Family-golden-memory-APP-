/**
 * P10 — multi-instance coordination for background work.
 *
 * Two primitives, both backed by Redis when `REDIS_URL` is set and by process
 * memory otherwise (single instance / dev / tests):
 *
 *   withLock(name, ttlMs, fn)       mutual exclusion for one tick of a job
 *                                   (SET NX PX + compare-and-delete release)
 *   LeaderElection                  one instance per cluster runs schedulers;
 *                                   heartbeat renews a lease, others stand by
 *                                   and take over if the lease expires.
 *
 * Schedulers (backups, anniversary reminders, Studio reaper) call
 * `runIfLeader(...)`. With Redis this guarantees a single run per tick across
 * instances; without Redis every instance believes it is leader — the same
 * behaviour as P9, so a single-instance deploy needs no config change.
 *
 * `COORDINATION_DISABLED=1` forces memory mode even if REDIS_URL exists.
 */
import { hostname } from "node:os";

type RedisLike = {
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  on(event: "error", cb: (err: Error) => void): unknown;
};

export const INSTANCE_ID = `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const prefix = process.env.COORDINATION_PREFIX ?? "gm:coord:";
const redisUrl = process.env.COORDINATION_DISABLED === "1" ? "" : (process.env.REDIS_URL ?? "");

let redis: RedisLike | null = null;
let redisFailed = false;

function getRedis(): RedisLike | null {
  if (!redisUrl || redisFailed) return null;
  if (redis) return redis;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require("ioredis") as new (url: string, opts?: Record<string, unknown>) => RedisLike;
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
    redis.on("error", (err) => {
      if (!redisFailed) console.error("[coordination] redis error — falling back to local leadership", err.message);
      redisFailed = true;
    });
    return redis;
  } catch (error) {
    console.error("[coordination] failed to init redis", error);
    redisFailed = true;
    return null;
  }
}

export const coordinationBackend = (): "redis" | "memory" => (getRedis() ? "redis" : "memory");

/* ------------------------------------------------------------------ */
/* Locks                                                               */
/* ------------------------------------------------------------------ */

const localLocks = new Map<string, { owner: string; expiresAt: number }>();

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** Try to acquire `name` for `ttlMs`. Returns a release fn or null if held elsewhere. */
export async function acquireLock(name: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const key = `${prefix}lock:${name}`;
  const token = `${INSTANCE_ID}:${crypto.randomUUID()}`;
  const client = getRedis();
  if (client) {
    try {
      const ok = await client.set(key, token, "PX", ttlMs, "NX");
      if (ok !== "OK") return null;
      return async () => {
        try {
          await client.eval(RELEASE_SCRIPT, 1, key, token);
        } catch {
          /* lease will expire on its own */
        }
      };
    } catch {
      // Redis hiccup → fall through to local lock so work still happens on this instance.
    }
  }
  const now = Date.now();
  const held = localLocks.get(key);
  if (held && held.expiresAt > now) return null;
  localLocks.set(key, { owner: token, expiresAt: now + ttlMs });
  return async () => {
    if (localLocks.get(key)?.owner === token) localLocks.delete(key);
  };
}

/** Run `fn` only if the lock is free; returns `{ran:false}` when another instance holds it. */
export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  const release = await acquireLock(name, ttlMs);
  if (!release) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await release();
  }
}

/* ------------------------------------------------------------------ */
/* Leader election                                                     */
/* ------------------------------------------------------------------ */

const RENEW_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

export class LeaderElection {
  private timer: NodeJS.Timeout | null = null;
  private leader = false;
  private since: number | null = null;
  readonly key: string;
  constructor(readonly name = "scheduler", readonly leaseMs = 30_000, readonly heartbeatMs = 10_000) {
    this.key = `${prefix}leader:${name}`;
  }

  get isLeader(): boolean {
    return this.leader;
  }

  status() {
    return { name: this.name, isLeader: this.leader, since: this.since ? new Date(this.since) : null, backend: coordinationBackend(), instance: INSTANCE_ID };
  }

  /** One election round: acquire if free, renew if ours. */
  async tick(): Promise<boolean> {
    const client = getRedis();
    if (!client) {
      // Memory mode: this process is the only candidate.
      if (!this.leader) this.since = Date.now();
      this.leader = true;
      return true;
    }
    try {
      if (this.leader) {
        const renewed = Number(await client.eval(RENEW_SCRIPT, 1, this.key, INSTANCE_ID, this.leaseMs));
        if (renewed === 1) return true;
        this.leader = false;
        this.since = null;
        console.warn(`[coordination] lost leadership of ${this.name}`);
      }
      const ok = await client.set(this.key, INSTANCE_ID, "PX", this.leaseMs, "NX");
      if (ok === "OK") {
        this.leader = true;
        this.since = Date.now();
        console.log(`[coordination] ${INSTANCE_ID} is now leader for ${this.name}`);
      }
      return this.leader;
    } catch {
      // Redis unreachable: keep whatever state we had (avoid flapping), but don't claim new leadership.
      return this.leader;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.heartbeatMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const client = getRedis();
    if (this.leader && client) {
      try {
        await client.eval(RELEASE_SCRIPT, 1, this.key, INSTANCE_ID);
      } catch {
        /* lease expires */
      }
    }
    this.leader = false;
    this.since = null;
  }
}

/** Process-wide scheduler leader (backups, reminders, reaper). */
export const schedulerLeader = new LeaderElection("scheduler", Number(process.env.LEADER_LEASE_MS ?? 30_000), Number(process.env.LEADER_HEARTBEAT_MS ?? 10_000));

/**
 * Guard for periodic jobs: only the leader runs, and the run itself is also
 * locked so a leadership hand-over mid-tick cannot double-run.
 */
export async function runIfLeader<T>(job: string, ttlMs: number, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false; reason: "not_leader" | "locked" }> {
  if (!schedulerLeader.isLeader) return { ran: false, reason: "not_leader" };
  const r = await withLock(`job:${job}`, ttlMs, fn);
  return r.ran ? r : { ran: false, reason: "locked" };
}

export function coordinatorStatus() {
  return schedulerLeader.status();
}

/** Test hook: clear in-memory locks. */
export function __resetLocalLocks(): void {
  localLocks.clear();
}
