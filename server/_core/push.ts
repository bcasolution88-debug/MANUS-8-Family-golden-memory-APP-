/**
 * P10 — Expo Push delivery (https://docs.expo.dev/push-notifications/sending-notifications/).
 *
 * Plain HTTP against https://exp.host/--/api/v2/push/send — no SDK. Messages
 * are batched 100 at a time; `DeviceNotRegistered` receipts mark the token as
 * failed so it is skipped next time and pruned after PUSH_TOKEN_TTL_DAYS.
 *
 * `EXPO_ACCESS_TOKEN` is optional but recommended in production (enhanced
 * security + higher rate limits). Without network access or in tests set
 * `PUSH_DRY_RUN=1` to log instead of calling Expo.
 */
import { and, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { pushTokens, userPreferences, type NotificationType } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { recordMetric } from "./metrics";
import { bumpExperiment, copyVariantB, copyVariantFor, enqueueDigest, wantsDigest } from "./pushDigest";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  /** P15: rich push — Expo forwards `richContent.image` as an iOS attachment / Android big picture. */
  richContent?: { image: string };
  /** iOS: required for the notification-service extension to download the attachment. */
  mutableContent?: boolean;
}

export interface PushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const PUSH_BATCH = 100;
export const PUSH_TOKEN_TTL_DAYS = 90;

export function isPushConfigured(): boolean {
  return !!process.env.EXPO_ACCESS_TOKEN;
}

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/.test(token);
}

/** Send to Expo in batches; returns tickets aligned with `messages`. */
export async function sendExpoPush(messages: PushMessage[]): Promise<PushTicket[]> {
  if (messages.length === 0) return [];
  if (process.env.PUSH_DRY_RUN === "1") {
    console.log(`[push:dry-run] ${messages.length} message(s)`, messages.map((m) => `${m.to} ← ${m.title}`).join("; "));
    return messages.map(() => ({ status: "ok" as const, id: `dry-${crypto.randomUUID()}` }));
  }
  const tickets: PushTicket[] = [];
  for (let i = 0; i < messages.length; i += PUSH_BATCH) {
    const chunk = messages.slice(i, i + PUSH_BATCH);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk.map((m) => ({ sound: "default", priority: "high", ...m }))),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        tickets.push(...chunk.map(() => ({ status: "error" as const, message: `Expo ${res.status}: ${text.slice(0, 160)}` })));
        continue;
      }
      const json = (await res.json()) as { data?: PushTicket[] };
      tickets.push(...(json.data ?? chunk.map(() => ({ status: "error" as const, message: "Malformed Expo response" }))));
    } catch (error) {
      tickets.push(...chunk.map(() => ({ status: "error" as const, message: error instanceof Error ? error.message : "Push send failed" })));
    }
  }
  return tickets;
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

export function pushCopy(type: NotificationType, opts: { actor?: string | null; preview?: string | null; zh?: boolean }): { title: string; body: string } {
  const zh = opts.zh ?? true;
  const who = opts.actor?.trim() || (zh ? "家人" : "A family member");
  const preview = opts.preview?.trim();
  const map: Record<NotificationType, { title: string; body: string }> = {
    like: { title: zh ? "收到一个赞" : "New like", body: zh ? `${who} 赞了您的照片` : `${who} liked your photo` },
    comment: { title: zh ? "新评论" : "New comment", body: preview ? `${who}: ${preview}` : zh ? `${who} 评论了您的照片` : `${who} commented on your photo` },
    reply: { title: zh ? "新回复" : "New reply", body: preview ? `${who}: ${preview}` : zh ? `${who} 回复了您` : `${who} replied to you` },
    upload: { title: zh ? "新照片" : "New photos", body: preview ? (zh ? `${who} 上传到「${preview}」` : `${who} added to “${preview}”`) : zh ? `${who} 上传了新照片` : `${who} uploaded new photos` },
    invite: { title: zh ? "家庭邀请" : "Family invitation", body: preview ? (zh ? `${who} 邀请您加入「${preview}」` : `${who} invited you to “${preview}”`) : zh ? `${who} 邀请您加入家庭` : `${who} invited you to a family` },
    member_joined: { title: zh ? "新成员加入" : "New member", body: zh ? `${who} 加入了家庭` : `${who} joined the family` },
    anniversary: { title: zh ? "纪念日提醒" : "Anniversary reminder", body: preview ?? (zh ? "有一个纪念日快到了" : "An anniversary is coming up") },
    share: { title: zh ? "分享" : "Shared", body: preview ? `${who}: ${preview}` : zh ? `${who} 分享了内容` : `${who} shared something` },
    system: { title: zh ? "金色韶华" : "Golden Memory", body: preview ?? "" },
  };
  return map[type];
}

/* ------------------------------------------------------------------ */
/* Deep links (P11)                                                    */
/* ------------------------------------------------------------------ */

/**
 * In-app route the client should open when the user taps the notification.
 * Mirrors Expo Router paths; the client just does `router.push(route)`.
 */
export function pushRoute(type: NotificationType, data: { mediaId?: number | null; albumId?: number | null; familyId?: number | null; commentId?: number | null }): string {
  const media = data.mediaId ? `/photo/${data.mediaId}${data.commentId ? `?commentId=${data.commentId}` : ""}` : null;
  switch (type) {
    case "like":
    case "comment":
    case "reply":
      return media ?? "/(tabs)/messages";
    case "upload":
    case "share":
      return media ?? (data.albumId ? `/album?albumId=${data.albumId}` : "/(tabs)/album");
    case "invite":
    case "member_joined":
      return "/members";
    case "anniversary":
      return "/anniversary";
    case "system":
    default:
      return "/(tabs)/messages";
  }
}

/* ------------------------------------------------------------------ */
/* P12 — quiet hours + per-type / per-family mutes                     */
/* ------------------------------------------------------------------ */

/** Minutes since local midnight in `tz` (falls back to UTC on bad zone). */
export function localMinutes(now: Date, tz: string | null | undefined): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** True when `now` falls inside [start, end) — the window may wrap midnight (e.g. 22:00 → 07:00). */
export function inQuietHours(prefs: { quietStart: number | null; quietEnd: number | null; quietTz: string | null }, now = new Date()): boolean {
  if (prefs.quietStart == null || prefs.quietEnd == null || prefs.quietStart === prefs.quietEnd) return false;
  const cur = localMinutes(now, prefs.quietTz);
  return prefs.quietStart < prefs.quietEnd ? cur >= prefs.quietStart && cur < prefs.quietEnd : cur >= prefs.quietStart || cur < prefs.quietEnd;
}

function parseList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export interface PushGatePrefs {
  pushEnabled: boolean;
  quietStart: number | null;
  quietEnd: number | null;
  quietTz: string | null;
  pushMutedTypes: string | null;
  pushMutedFamilies: string | null;
}

/** Why a push would be suppressed for this recipient, or null to deliver. Invites always go through. */
export function pushSuppressReason(prefs: PushGatePrefs, type: NotificationType, familyId: number | null | undefined, now = new Date()): "disabled" | "quiet" | "type" | "family" | null {
  if (!prefs.pushEnabled) return "disabled";
  if (type === "invite" || type === "system") return null;
  if (parseList<string>(prefs.pushMutedTypes).includes(type)) return "type";
  if (familyId && parseList<number>(prefs.pushMutedFamilies).includes(familyId)) return "family";
  if (inQuietHours(prefs, now)) return "quiet";
  return null;
}

/* ------------------------------------------------------------------ */
/* Fan-out                                                             */
/* ------------------------------------------------------------------ */

export interface PushFanoutInput {
  userIds: number[];
  type: NotificationType;
  actorName?: string | null;
  preview?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Deliver one notification type to every healthy device of the given users.
 * Honors `pushEnabled` (per-user). Never throws — push is best-effort.
 */
export async function pushToUsers(input: PushFanoutInput): Promise<{ sent: number; failed: number; skipped: number; digested?: number }> {
  const out: { sent: number; failed: number; skipped: number; digested?: number } = { sent: 0, failed: 0, skipped: 0 };
  if (input.userIds.length === 0) return out;
  try {
    const database = await getDb();
    if (!database) return out;
    // P12: per-recipient gate — disabled, quiet hours, muted type, muted family.
    const prefRows = await database
      .select({ userId: userPreferences.userId, pushEnabled: userPreferences.pushEnabled, quietStart: userPreferences.quietStart, quietEnd: userPreferences.quietEnd, quietTz: userPreferences.quietTz, pushMutedTypes: userPreferences.pushMutedTypes, pushMutedFamilies: userPreferences.pushMutedFamilies, pushDigest: userPreferences.pushDigest })
      .from(userPreferences)
      .where(inArray(userPreferences.userId, input.userIds));
    const prefById = new Map(prefRows.map((r) => [r.userId, r]));
    const familyId = (input.data?.familyId as number | undefined) ?? null;
    const digested: number[] = [];
    const targets = input.userIds.filter((id) => {
      const p = prefById.get(id);
      if (!p) return true; // no prefs row → defaults (push on, no quiet hours)
      if (pushSuppressReason(p, input.type, familyId) !== null) return false;
      // P13: digest users get interaction pushes batched instead of now.
      if (wantsDigest(p, input.type)) {
        digested.push(id);
        return false;
      }
      return true;
    });
    out.skipped = input.userIds.length - targets.length - digested.length;
    if (digested.length) {
      out.digested = digested.length;
      await enqueueDigest(digested.map((userId) => ({ userId, type: input.type, actorName: input.actorName, preview: input.preview, familyId })));
    }
    if (targets.length === 0) return out;

    const rows = await database
      .select({ id: pushTokens.id, token: pushTokens.token, userId: pushTokens.userId })
      .from(pushTokens)
      .where(and(inArray(pushTokens.userId, targets), isNull(pushTokens.failedAt)));
    if (rows.length === 0) return out;

    const copyA = pushCopy(input.type, { actor: input.actorName, preview: input.preview });
    const copyB = copyVariantB(input.type, { actor: input.actorName, preview: input.preview }) ?? copyA;
    const route = (input.data?.route as string | undefined) ?? pushRoute(input.type, input.data ?? {});
    const messages = rows.map((r) => {
      const variant = copyVariantFor(r.userId);
      const copy = variant === "B" ? copyB : copyA;
      return { to: r.token, title: copy.title, body: copy.body, data: { type: input.type, ...input.data, route, variant } };
    });
    const tickets = await sendExpoPush(messages);
    // P14: A/B send tallies (only when the type has a B variant)
    if (copyB !== copyA) {
      let a = 0;
      let b = 0;
      tickets.forEach((t, i) => {
        if (t.status !== "ok") return;
        if ((messages[i]!.data as { variant?: string }).variant === "B") b += 1;
        else a += 1;
      });
      void bumpExperiment("sentA", a);
      void bumpExperiment("sentB", b);
    }

    const dead: number[] = [];
    tickets.forEach((t, i) => {
      if (t.status === "ok") out.sent += 1;
      else {
        out.failed += 1;
        if (t.details?.error === "DeviceNotRegistered") dead.push(rows[i]!.id);
      }
      recordMetric("push", t.status === "ok", { detail: t.status === "ok" ? input.type : (t.details?.error ?? t.message ?? "error") });
    });
    if (dead.length) await database.update(pushTokens).set({ failedAt: new Date() }).where(inArray(pushTokens.id, dead));
  } catch (error) {
    console.error("[push] fan-out failed", error);
  }
  return out;
}

/** Remove tokens that failed or were not seen for PUSH_TOKEN_TTL_DAYS. */
export async function prunePushTokens(days = PUSH_TOKEN_TTL_DAYS): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const result = await database.delete(pushTokens).where(or(lt(pushTokens.lastSeenAt, cutoff), and(sql`${pushTokens.failedAt} IS NOT NULL`, lt(pushTokens.failedAt, new Date(Date.now() - 7 * 86_400_000)))));
  return Number((result[0] as { affectedRows?: number }).affectedRows ?? 0);
}
