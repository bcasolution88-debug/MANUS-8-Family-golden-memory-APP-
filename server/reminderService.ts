/**
 * P10 — anniversary reminders (in-app notification + Expo Push).
 *
 * Daily (leader-only) pass: for every anniversary whose month/day falls
 * REMINDER_DAYS_BEFORE days from today (default 7) or *today*, fan out an
 * `anniversary` notification to the family. Idempotent per anniversary per
 * year: a `system`-independent marker row is not needed because we check for
 * an existing `anniversary` notification for that family + preview within the
 * last 2 days before inserting.
 */
import { and, desc, eq, gte } from "drizzle-orm";

import { anniversaries, notifications } from "@/drizzle/schema";
import { runIfLeader } from "@/server/_core/coordination";
import { getDb } from "@/server/db";
import { notifyFamily } from "@/server/notifications";

export const REMINDER_DAYS_BEFORE = Math.max(1, Number(process.env.REMINDER_DAYS_BEFORE ?? 7));

const TYPE_LABEL: Record<string, { zh: string; years: number }> = {
  silver: { zh: "银婚", years: 25 },
  golden: { zh: "金婚", years: 50 },
  diamond: { zh: "钻石婚", years: 60 },
  platinum: { zh: "白金婚", years: 70 },
};

/** Days (0..365) from `today` to the next occurrence of `date`'s month/day. */
export function daysUntilAnniversary(date: Date, today = new Date()): number {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let next = Date.UTC(today.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (next < t) next = Date.UTC(today.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate());
  return Math.round((next - t) / 86_400_000);
}

/** Year of the next occurrence (this year, or next year if the date already passed). */
export function nextOccurrenceYear(date: Date, today = new Date()): number {
  const passed = today.getUTCMonth() > date.getUTCMonth() || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() > date.getUTCDate());
  return today.getUTCFullYear() + (passed ? 1 : 0);
}

export function reminderPreview(a: { type: string; couple: string; date: Date }, daysLeft: number, today = new Date()): string {
  const label = TYPE_LABEL[a.type]?.zh ?? "纪念日";
  const years = nextOccurrenceYear(a.date, today) - a.date.getUTCFullYear();
  const when = daysLeft === 0 ? "就是今天" : `还有 ${daysLeft} 天`;
  return `${a.couple} 的${label}纪念日${when}（${years} 周年）`;
}

/** Fan out reminders due today. Returns number of anniversaries notified. */
export async function runAnniversaryReminders(today = new Date()): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const rows = await database.select().from(anniversaries);
  let notified = 0;
  for (const a of rows) {
    const days = daysUntilAnniversary(a.date, today);
    if (days !== 0 && days !== REMINDER_DAYS_BEFORE) continue;
    const preview = reminderPreview(a, days, today);
    // Idempotency: skip if the same reminder went out in the last 2 days.
    const [dup] = await database
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.type, "anniversary"), eq(notifications.familyId, a.familyId), eq(notifications.preview, preview), gte(notifications.createdAt, new Date(today.getTime() - 2 * 86_400_000))))
      .orderBy(desc(notifications.id))
      .limit(1);
    if (dup) continue;
    await notifyFamily(a.familyId, { type: "anniversary", actorId: null, preview });
    notified += 1;
  }
  if (notified) console.log(`[reminders] sent ${notified} anniversary reminder(s)`);
  return notified;
}

let timer: NodeJS.Timeout | null = null;
/** Hourly tick; leader-only + locked so a cluster sends each reminder once. */
export function startReminderScheduler(intervalMs = 60 * 60 * 1000): void {
  if (process.env.REMINDER_SCHEDULER === "0" || timer) return;
  const tick = () => void runIfLeader("anniversary-reminders", 10 * 60 * 1000, () => runAnniversaryReminders()).catch((e) => console.error("[reminders] tick failed", e));
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 30_000).unref?.();
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

