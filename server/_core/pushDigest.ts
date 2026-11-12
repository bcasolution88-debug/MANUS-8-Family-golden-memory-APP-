/**
 * P13 — push digests + copy A/B experiment.
 *
 * Digest
 *   Users with `pushDigest = daily | weekly` do not get an immediate push for
 *   interaction types (like / comment / reply / upload / share / member_joined).
 *   Those are parked in `pushDigestQueue`; a leader-only scheduler (every 15 min)
 *   finds users whose local hour == `pushDigestHour` and who have not had a
 *   digest in the last ~20h (daily) / ~6.8d (weekly), builds one summary push
 *   ("3 赞 · 2 评论 · 1 新照片 — 来自 妈妈、小雅…"), sends it and clears the queue.
 *   Invites, anniversaries and system notices always go out immediately.
 *
 * A/B copy
 *   `PUSH_COPY_EXPERIMENT=1` enables two copy variants (A = current, B = warmer /
 *   emoji-led). Variant is a stable hash of (userId, experiment) so a person
 *   always sees the same style; the variant rides in `data.variant` and the
 *   client reports taps via `push.opened` → `metricEvents.push_open` with
 *   detail `A:like` / `B:like`, so the ops panel can compare open counts.
 *
 * P14
 *   - per-family digests (`pushDigestPerFamily`), one push per family
 *   - smart hour (`pushDigestSmart`): most frequent local tap hour from the
 *     last 30 days of push_open events (≥ SMART_HOUR_MIN_OPENS) overrides pushDigestHour
 *   - auto-promotion: `copyExperimentStats` tallies sends / opens per arm; once
 *     both arms have ≥ AB_MIN_SENT_PER_ARM sends and one wins (z ≥ 1.96, lift ≥
 *     AB_MIN_LIFT) the winner is promoted for everyone. `AB_AUTO_PROMOTE=0` disables.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { albums, copyExperimentStats, families, familyMembers, media, metricEvents, pushDigestQueue, pushTokens, userPreferences, type NotificationType } from "@/drizzle/schema";
import { isStorageConfigured, storageGetSignedUrl } from "@/server/storage";
import { getDb } from "@/server/db";
import { runIfLeader } from "./coordination";
import { recordMetric } from "./metrics";
import { localMinutes, sendExpoPush, type PushMessage } from "./push";

export const DIGEST_TYPES: ReadonlySet<NotificationType> = new Set(["like", "comment", "reply", "upload", "share", "member_joined"]);
export const PUSH_COPY_EXPERIMENT = "copy-v1";

/* ------------------------------------------------------------------ */
/* A/B                                                                 */
/* ------------------------------------------------------------------ */

export type CopyVariant = "A" | "B";

export function copyExperimentEnabled(): boolean {
  return process.env.PUSH_COPY_EXPERIMENT === "1";
}

/** Stable 50/50 assignment per user (sha1 of userId + experiment name). P14: a promoted winner overrides. */
export function copyVariantFor(userId: number, experiment = PUSH_COPY_EXPERIMENT): CopyVariant {
  if (!copyExperimentEnabled()) return "A";
  const w = promotedWinner.get(experiment);
  if (w) return w;
  const h = createHash("sha1").update(`${experiment}:${userId}`).digest();
  return (h[0]! & 1) === 0 ? "A" : "B";
}

/* P14 — auto-promote the winning copy variant                        */

const promotedWinner = new Map<string, CopyVariant>();
export const AB_MIN_SENT_PER_ARM = Math.max(10, Number(process.env.AB_MIN_SENT_PER_ARM ?? 200));
export const AB_MIN_LIFT = Number(process.env.AB_MIN_LIFT ?? 0.15);

/** Test hook. */
export function __setPromotedWinner(experiment: string, v: CopyVariant | null): void {
  if (v) promotedWinner.set(experiment, v);
  else promotedWinner.delete(experiment);
}

/**
 * Pure: pick a winner once both arms have enough sends and one arm's open rate
 * beats the other by at least `minLift` (relative) with a crude two-proportion
 * z-test (|z| ≥ 1.96). Returns null while inconclusive.
 */
export function decideWinner(stats: { sentA: number; sentB: number; openA: number; openB: number }, minSent = AB_MIN_SENT_PER_ARM, minLift = AB_MIN_LIFT): CopyVariant | null {
  if (stats.sentA < minSent || stats.sentB < minSent) return null;
  const pA = stats.openA / stats.sentA;
  const pB = stats.openB / stats.sentB;
  if (pA === 0 && pB === 0) return null;
  const pooled = (stats.openA + stats.openB) / (stats.sentA + stats.sentB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / stats.sentA + 1 / stats.sentB));
  if (se === 0) return null;
  const z = (pB - pA) / se;
  const lift = Math.abs(pB - pA) / Math.max(pA, pB);
  if (Math.abs(z) < 1.96 || lift < minLift) return null;
  return z > 0 ? "B" : "A";
}

export async function bumpExperiment(field: "sentA" | "sentB" | "openA" | "openB", n = 1, experiment = PUSH_COPY_EXPERIMENT): Promise<void> {
  if (!copyExperimentEnabled() || n <= 0) return;
  const database = await getDb();
  if (!database) return;
  await database
    .insert(copyExperimentStats)
    .values({ experiment, [field]: n } as typeof copyExperimentStats.$inferInsert)
    .onDuplicateKeyUpdate({ set: { [field]: sql`${copyExperimentStats[field]} + ${n}` } as never });
}

/** Load the promoted winner (if any) into memory and, when undecided, try to decide. */
export async function refreshExperiment(experiment = PUSH_COPY_EXPERIMENT, now = new Date()): Promise<{ winner: CopyVariant | null; stats: { sentA: number; sentB: number; openA: number; openB: number } | null }> {
  const database = await getDb();
  if (!database) return { winner: null, stats: null };
  const [row] = await database.select().from(copyExperimentStats).where(eq(copyExperimentStats.experiment, experiment)).limit(1);
  if (!row) return { winner: null, stats: null };
  if (row.winner === "A" || row.winner === "B") {
    promotedWinner.set(experiment, row.winner);
    return { winner: row.winner, stats: row };
  }
  const w = process.env.AB_AUTO_PROMOTE === "0" ? null : decideWinner(row);
  if (w) {
    await database.update(copyExperimentStats).set({ winner: w, decidedAt: now }).where(eq(copyExperimentStats.experiment, experiment));
    promotedWinner.set(experiment, w);
    console.log(`[ab] promoted variant ${w} for ${experiment} (A ${row.openA}/${row.sentA} · B ${row.openB}/${row.sentB})`);
  }
  return { winner: w, stats: row };
}

/** Admin: reset the experiment (clear winner + counters). */
export async function resetExperiment(experiment = PUSH_COPY_EXPERIMENT): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.delete(copyExperimentStats).where(eq(copyExperimentStats.experiment, experiment));
  promotedWinner.delete(experiment);
}

/** Variant B copy — warmer, emoji-led, first-name-first. Falls back to A for types without a B. */
export function copyVariantB(type: NotificationType, opts: { actor?: string | null; preview?: string | null; zh?: boolean }): { title: string; body: string } | null {
  const zh = opts.zh ?? true;
  const who = opts.actor?.trim() || (zh ? "家人" : "Someone");
  const preview = opts.preview?.trim();
  switch (type) {
    case "like":
      return { title: zh ? `❤️ ${who} 喜欢这张照片` : `❤️ ${who} loved your photo`, body: zh ? "点开看看是哪一张" : "Tap to see which one" };
    case "comment":
      return { title: zh ? `💬 ${who} 留了言` : `💬 ${who} left a note`, body: preview ?? (zh ? "快去回复吧" : "Reply when you can") };
    case "reply":
      return { title: zh ? `↩️ ${who} 回复了您` : `↩️ ${who} replied`, body: preview ?? "" };
    case "upload":
      return { title: zh ? `📷 ${who} 分享了新回忆` : `📷 ${who} added new memories`, body: preview ? (zh ? `相册「${preview}」有新内容` : `New in “${preview}”`) : zh ? "来看看吧" : "Come take a look" };
    case "share":
      return { title: zh ? `🔗 ${who} 分享了内容` : `🔗 ${who} shared something`, body: preview ?? "" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Digest queue                                                        */
/* ------------------------------------------------------------------ */

export interface DigestPrefs {
  pushDigest: "off" | "daily" | "weekly";
  pushDigestHour: number;
  quietTz: string | null;
  lastDigestAt: Date | null;
}

/* P14 — smart delivery hour: the local hour the user most often taps pushes */

export const SMART_HOUR_MIN_OPENS = Math.max(3, Number(process.env.SMART_HOUR_MIN_OPENS ?? 5));

/** Pure: most frequent local hour among open timestamps (ties → earliest); null when too few. */
export function smartHourFrom(opens: Date[], tz: string | null, minOpens = SMART_HOUR_MIN_OPENS): number | null {
  if (opens.length < minOpens) return null;
  const counts = new Array<number>(24).fill(0);
  for (const d of opens) counts[Math.floor(localMinutes(d, tz) / 60)]! += 1;
  let best = 0;
  for (let h = 1; h < 24; h++) if (counts[h]! > counts[best]!) best = h;
  return best;
}

/** Learned hour per user from the last 30 days of push_open events. */
export async function learnSmartHours(userIds: number[], tz: Map<number, string | null>, now = new Date()): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const database = await getDb();
  if (!database || userIds.length === 0) return out;
  const rows = await database
    .select({ userId: metricEvents.userId, at: metricEvents.createdAt })
    .from(metricEvents)
    .where(and(eq(metricEvents.kind, "push_open"), inArray(metricEvents.userId, userIds), gte(metricEvents.createdAt, new Date(now.getTime() - 30 * 86_400_000))));
  const byUser = new Map<number, Date[]>();
  for (const r of rows) if (r.userId != null) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.at]);
  for (const [uid, dates] of byUser) {
    const h = smartHourFrom(dates, tz.get(uid) ?? null);
    if (h != null) out.set(uid, h);
  }
  return out;
}

export function wantsDigest(prefs: Pick<DigestPrefs, "pushDigest">, type: NotificationType): boolean {
  return prefs.pushDigest !== "off" && DIGEST_TYPES.has(type);
}

/** Park an interaction for the user's next digest. */
export async function enqueueDigest(rows: Array<{ userId: number; type: NotificationType; actorName?: string | null; preview?: string | null; familyId?: number | null }>): Promise<void> {
  if (rows.length === 0) return;
  const database = await getDb();
  if (!database) return;
  await database.insert(pushDigestQueue).values(rows.map((r) => ({ userId: r.userId, type: r.type, actorName: r.actorName?.slice(0, 128) ?? null, preview: r.preview?.slice(0, 500) ?? null, familyId: r.familyId ?? null })));
}

/** Pure: is `now` the delivery slot for this user? Delivery hour in the user's tz, min spacing guards double sends. */
export function digestDue(prefs: DigestPrefs, now = new Date()): boolean {
  if (prefs.pushDigest === "off") return false;
  const minutes = localMinutes(now, prefs.quietTz);
  if (Math.floor(minutes / 60) !== prefs.pushDigestHour) return false;
  const minGap = prefs.pushDigest === "daily" ? 20 * 3_600_000 : 6.8 * 86_400_000;
  if (prefs.lastDigestAt && now.getTime() - prefs.lastDigestAt.getTime() < minGap) return false;
  if (prefs.pushDigest === "weekly") {
    // Weekly digests land on Sunday (local).
    const day = new Intl.DateTimeFormat("en-US", { timeZone: prefs.quietTz || "UTC", weekday: "short" }).format(now);
    if (day !== "Sun") return false;
  }
  return true;
}

const TYPE_LABEL_ZH: Partial<Record<NotificationType, string>> = { like: "赞", comment: "评论", reply: "回复", upload: "新照片", share: "分享", member_joined: "新成员" };
const TYPE_LABEL_EN: Partial<Record<NotificationType, string>> = { like: "likes", comment: "comments", reply: "replies", upload: "new photos", share: "shares", member_joined: "new members" };

/** P14 pure: split queued rows by family (null family → its own group). */
export function groupByFamily<T extends { familyId: number | null }>(rows: T[]): Array<{ familyId: number | null; rows: T[] }> {
  const map = new Map<number | null, T[]>();
  for (const r of rows) map.set(r.familyId, [...(map.get(r.familyId) ?? []), r]);
  return [...map.entries()].map(([familyId, rows]) => ({ familyId, rows }));
}

/** Pure: build the digest copy from queued rows. P14: optional family name in the title. */
export function digestCopy(rows: Array<{ type: NotificationType; actorName: string | null }>, period: "daily" | "weekly", zh = true, familyName: string | null = null): { title: string; body: string } {
  const counts = new Map<NotificationType, number>();
  const actors: string[] = [];
  for (const r of rows) {
    counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    if (r.actorName && !actors.includes(r.actorName)) actors.push(r.actorName);
  }
  const order: NotificationType[] = ["like", "comment", "reply", "upload", "share", "member_joined"];
  const parts = order.filter((t) => counts.has(t)).map((t) => (zh ? `${counts.get(t)} ${TYPE_LABEL_ZH[t]}` : `${counts.get(t)} ${TYPE_LABEL_EN[t]}`));
  const who = actors.slice(0, 3).join(zh ? "、" : ", ") + (actors.length > 3 ? (zh ? ` 等 ${actors.length} 人` : ` and ${actors.length - 3} more`) : "");
  const base = zh ? (period === "daily" ? "今日家庭动态" : "本周家庭动态") : period === "daily" ? "Today in your family" : "This week in your family";
  const title = familyName ? (zh ? `${base} · ${familyName}` : `${base} · ${familyName}`) : base;
  const body = `${parts.join(" · ")}${who ? (zh ? ` — 来自 ${who}` : ` — from ${who}`) : ""}`;
  return { title, body: body || (zh ? "有新的互动" : "New activity") };
}

/* P15 — weekly picks: the hottest photos feed the digest as a rich push      */

export interface HighlightCandidate {
  id: number;
  familyId: number;
  type: "photo" | "video";
  title: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  thumbnailKey: string | null;
  storageKey: string | null;
  isPrivate: boolean;
}

/**
 * Pure: score = likes × 2 + comments × 3, recency bonus for the last 48 h;
 * photos only (videos have no still), private albums excluded, ties → newest.
 */
export function pickHighlights(rows: HighlightCandidate[], now = new Date(), take = 3): HighlightCandidate[] {
  const score = (r: HighlightCandidate) => r.likeCount * 2 + r.commentCount * 3 + (now.getTime() - r.createdAt.getTime() < 48 * 3_600_000 ? 1 : 0);
  return rows
    .filter((r) => r.type === "photo" && !r.isPrivate && (r.thumbnailKey || r.storageKey) && score(r) > 0)
    .sort((a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}

/** Pure: one-line caption appended to the digest body. */
export function highlightsCaption(picks: Array<Pick<HighlightCandidate, "title" | "likeCount" | "commentCount">>, zh = true): string {
  if (!picks.length) return "";
  const top = picks[0]!;
  const name = top.title?.trim() || (zh ? "一张照片" : "a photo");
  const more = picks.length > 1 ? (zh ? ` 等 ${picks.length} 张精选` : ` and ${picks.length - 1} more`) : "";
  return zh ? ` · 本周精选：「${name}」${top.likeCount} 赞 ${top.commentCount} 评${more}` : ` · Picks: “${name}” ${top.likeCount} likes ${top.commentCount} comments${more}`;
}

/** Hottest photos per family over the digest period for the given users' families. */
async function loadHighlights(familyIds: number[], period: "daily" | "weekly", now: Date): Promise<Map<number, HighlightCandidate[]>> {
  const out = new Map<number, HighlightCandidate[]>();
  const database = await getDb();
  if (!database || !familyIds.length) return out;
  const since = new Date(now.getTime() - (period === "weekly" ? 7 : 1) * 86_400_000);
  const rows = await database
    .select({ id: media.id, familyId: media.familyId, type: media.type, title: media.title, likeCount: media.likeCount, commentCount: media.commentCount, createdAt: media.createdAt, thumbnailKey: media.thumbnailKey, storageKey: media.storageKey, isPrivate: albums.isPrivate })
    .from(media)
    .innerJoin(albums, eq(albums.id, media.albumId))
    .where(and(inArray(media.familyId, familyIds), gte(media.createdAt, since), eq(media.type, "photo")));
  const byFamily = new Map<number, HighlightCandidate[]>();
  for (const r of rows) byFamily.set(r.familyId, [...(byFamily.get(r.familyId) ?? []), { ...r, isPrivate: !!r.isPrivate }]);
  for (const [fid, list] of byFamily) out.set(fid, pickHighlights(list, now));
  return out;
}

async function highlightImageUrl(pick: HighlightCandidate | undefined): Promise<string | null> {
  const key = pick?.thumbnailKey ?? pick?.storageKey ?? null;
  if (!key || !isStorageConfigured()) return null;
  try {
    return await storageGetSignedUrl(key);
  } catch {
    return null;
  }
}

/** Deliver due digests. Returns number of users pushed. */
export async function runDigests(now = new Date()): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const prefsRaw = await database
    .select({ userId: userPreferences.userId, pushDigest: userPreferences.pushDigest, pushDigestHour: userPreferences.pushDigestHour, quietTz: userPreferences.quietTz, lastDigestAt: userPreferences.lastDigestAt, pushEnabled: userPreferences.pushEnabled, pushDigestSmart: userPreferences.pushDigestSmart, pushDigestPerFamily: userPreferences.pushDigestPerFamily, pushDigestHighlights: userPreferences.pushDigestHighlights })
    .from(userPreferences)
    .where(sql`${userPreferences.pushDigest} <> 'off'`);
  // P14: smart hour overrides the configured hour when we have enough tap history.
  const smartUsers = prefsRaw.filter((p) => p.pushDigestSmart).map((p) => p.userId);
  const learned = await learnSmartHours(smartUsers, new Map(prefsRaw.map((p) => [p.userId, p.quietTz])), now);
  const prefs = prefsRaw.map((p) => ({ ...p, pushDigestHour: p.pushDigestSmart && learned.has(p.userId) ? learned.get(p.userId)! : p.pushDigestHour }));
  const due = prefs.filter((p) => p.pushEnabled && digestDue(p, now));
  if (due.length === 0) return 0;
  const queued = await database.select().from(pushDigestQueue).where(inArray(pushDigestQueue.userId, due.map((d) => d.userId)));
  const byUser = new Map<number, typeof queued>();
  for (const q of queued) byUser.set(q.userId, [...(byUser.get(q.userId) ?? []), q]);
  const tokens = await database.select({ userId: pushTokens.userId, token: pushTokens.token }).from(pushTokens).where(and(inArray(pushTokens.userId, due.map((d) => d.userId)), isNull(pushTokens.failedAt)));
  const tokensByUser = new Map<number, string[]>();
  for (const t of tokens) tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token]);

  // P14: family names for per-family grouping
  const familyIds = [...new Set(queued.map((q) => q.familyId).filter((f): f is number => f != null))];
  const familyNames = new Map<number, string>();
  if (familyIds.length) for (const f of await database.select({ id: families.id, name: families.name }).from(families).where(inArray(families.id, familyIds))) familyNames.set(f.id, f.name);

  // P15: weekly picks — hottest photos in the user's families (memberships → candidate families)
  const wantHighlights = due.filter((d) => d.pushDigestHighlights && (byUser.get(d.userId)?.length ?? 0) > 0).map((d) => d.userId);
  const memberFamilies = new Map<number, number[]>();
  if (wantHighlights.length) for (const m of await database.select({ userId: familyMembers.userId, familyId: familyMembers.familyId }).from(familyMembers).where(inArray(familyMembers.userId, wantHighlights))) memberFamilies.set(m.userId, [...(memberFamilies.get(m.userId) ?? []), m.familyId]);
  const allFamilies = [...new Set([...familyIds, ...[...memberFamilies.values()].flat()])];
  const periods = new Set(due.map((d) => d.pushDigest as "daily" | "weekly"));
  const highlightsByPeriod = new Map<"daily" | "weekly", Map<number, HighlightCandidate[]>>();
  for (const per of periods) highlightsByPeriod.set(per, wantHighlights.length ? await loadHighlights(allFamilies, per, now) : new Map());
  const imageUrlCache = new Map<number, string | null>();

  let pushed = 0;
  const messages: PushMessage[] = [];
  const doneUsers: number[] = [];
  for (const p of due) {
    const rows = byUser.get(p.userId) ?? [];
    doneUsers.push(p.userId);
    if (rows.length === 0) continue;
    const variant = copyVariantFor(p.userId);
    const period = p.pushDigest as "daily" | "weekly";
    const groups = p.pushDigestPerFamily ? groupByFamily(rows) : [{ familyId: null as number | null, rows }];
    for (const g of groups) {
      const copy = digestCopy(g.rows, period, true, g.familyId != null ? (familyNames.get(g.familyId) ?? null) : null);
      const route = g.familyId != null ? `/(tabs)/messages?familyId=${g.familyId}` : "/(tabs)/messages";
      // picks: this family's, or the best across the user's families when not grouped
      let picks: HighlightCandidate[] = [];
      if (p.pushDigestHighlights) {
        const hl = highlightsByPeriod.get(period)!;
        const fams = g.familyId != null ? [g.familyId] : (memberFamilies.get(p.userId) ?? []);
        picks = pickHighlights(fams.flatMap((f) => hl.get(f) ?? []), now);
      }
      const top = picks[0];
      let image: string | null = null;
      if (top) {
        if (!imageUrlCache.has(top.id)) imageUrlCache.set(top.id, await highlightImageUrl(top));
        image = imageUrlCache.get(top.id) ?? null;
      }
      const body = copy.body + highlightsCaption(picks, true);
      const data: Record<string, unknown> = { type: "digest", route: top ? `/photo/${top.id}` : route, count: g.rows.length, familyId: g.familyId ?? undefined, variant, highlights: picks.map((h) => h.id) };
      for (const to of tokensByUser.get(p.userId) ?? []) messages.push({ to, title: copy.title, body, data, ...(image ? { richContent: { image }, mutableContent: true } : {}) });
    }
    pushed += 1;
  }
  const tickets = await sendExpoPush(messages);
  tickets.forEach((t) => recordMetric("push", t.status === "ok", { detail: t.status === "ok" ? "digest" : (t.details?.error ?? t.message ?? "error") }));
  if (doneUsers.length) {
    await database.delete(pushDigestQueue).where(inArray(pushDigestQueue.userId, doneUsers));
    await database.update(userPreferences).set({ lastDigestAt: now }).where(inArray(userPreferences.userId, doneUsers));
  }
  return pushed;
}

/** Drop parked rows older than 14 days (user turned the digest off, or no devices). */
export async function pruneDigestQueue(days = 14): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const r = await database.delete(pushDigestQueue).where(or(lt(pushDigestQueue.createdAt, new Date(Date.now() - days * 86_400_000)), eq(pushDigestQueue.userId, -1)));
  return Number((r[0] as { affectedRows?: number }).affectedRows ?? 0);
}

let timer: NodeJS.Timeout | null = null;
export function startDigestScheduler(intervalMs = 15 * 60 * 1000): void {
  if (process.env.DIGEST_SCHEDULER === "0" || timer) return;
  const tick = () =>
    void runIfLeader("push-digests", 10 * 60 * 1000, async () => {
      await pruneDigestQueue();
      await refreshExperiment().catch(() => undefined); // P14: auto-promote winner
      return runDigests();
    }).catch((e) => console.error("[digest] tick failed", e));
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 60_000).unref?.();
}

export function stopDigestScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
