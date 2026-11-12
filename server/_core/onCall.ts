/**
 * P15 — on-call roster & rotation.
 *
 *   `onCallShifts` rows describe who is on duty for which escalation tier:
 *     - weekly : repeats every week on `weekday` (0 = Sun) between
 *                `startHour`–`endHour` (local time in `tz`; endHour 24 = midnight,
 *                start > end wraps past midnight)
 *     - range  : a one-off window `startsAt`–`endsAt`
 *   Several shifts may overlap; lowest `order` wins. `ON_CALL_FALLBACK_USER_ID`
 *   (or the first admin) catches gaps.
 *
 *   The escalation chain (alertIncidents) asks `onDutyFor(tier)` and sends the
 *   on-duty admin an email (+ SMS when they have a verified phone) in addition
 *   to the tier's channels. Whenever the on-duty person for a tier changes
 *   between two checks, an `onCallHandovers` row is written (reason "auto")
 *   listing the open incidents at that moment; admins can also log a manual
 *   handover with a note.
 *
 *   Pure helpers (`shiftCovers`, `pickOnDuty`, `rosterPreview`) are exported for tests.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { alertIncidents, onCallHandovers, onCallShifts, users, type OnCallShift } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { isMailConfigured, sendMail } from "./mailer";
import { isSmsConfigured, sendSms } from "./sms";
import type { AlertPayload } from "./alertChannels";

export const ON_CALL_FALLBACK_USER_ID = process.env.ON_CALL_FALLBACK_USER_ID ? Number(process.env.ON_CALL_FALLBACK_USER_ID) : null;

export type ShiftLike = Pick<OnCallShift, "kind" | "weekday" | "startHour" | "endHour" | "tz" | "startsAt" | "endsAt" | "enabled" | "order" | "tier" | "userId">;

/** Local weekday (0–6) and fractional hour of `now` in `tz`. */
export function localClock(now: Date, tz: string | null | undefined): { weekday: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    return { weekday: weekday < 0 ? 0 : weekday, hour: h + m / 60 };
  } catch {
    return { weekday: now.getUTCDay(), hour: now.getUTCHours() + now.getUTCMinutes() / 60 };
  }
}

/** Pure: does this shift cover `now`? */
export function shiftCovers(s: ShiftLike, now = new Date()): boolean {
  if (!s.enabled) return false;
  if (s.kind === "range") {
    if (!s.startsAt || !s.endsAt) return false;
    return now >= s.startsAt && now < s.endsAt;
  }
  if (s.weekday == null) return false;
  const { weekday, hour } = localClock(now, s.tz);
  const start = s.startHour;
  const end = s.endHour;
  if (start === end) return weekday === s.weekday; // whole day
  if (start < end) return weekday === s.weekday && hour >= start && hour < end;
  // wraps midnight: today after start, or the next day before end
  const prev = (s.weekday + 1) % 7;
  return (weekday === s.weekday && hour >= start) || (weekday === prev && hour < end);
}

/** Pure: on-duty user for a tier (lowest order wins), or null. */
export function pickOnDuty(shifts: ShiftLike[], tier: number, now = new Date()): ShiftLike | null {
  const covering = shifts.filter((s) => s.tier === tier && shiftCovers(s, now)).sort((a, b) => a.order - b.order);
  return covering[0] ?? null;
}

/** Pure: who is on duty at each hour boundary over the next `hours` (for the roster timeline in the ops panel). */
export function rosterPreview(shifts: ShiftLike[], tier: number, from: Date, hours = 24 * 7, stepHours = 1): Array<{ at: Date; userId: number | null }> {
  const out: Array<{ at: Date; userId: number | null }> = [];
  let last: number | null | undefined;
  for (let i = 0; i <= hours; i += stepHours) {
    const at = new Date(from.getTime() + i * 3_600_000);
    const u = pickOnDuty(shifts, tier, at)?.userId ?? null;
    if (u !== last) {
      out.push({ at, userId: u });
      last = u;
    }
  }
  return out;
}

export async function loadShifts(): Promise<OnCallShift[]> {
  const database = await getDb();
  if (!database) return [];
  return database.select().from(onCallShifts).orderBy(onCallShifts.tier, onCallShifts.order, onCallShifts.weekday, onCallShifts.startHour);
}

async function fallbackUser(database: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<number | null> {
  if (ON_CALL_FALLBACK_USER_ID) return ON_CALL_FALLBACK_USER_ID;
  const [a] = await database.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  return a?.id ?? null;
}

/** Who is on duty for `tier` right now (shift → fallback). */
export async function onDutyFor(tier: number, now = new Date()): Promise<{ userId: number; shiftId: number | null; fallback: boolean } | null> {
  const database = await getDb();
  if (!database) return null;
  const shifts = await database.select().from(onCallShifts).where(and(eq(onCallShifts.enabled, true), eq(onCallShifts.tier, tier)));
  const s = pickOnDuty(shifts, tier, now) as OnCallShift | null;
  if (s) return { userId: s.userId, shiftId: s.id, fallback: false };
  const fb = await fallbackUser(database);
  return fb ? { userId: fb, shiftId: null, fallback: true } : null;
}

/** Notify the on-duty admin of `tier` directly (email + SMS when available). Returns what was attempted. */
export async function notifyOnDuty(tier: number, payload: AlertPayload, now = new Date()): Promise<{ userId: number | null; email: boolean; sms: boolean }> {
  const duty = await onDutyFor(tier, now);
  const database = await getDb();
  if (!duty || !database) return { userId: null, email: false, sms: false };
  const [u] = await database.select({ email: users.email, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt, name: users.name }).from(users).where(eq(users.id, duty.userId)).limit(1);
  let email = false;
  let sms = false;
  if (u?.email && isMailConfigured()) {
    try {
      const r = await sendMail({ to: u.email, subject: `${payload.title} · 值班 T${tier}`, text: `${u.name ?? ""} 您好，您当前为 T${tier} 值班人。\n\n${payload.text}` });
      email = r.delivered;
    } catch {
      email = false;
    }
  }
  if (u?.phone && u.phoneVerifiedAt && isSmsConfigured()) {
    try {
      const r = await sendSms({ to: u.phone, text: `【金色韶华】T${tier} 值班告警：${payload.title.slice(0, 60)}` });
      sms = r.delivered;
    } catch {
      sms = false;
    }
  }
  return { userId: duty.userId, email, sms };
}

/* ------------------------------------------------------------------ */
/* handovers                                                           */
/* ------------------------------------------------------------------ */

const lastDuty = new Map<number, number | null>();

/** Test hook: forget remembered duty so the next check starts fresh. */
export function __resetDutyMemory(): void {
  lastDuty.clear();
}

/**
 * Compare the on-duty person per tier with the last check; write an "auto"
 * handover row when it changed. Called from the metrics scheduler tick.
 */
export async function recordRotationHandovers(now = new Date(), tiers = [1, 2, 3]): Promise<Array<{ tier: number; from: number | null; to: number | null }>> {
  const database = await getDb();
  if (!database) return [];
  const out: Array<{ tier: number; from: number | null; to: number | null }> = [];
  const openIds = (await database.select({ id: alertIncidents.id }).from(alertIncidents).where(inArray(alertIncidents.status, ["open", "acked"]))).map((r) => r.id);
  for (const tier of tiers) {
    const duty = await onDutyFor(tier, now);
    const cur = duty?.userId ?? null;
    const prev = lastDuty.get(tier);
    if (prev === undefined) {
      // first observation after boot: seed from the latest handover so restarts don't spam
      const [last] = await database.select().from(onCallHandovers).where(eq(onCallHandovers.tier, tier)).orderBy(desc(onCallHandovers.createdAt)).limit(1);
      const seeded = last?.toUserId ?? null;
      lastDuty.set(tier, seeded);
      if (seeded === cur) continue;
      await database.insert(onCallHandovers).values({ fromUserId: seeded, toUserId: cur, tier, reason: "auto", openIncidents: JSON.stringify(openIds), note: duty?.fallback ? "fallback" : null });
      lastDuty.set(tier, cur);
      out.push({ tier, from: seeded, to: cur });
      continue;
    }
    if (prev === cur) continue;
    await database.insert(onCallHandovers).values({ fromUserId: prev, toUserId: cur, tier, reason: "auto", openIncidents: JSON.stringify(openIds), note: duty?.fallback ? "fallback" : null });
    lastDuty.set(tier, cur);
    out.push({ tier, from: prev, to: cur });
  }
  return out;
}

export async function manualHandover(opts: { by: number; toUserId: number; tier: number; note?: string | null; now?: Date }): Promise<number> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const now = opts.now ?? new Date();
  const duty = await onDutyFor(opts.tier, now);
  const openIds = (await database.select({ id: alertIncidents.id }).from(alertIncidents).where(inArray(alertIncidents.status, ["open", "acked"]))).map((r) => r.id);
  const ins = await database.insert(onCallHandovers).values({ fromUserId: duty?.userId ?? null, toUserId: opts.toUserId, tier: opts.tier, reason: "manual", note: opts.note?.slice(0, 300) ?? null, openIncidents: JSON.stringify(openIds), createdBy: opts.by });
  // a manual handover becomes an immediate range shift until the next scheduled boundary (max 24h)
  const endsAt = new Date(now.getTime() + 24 * 3_600_000);
  await database.insert(onCallShifts).values({ userId: opts.toUserId, kind: "range", startsAt: now, endsAt, order: -1, tier: opts.tier, enabled: true, note: `手动交接${opts.note ? `：${opts.note.slice(0, 80)}` : ""}`, createdBy: opts.by });
  lastDuty.set(opts.tier, opts.toUserId);
  return Number(ins[0].insertId);
}

export async function listHandovers(take = 30) {
  const database = await getDb();
  if (!database) return [];
  const rows = await database.select().from(onCallHandovers).orderBy(desc(onCallHandovers.createdAt)).limit(take);
  return rows.map((r) => ({ ...r, openIncidents: r.openIncidents ? (JSON.parse(r.openIncidents) as number[]) : [] }));
}
