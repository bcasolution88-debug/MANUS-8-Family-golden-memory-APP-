/**
 * P12 — lightweight outcome metrics for the ops dashboard.
 *
 *   recordMetric(kind, ok, { durationMs, detail })   fire-and-forget insert (never throws)
 *   metricSeries(kind, hours)                          hourly buckets: total / ok / avgMs
 *   metricSummary(hours)                               per-kind success rate for the window
 *   pruneMetrics()                                     drop rows older than METRICS_RETENTION_DAYS
 *
 * Alerts: `evaluateAlerts()` (leader-only, hourly) compares each kind's success
 * rate over ALERT_WINDOW_HOURS against ALERT_MIN_RATE when there are at least
 * ALERT_MIN_SAMPLES samples, and emails ALERT_EMAIL (or every admin user) once
 * per kind per cooldown so a flapping channel does not spam.
 *
 * P13: `alertRules` rows override the env thresholds per kind (own window,
 * enable flag, silence-until) and alerts also fan out to `alertChannels`
 * (Webhook / Slack / WeCom / DingTalk) — see ./alertChannels.ts.
 */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import { alertRules, metricEvents, users, type MetricKind, METRIC_KINDS } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { runIfLeader } from "./coordination";
import { isMailConfigured, sendMail } from "./mailer";

export const METRICS_RETENTION_DAYS = Number(process.env.METRICS_RETENTION_DAYS ?? 30);
export const ALERT_WINDOW_HOURS = Number(process.env.ALERT_WINDOW_HOURS ?? 6);
export const ALERT_MIN_RATE = Number(process.env.ALERT_MIN_RATE ?? 0.8);
export const ALERT_MIN_SAMPLES = Number(process.env.ALERT_MIN_SAMPLES ?? 5);
export const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS ?? 6 * 60 * 60 * 1000);

export function recordMetric(kind: MetricKind, ok: boolean, extra: { durationMs?: number | null; detail?: string | null; userId?: number | null } = {}): void {
  if (process.env.METRICS_DISABLED === "1") return;
  void (async () => {
    try {
      const database = await getDb();
      if (!database) return;
      await database.insert(metricEvents).values({ kind, ok, durationMs: extra.durationMs == null ? null : Math.max(0, Math.round(extra.durationMs)), detail: extra.detail?.slice(0, 120) ?? null, userId: extra.userId ?? null });
    } catch {
      /* metrics must never break the primary path */
    }
  })();
}

/** Wrap an async operation and record its outcome + duration. */
export async function timed<T>(kind: MetricKind, fn: () => Promise<T>, detail?: (r: T) => string | null): Promise<T> {
  const started = Date.now();
  try {
    const r = await fn();
    recordMetric(kind, true, { durationMs: Date.now() - started, detail: detail?.(r) ?? null });
    return r;
  } catch (error) {
    recordMetric(kind, false, { durationMs: Date.now() - started, detail: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export interface MetricBucket {
  /** ISO hour start */
  hour: string;
  total: number;
  ok: number;
  avgMs: number | null;
}

/** Hourly buckets for the last `hours` hours (zero-filled). */
export async function metricSeries(kind: MetricKind, hours = 24, now = new Date()): Promise<MetricBucket[]> {
  const database = await getDb();
  const since = new Date(now.getTime() - hours * 3_600_000);
  since.setUTCMinutes(0, 0, 0);
  const buckets = new Map<string, MetricBucket>();
  for (let i = 0; i <= hours; i++) {
    const h = new Date(since.getTime() + i * 3_600_000).toISOString().slice(0, 13) + ":00:00.000Z";
    buckets.set(h, { hour: h, total: 0, ok: 0, avgMs: null });
  }
  if (!database) return [...buckets.values()];
  const rows = await database
    .select({
      hour: sql<string>`DATE_FORMAT(${metricEvents.createdAt}, '%Y-%m-%dT%H:00:00.000Z')`,
      total: sql<number>`count(*)`,
      ok: sql<number>`sum(${metricEvents.ok})`,
      avgMs: sql<number | null>`avg(${metricEvents.durationMs})`,
    })
    .from(metricEvents)
    .where(and(eq(metricEvents.kind, kind), gte(metricEvents.createdAt, since)))
    .groupBy(sql`1`);
  for (const r of rows) {
    const b = buckets.get(r.hour);
    if (b) {
      b.total = Number(r.total);
      b.ok = Number(r.ok ?? 0);
      b.avgMs = r.avgMs == null ? null : Math.round(Number(r.avgMs));
    }
  }
  return [...buckets.values()];
}

export interface MetricSummary {
  kind: MetricKind;
  total: number;
  ok: number;
  rate: number | null;
  avgMs: number | null;
  lastFailure: { at: Date; detail: string | null } | null;
}

export async function metricSummary(hours = 24, now = new Date()): Promise<MetricSummary[]> {
  const database = await getDb();
  const out: MetricSummary[] = METRIC_KINDS.map((kind) => ({ kind, total: 0, ok: 0, rate: null, avgMs: null, lastFailure: null }));
  if (!database) return out;
  const since = new Date(now.getTime() - hours * 3_600_000);
  const rows = await database
    .select({ kind: metricEvents.kind, total: sql<number>`count(*)`, ok: sql<number>`sum(${metricEvents.ok})`, avgMs: sql<number | null>`avg(${metricEvents.durationMs})` })
    .from(metricEvents)
    .where(gte(metricEvents.createdAt, since))
    .groupBy(metricEvents.kind);
  for (const r of rows) {
    const s = out.find((o) => o.kind === r.kind)!;
    s.total = Number(r.total);
    s.ok = Number(r.ok ?? 0);
    s.rate = s.total ? s.ok / s.total : null;
    s.avgMs = r.avgMs == null ? null : Math.round(Number(r.avgMs));
  }
  const failures = await database
    .select({ kind: metricEvents.kind, createdAt: metricEvents.createdAt, detail: metricEvents.detail })
    .from(metricEvents)
    .where(and(eq(metricEvents.ok, false), gte(metricEvents.createdAt, since)))
    .orderBy(desc(metricEvents.createdAt))
    .limit(200);
  for (const f of failures) {
    const s = out.find((o) => o.kind === f.kind)!;
    if (!s.lastFailure) s.lastFailure = { at: f.createdAt, detail: f.detail };
  }
  return out;
}

/** P13: push_open counts by A/B variant and type within the window (detail = "A:like"). */
export async function pushOpenBreakdown(hours = 24, now = new Date()): Promise<{ A: number; B: number; byType: Record<string, { A: number; B: number }> }> {
  const out = { A: 0, B: 0, byType: {} as Record<string, { A: number; B: number }> };
  const database = await getDb();
  if (!database) return out;
  const since = new Date(now.getTime() - hours * 3_600_000);
  const rows = await database
    .select({ detail: metricEvents.detail, n: sql<number>`count(*)` })
    .from(metricEvents)
    .where(and(eq(metricEvents.kind, "push_open"), gte(metricEvents.createdAt, since)))
    .groupBy(metricEvents.detail);
  for (const r of rows) {
    const [variant, type = "?"] = (r.detail ?? "A:?").split(":");
    const v = variant === "B" ? "B" : "A";
    const n = Number(r.n);
    out[v] += n;
    out.byType[type] = out.byType[type] ?? { A: 0, B: 0 };
    out.byType[type]![v] += n;
  }
  return out;
}

export async function pruneMetrics(days = METRICS_RETENTION_DAYS): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const r = await database.delete(metricEvents).where(lt(metricEvents.createdAt, new Date(Date.now() - days * 86_400_000)));
  return Number((r[0] as { affectedRows?: number }).affectedRows ?? 0);
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

const lastAlertAt = new Map<MetricKind, number>();

/** Test hook. */
export function __resetAlertState(): void {
  lastAlertAt.clear();
}

export function alertCandidates(summary: MetricSummary[], opts = { minRate: ALERT_MIN_RATE, minSamples: ALERT_MIN_SAMPLES }): MetricSummary[] {
  return summary.filter((s) => s.total >= opts.minSamples && s.rate !== null && s.rate < opts.minRate);
}

async function alertRecipients(): Promise<string[]> {
  if (process.env.ALERT_EMAIL) return process.env.ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);
  const database = await getDb();
  if (!database) return [];
  const admins = await database.select({ email: users.email }).from(users).where(eq(users.role, "admin"));
  return admins.map((a) => a.email).filter((e): e is string => !!e);
}

export function alertEmail(bad: MetricSummary[], windowHours: number): { subject: string; text: string } {
  const lines = bad.map((s) => `• ${s.kind}: ${s.ok}/${s.total} 成功 (${Math.round((s.rate ?? 0) * 100)}%)${s.lastFailure ? ` — 最近失败: ${s.lastFailure.detail ?? "?"}` : ""}`);
  return {
    subject: `[金色韶华 告警] ${bad.map((b) => b.kind).join(", ")} 成功率低于 ${Math.round(ALERT_MIN_RATE * 100)}%`,
    text: `过去 ${windowHours} 小时内以下通道成功率低于阈值：\n\n${lines.join("\n")}\n\n请在 App → 设置 → 运维面板 查看详情并执行通道测试。\n— Golden Memory ops`,
  };
}

/* ------------------------------------------------------------------ */
/* P13 — per-kind rules (DB overrides env defaults) + silence windows  */
/* ------------------------------------------------------------------ */

export interface EffectiveRule {
  kind: MetricKind;
  enabled: boolean;
  minRate: number;
  minSamples: number;
  windowHours: number;
  silencedUntil: Date | null;
  /** true when a DB row overrides the env defaults */
  custom: boolean;
}

export function defaultRule(kind: MetricKind): EffectiveRule {
  return { kind, enabled: true, minRate: ALERT_MIN_RATE, minSamples: ALERT_MIN_SAMPLES, windowHours: ALERT_WINDOW_HOURS, silencedUntil: null, custom: false };
}

export async function loadRules(): Promise<EffectiveRule[]> {
  const database = await getDb();
  const rows = database ? await database.select().from(alertRules) : [];
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return METRIC_KINDS.map((kind) => {
    const r = byKind.get(kind);
    if (!r) return defaultRule(kind);
    return { kind, enabled: r.enabled, minRate: r.minRatePct / 100, minSamples: r.minSamples, windowHours: r.windowHours, silencedUntil: r.silencedUntil, custom: true };
  });
}

/** Pure: which rules fire for the given per-kind summaries. */
export function evaluateRules(summaryByWindow: (windowHours: number) => MetricSummary[] | undefined, rules: EffectiveRule[], now = new Date()): MetricSummary[] {
  const bad: MetricSummary[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.silencedUntil && rule.silencedUntil.getTime() > now.getTime()) continue;
    const summary = summaryByWindow(rule.windowHours)?.find((s) => s.kind === rule.kind);
    if (!summary) continue;
    if (summary.total >= rule.minSamples && summary.rate !== null && summary.rate < rule.minRate) bad.push(summary);
  }
  return bad;
}

/**
 * Leader-only hourly check; returns kinds alerted on. Per-kind rules may use
 * different windows, so summaries are computed per distinct window.
 *
 * P14: delivery goes through `alertIncidents` — a new bad kind opens an
 * incident (tier-1 channels + email), a still-bad un-acked incident escalates
 * to tier 2 / 3 after ESCALATE_AFTER_MIN, a healthy kind resolves its incident.
 * The per-kind cooldown only throttles the *email*; channels follow the chain.
 */
export async function evaluateAlerts(now = new Date()): Promise<MetricKind[]> {
  const rules = await loadRules();
  const windows = [...new Set(rules.map((r) => r.windowHours))];
  const summaries = new Map<number, MetricSummary[]>();
  for (const w of windows) summaries.set(w, await metricSummary(w, now));
  const candidates = evaluateRules((w) => summaries.get(w), rules, now);

  const windowFor = (kind: MetricKind) => rules.find((r) => r.kind === kind)?.windowHours ?? ALERT_WINDOW_HOURS;
  try {
    const { reconcileIncidents } = await import("./alertIncidents");
    const r = await reconcileIncidents(
      candidates.map((c) => ({ kind: c.kind, rate: c.rate, total: c.total, detail: c.lastFailure?.detail ?? null })),
      (kinds, tier) => {
        const m = alertEmail(candidates.filter((c) => kinds.some((k) => k.kind === c.kind)), windowFor(kinds[0]!.kind));
        return { title: tier > 1 ? `[升级 T${tier}] ${m.subject}` : m.subject, text: tier > 1 ? `告警 ${(ESCALATE_AFTER_MIN_LABEL(tier))} 未确认，已升级。\n\n${m.text}` : m.text, kinds: kinds.map((k) => k.kind), at: now };
      },
      now,
    );
    if (r.opened.length || r.escalated.length || r.resolved.length) console.log(`[alerts] opened=${r.opened.join(",") || "-"} escalated=${r.escalated.map((e) => `${e.kind}@t${e.tier}`).join(",") || "-"} resolved=${r.resolved.join(",") || "-"}`);
  } catch (error) {
    console.error("[alerts] incident reconcile failed", error);
  }

  const bad = candidates.filter((s) => (lastAlertAt.get(s.kind) ?? 0) + ALERT_COOLDOWN_MS <= now.getTime());
  if (bad.length === 0) return [];
  for (const b of bad) lastAlertAt.set(b.kind, now.getTime());
  if (!isMailConfigured()) {
    console.warn(`[alerts] ${bad.map((b) => b.kind).join(",")} below threshold (mail not configured — channels/log only)`);
    return bad.map((b) => b.kind);
  }
  const mail = alertEmail(bad, windowFor(bad[0]!.kind));
  const to = await alertRecipients();
  for (const addr of to) {
    const r = await sendMail({ to: addr, ...mail });
    recordMetric("mail", r.delivered, { detail: `alert:${r.transport}` });
  }
  return bad.map((b) => b.kind);
}

const ESCALATE_AFTER_MIN_LABEL = (tier: number) => `${(tier - 1) * Number(process.env.ESCALATE_AFTER_MIN ?? 30)} 分钟`;

let timer: NodeJS.Timeout | null = null;
export function startMetricsScheduler(intervalMs = 60 * 60 * 1000): void {
  if (process.env.METRICS_SCHEDULER === "0" || timer) return;
  const tick = () =>
    void runIfLeader("metrics-alerts", 30 * 60 * 1000, async () => {
      await pruneMetrics();
      // P15: log on-call rotation changes before evaluating so escalations hit the new person
      await import("./onCall").then((m) => m.recordRotationHandovers()).catch((e) => console.error("[oncall] rotation check failed", e));
      return evaluateAlerts();
    }).catch((e) => console.error("[metrics] tick failed", e));
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 90_000).unref?.();
}

export function stopMetricsScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
