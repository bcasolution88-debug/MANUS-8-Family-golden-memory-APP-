/**
 * P14 — alert incidents: escalation chain, acknowledgement, timeline.
 *
 *   One `alertIncidents` row per episode of a metric kind being below its rule.
 *   - open      : notify tier-1 channels (+ email) at once
 *   - escalate  : still open & unacked after ESCALATE_AFTER_MIN → tier 2, again
 *                 after 2× → tier 3 (channels carry `tier`; email goes with tier 1)
 *   - ack       : an admin acknowledges (optional note) → escalation stops,
 *                 reminders stop; incident stays until healthy
 *   - resolve   : the kind is healthy on a later evaluation → resolved + note
 *   Every step appends to `timeline` (JSON [{at, event, by?, detail?}]).
 *
 *   Pure helpers (`nextTier`, `escalationDue`, `appendTimeline`) are exported for tests.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { alertChannels, alertIncidents, type AlertIncident, type MetricKind } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { sendToChannel, type AlertPayload } from "./alertChannels";
import { recordMetric } from "./metrics";
import { notifyOnDuty } from "./onCall";

export const ESCALATE_AFTER_MIN = Math.max(1, Number(process.env.ESCALATE_AFTER_MIN ?? 30));
export const MAX_TIER = 3;

export interface TimelineEvent {
  at: string;
  event: "opened" | "notified" | "escalated" | "acked" | "resolved" | "reopened" | "note";
  by?: number | null;
  detail?: string | null;
}

export function parseTimeline(raw: string | null | undefined): TimelineEvent[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as TimelineEvent[]) : [];
  } catch {
    return [];
  }
}

export function appendTimeline(raw: string | null | undefined, ev: Omit<TimelineEvent, "at"> & { at?: Date }): string {
  const list = parseTimeline(raw);
  list.push({ at: (ev.at ?? new Date()).toISOString(), event: ev.event, by: ev.by ?? null, detail: ev.detail ?? null });
  return JSON.stringify(list.slice(-200));
}

/** Pure: which tier should be notified now for an open, un-acked incident. */
export function nextTier(inc: Pick<AlertIncident, "tier" | "openedAt" | "status">, now = new Date(), afterMin = ESCALATE_AFTER_MIN): number {
  if (inc.status !== "open") return inc.tier;
  const ageMin = (now.getTime() - inc.openedAt.getTime()) / 60_000;
  // tier 2 after afterMin, tier 3 after 2*afterMin
  const due = ageMin >= afterMin * 2 ? 3 : ageMin >= afterMin ? 2 : 1;
  return Math.min(MAX_TIER, Math.max(inc.tier, due));
}

export function escalationDue(inc: Pick<AlertIncident, "tier" | "openedAt" | "status">, now = new Date(), afterMin = ESCALATE_AFTER_MIN): boolean {
  return nextTier(inc, now, afterMin) > inc.tier;
}

async function notifyTier(tier: number, payload: AlertPayload, opts: { onDuty?: boolean } = {}): Promise<{ ok: number; failed: number; onDuty: number | null }> {
  const database = await getDb();
  if (!database) return { ok: 0, failed: 0, onDuty: null };
  const rows = await database.select().from(alertChannels).where(and(eq(alertChannels.enabled, true), eq(alertChannels.tier, tier)));
  let ok = 0;
  let failed = 0;
  // P15: the on-duty admin for this tier gets a direct email / SMS as well (open + escalate only)
  let onDuty: number | null = null;
  if (opts.onDuty) {
    const d = await notifyOnDuty(tier, payload, payload.at ?? new Date()).catch(() => ({ userId: null, email: false, sms: false }));
    onDuty = d.userId;
    if (d.userId) recordMetric("alert", d.email || d.sms, { detail: `oncall:u${d.userId}:t${tier}:${d.email ? "mail" : ""}${d.sms ? "+sms" : ""}` });
  }
  for (const ch of rows) {
    const started = Date.now();
    const r = await sendToChannel(ch, payload);
    recordMetric("alert", r.ok, { durationMs: Date.now() - started, detail: r.ok ? `${ch.kind}:${ch.name}:t${tier}` : `${ch.kind}:${r.error}`.slice(0, 120) });
    await database.update(alertChannels).set({ lastStatus: r.ok ? "ok" : "failed", lastError: r.ok ? null : r.error.slice(0, 300), lastSentAt: new Date() }).where(eq(alertChannels.id, ch.id));
    if (r.ok) ok += 1;
    else failed += 1;
  }
  return { ok, failed, onDuty };
}

export interface BadKind {
  kind: MetricKind;
  rate: number | null;
  total: number;
  detail?: string | null;
}

/**
 * Reconcile incidents with the current evaluation:
 *   - bad kinds without an active incident → open + notify tier 1
 *   - open un-acked incidents past their escalation time → bump tier + notify
 *   - active incidents whose kind is now healthy → resolve
 * Returns what happened (for logs / tests). `payloadFor` builds the message.
 */
export async function reconcileIncidents(bad: BadKind[], payloadFor: (kinds: BadKind[], tier: number) => AlertPayload, now = new Date()): Promise<{ opened: MetricKind[]; escalated: Array<{ kind: MetricKind; tier: number }>; resolved: MetricKind[] }> {
  const out = { opened: [] as MetricKind[], escalated: [] as Array<{ kind: MetricKind; tier: number }>, resolved: [] as MetricKind[] };
  const database = await getDb();
  if (!database) return out;
  const active = await database.select().from(alertIncidents).where(ne(alertIncidents.status, "resolved"));
  const activeByKind = new Map(active.map((i) => [i.kind, i]));
  const badByKind = new Map(bad.map((b) => [b.kind, b]));

  // 1. open new incidents
  const fresh = bad.filter((b) => !activeByKind.has(b.kind));
  if (fresh.length) {
    const payload = payloadFor(fresh, 1);
    const r = await notifyTier(1, payload, { onDuty: true });
    for (const b of fresh) {
      const timeline = appendTimeline(appendTimeline(null, { event: "opened", at: now, detail: b.detail ?? `${Math.round((b.rate ?? 0) * 100)}% of ${b.total}` }), { event: "notified", at: now, detail: `tier 1 · ${r.ok} ok / ${r.failed} failed${r.onDuty ? ` · 值班人 #${r.onDuty}` : ""}` });
      await database.insert(alertIncidents).values({ kind: b.kind, status: "open", tier: 1, ratePct: b.rate == null ? null : Math.round(b.rate * 100), samples: b.total, openedAt: now, lastNotifiedAt: now, timeline });
      out.opened.push(b.kind);
    }
  }

  // 2. escalate stale open incidents still bad
  for (const inc of active) {
    if (!badByKind.has(inc.kind)) continue;
    if (!escalationDue(inc, now)) continue;
    const tier = nextTier(inc, now);
    const r = await notifyTier(tier, payloadFor([badByKind.get(inc.kind)!], tier), { onDuty: true });
    await database
      .update(alertIncidents)
      .set({ tier, lastNotifiedAt: now, timeline: appendTimeline(inc.timeline, { event: "escalated", at: now, detail: `tier ${tier} · ${r.ok} ok / ${r.failed} failed${r.onDuty ? ` · 值班人 #${r.onDuty}` : ""}` }) })
      .where(eq(alertIncidents.id, inc.id));
    out.escalated.push({ kind: inc.kind, tier });
  }

  // 3. resolve healthy ones
  const healthy = active.filter((i) => !badByKind.has(i.kind));
  if (healthy.length) {
    for (const inc of healthy) {
      await database.update(alertIncidents).set({ status: "resolved", resolvedAt: now, timeline: appendTimeline(inc.timeline, { event: "resolved", at: now, detail: "back above threshold" }) }).where(eq(alertIncidents.id, inc.id));
      out.resolved.push(inc.kind);
    }
    // courtesy note to tier 1 so the room sees the all-clear
    await notifyTier(1, { title: `[金色韶华 恢复] ${healthy.map((h) => h.kind).join(", ")} 已恢复正常`, text: `以下通道成功率已回到阈值以上：${healthy.map((h) => h.kind).join(", ")}`, kinds: healthy.map((h) => h.kind), at: now });
  }
  return out;
}

export async function ackIncident(id: number, by: number, note?: string | null, now = new Date()): Promise<AlertIncident> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const [inc] = await database.select().from(alertIncidents).where(eq(alertIncidents.id, id)).limit(1);
  if (!inc) throw new Error("Incident not found");
  if (inc.status === "resolved") throw new Error("Incident already resolved");
  await database
    .update(alertIncidents)
    .set({ status: "acked", ackedAt: now, ackedBy: by, ackNote: note?.slice(0, 300) ?? null, timeline: appendTimeline(inc.timeline, { event: "acked", at: now, by, detail: note ?? null }) })
    .where(eq(alertIncidents.id, id));
  await notifyTier(1, { title: `[金色韶华 已确认] ${inc.kind}`, text: `${inc.kind} 告警已由管理员确认${note ? `：${note}` : ""}。升级链已停止。`, kinds: [inc.kind], at: now });
  const [after] = await database.select().from(alertIncidents).where(eq(alertIncidents.id, id)).limit(1);
  return after!;
}

export async function addIncidentNote(id: number, by: number, note: string, now = new Date()): Promise<void> {
  const database = await getDb();
  if (!database) return;
  const [inc] = await database.select().from(alertIncidents).where(eq(alertIncidents.id, id)).limit(1);
  if (!inc) throw new Error("Incident not found");
  await database.update(alertIncidents).set({ timeline: appendTimeline(inc.timeline, { event: "note", at: now, by, detail: note.slice(0, 300) }) }).where(eq(alertIncidents.id, id));
}

export async function listIncidents(opts: { status?: "open" | "acked" | "resolved" | "active"; take?: number } = {}) {
  const database = await getDb();
  if (!database) return [];
  const take = opts.take ?? 30;
  const where = opts.status === "active" ? inArray(alertIncidents.status, ["open", "acked"]) : opts.status ? eq(alertIncidents.status, opts.status) : undefined;
  const rows = where ? await database.select().from(alertIncidents).where(where).orderBy(desc(alertIncidents.openedAt)).limit(take) : await database.select().from(alertIncidents).orderBy(desc(alertIncidents.openedAt)).limit(take);
  return rows.map((r) => ({ ...r, timeline: parseTimeline(r.timeline) }));
}
