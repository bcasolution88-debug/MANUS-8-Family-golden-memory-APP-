/**
 * P8 — AI photo understanding + recommendations.
 *
 *   analyze        vision LLM over a signed photo URL → caption / title / mood /
 *                  tags / people (persisted in `mediaAnalysis`; cached unless force)
 *   get            cached analysis for one photo
 *   tagPerson      link a detected person to a family member (or clear)
 *   peopleIndex    "who appears where" for a family (for person filters)
 *   byPerson       photos a member is tagged in
 *   recommend      home-screen suggestions: on-this-day, untitled gems, best
 *                  share hour, next anniversary — computed from real data
 *
 * The LLM is optional: without BUILT_IN_FORGE_API_* the `analyze` call falls
 * back to a deterministic heuristic (date / album based tags, no people).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { albums, anniversaries, comments, familyMembers, likes, media, mediaAnalysis, users } from "@/drizzle/schema";
import { requireFamilyMember, requireMediaAccess } from "@/server/_core/authorization";
import { ENV } from "@/server/_core/env";
import { invokeLLM } from "@/server/_core/llm";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { getDb } from "@/server/db";
import { isStorageConfigured, storageGetSignedUrl } from "@/server/storage";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

export interface DetectedPerson {
  /** Stable within one analysis, e.g. "p1". */
  id: string;
  /** Short label from the model ("elderly woman in red", "young boy"). */
  label: string;
  description?: string;
  /** Normalized [x, y, w, h] in 0–1, when the model provides one. */
  box?: [number, number, number, number];
  /** Linked family member (set via tagPerson). */
  userId?: number;
}

export interface AnalysisResult {
  mediaId: number;
  caption: string | null;
  suggestedTitle: string | null;
  mood: string | null;
  tags: string[];
  people: DetectedPerson[];
  model: string | null;
  analyzedAt: Date;
  source: "llm" | "heuristic" | "cache";
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toResult(row: typeof mediaAnalysis.$inferSelect, source: AnalysisResult["source"]): AnalysisResult {
  return {
    mediaId: row.mediaId,
    caption: row.caption,
    suggestedTitle: row.suggestedTitle,
    mood: row.mood,
    tags: parseJson<string[]>(row.tags, []),
    people: parseJson<DetectedPerson[]>(row.people, []),
    model: row.model,
    analyzedAt: row.analyzedAt,
    source,
  };
}

const MOODS = ["warm", "joyful", "calm", "nostalgic", "festive", "solemn", "playful"] as const;

/** Deterministic fallback so the UI always gets something useful. */
function heuristicAnalysis(item: typeof media.$inferSelect, albumName: string | null, zh: boolean) {
  const d = item.createdAt;
  const month = d.getMonth() + 1;
  const season = month <= 2 || month === 12 ? (zh ? "冬日" : "winter") : month <= 5 ? (zh ? "春日" : "spring") : month <= 8 ? (zh ? "夏日" : "summer") : zh ? "秋日" : "autumn";
  const tags = [season, albumName, item.type === "video" ? (zh ? "视频" : "video") : zh ? "照片" : "photo"].filter((t): t is string => !!t);
  return {
    caption: item.description ?? (zh ? `${albumName ?? "家庭"}的${season}回忆` : `A ${season} memory from ${albumName ?? "the family"}`),
    suggestedTitle: item.title ?? (zh ? `${season} · ${albumName ?? "回忆"}` : `${season[0]!.toUpperCase()}${season.slice(1)} · ${albumName ?? "Memory"}`),
    mood: "warm",
    tags,
    people: [] as DetectedPerson[],
  };
}

async function runVision(url: string, item: typeof media.$inferSelect, albumName: string | null, zh: boolean) {
  const prompt = zh
    ? `你是家庭相册的助手。请看这张照片（相册「${albumName ?? ""}」，拍摄/上传于 ${item.createdAt.toISOString().slice(0, 10)}${item.title ? `，现有标题「${item.title}」` : ""}）。只输出 JSON：
{"caption": 不超过 60 字的温暖中文描述, "suggestedTitle": 不超过 12 字的标题, "mood": ${JSON.stringify(MOODS)} 之一, "tags": 3–6 个中文标签（场景/活动/物件/季节）, "people": [{"id":"p1","label":"不超过 12 字的人物描述（年龄段+特征，不要猜姓名）","box":[x,y,w,h] 归一化 0–1，可省略}]}
不要识别身份；people 最多 6 人；没有人物则为空数组。`
    : `You help organise a family photo album. Look at this photo (album "${albumName ?? ""}", taken/uploaded ${item.createdAt.toISOString().slice(0, 10)}${item.title ? `, current title "${item.title}"` : ""}). Return JSON only:
{"caption": warm description ≤ 160 chars, "suggestedTitle": ≤ 40 chars, "mood": one of ${JSON.stringify(MOODS)}, "tags": 3–6 tags (scene/activity/objects/season), "people": [{"id":"p1","label":"≤ 40 char description (age group + distinguishing feature, never a name)","box":[x,y,w,h] normalized 0–1, optional}]}
Do not identify anyone; at most 6 people; empty array if none.`;
  const res = await invokeLLM({
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url, detail: "low" } }] }],
    responseFormat: { type: "json_object" },
    maxTokens: 700,
  });
  const raw = res.choices[0]?.message.content;
  const text = typeof raw === "string" ? raw : raw?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
  const parsed = JSON.parse(text) as Partial<{ caption: string; suggestedTitle: string; mood: string; tags: string[]; people: Partial<DetectedPerson>[] }>;
  const people: DetectedPerson[] = (Array.isArray(parsed.people) ? parsed.people : []).slice(0, 6).map((p, i) => ({
    id: typeof p.id === "string" && p.id ? p.id : `p${i + 1}`,
    label: String(p.label ?? "").slice(0, 60) || (zh ? `人物 ${i + 1}` : `Person ${i + 1}`),
    description: p.description ? String(p.description).slice(0, 200) : undefined,
    box:
      Array.isArray(p.box) && p.box.length === 4 && p.box.every((n) => typeof n === "number" && n >= 0 && n <= 1)
        ? (p.box as [number, number, number, number])
        : undefined,
  }));
  return {
    caption: String(parsed.caption ?? "").slice(0, 500) || null,
    suggestedTitle: String(parsed.suggestedTitle ?? "").slice(0, 255) || null,
    mood: MOODS.includes(parsed.mood as (typeof MOODS)[number]) ? (parsed.mood as string) : "warm",
    tags: (Array.isArray(parsed.tags) ? parsed.tags : []).map((t) => String(t).slice(0, 40)).filter(Boolean).slice(0, 8),
    people,
    model: res.model ?? null,
  };
}

export const aiRouter = router({
  /** Analyze one photo (cached). `force` re-runs the model and keeps existing person→member links. */
  analyze: protectedProcedure
    .input(z.object({ mediaId: z.number().int().positive(), force: z.boolean().default(false), language: z.enum(["zh", "en"]).default("zh") }))
    .mutation(async ({ input, ctx }) => {
      const item = await requireMediaAccess(ctx.user.id, input.mediaId);
      const database = await requireDatabase();
      const existing = (await database.select().from(mediaAnalysis).where(eq(mediaAnalysis.mediaId, item.id)).limit(1))[0];
      if (existing && !input.force) return toResult(existing, "cache");
      if (item.type !== "photo") throw new TRPCError({ code: "BAD_REQUEST", message: "Only photos can be analyzed" });

      const album = (await database.select({ name: albums.name }).from(albums).where(eq(albums.id, item.albumId)).limit(1))[0];
      const zh = input.language === "zh";
      const previousPeople = existing ? parseJson<DetectedPerson[]>(existing.people, []) : [];

      let analysis: { caption: string | null; suggestedTitle: string | null; mood: string; tags: string[]; people: DetectedPerson[]; model?: string | null };
      let source: AnalysisResult["source"] = "heuristic";
      const canUseLlm = !!ENV.forgeApiUrl && !!ENV.forgeApiKey && (item.storageKey ? isStorageConfigured() : /^https?:\/\//.test(item.url));
      if (canUseLlm) {
        await assertUserRateLimit(ctx.user.id, "analyze", USER_LIMITS.analyze.limit, USER_LIMITS.analyze.windowMs);
        try {
          const url = item.storageKey ? await storageGetSignedUrl(item.thumbnailKey ?? item.storageKey) : item.url;
          analysis = await runVision(url, item, album?.name ?? null, zh);
          source = "llm";
        } catch (error) {
          console.warn("[ai] vision failed, using heuristic", error);
          analysis = heuristicAnalysis(item, album?.name ?? null, zh);
        }
      } else {
        analysis = heuristicAnalysis(item, album?.name ?? null, zh);
      }

      // Preserve confirmed member links across re-analysis (match by id).
      const linked = new Map(previousPeople.filter((p) => p.userId).map((p) => [p.id, p.userId!]));
      const people = analysis.people.map((p) => (linked.has(p.id) ? { ...p, userId: linked.get(p.id) } : p));

      const values = {
        mediaId: item.id,
        familyId: item.familyId,
        caption: analysis.caption,
        suggestedTitle: analysis.suggestedTitle,
        mood: analysis.mood,
        tags: JSON.stringify(analysis.tags),
        people: JSON.stringify(people),
        model: source === "llm" ? analysis.model ?? "vision" : "heuristic",
        analyzedBy: ctx.user.id,
        analyzedAt: new Date(),
      };
      await database.insert(mediaAnalysis).values(values).onDuplicateKeyUpdate({ set: values });
      const row = (await database.select().from(mediaAnalysis).where(eq(mediaAnalysis.mediaId, item.id)).limit(1))[0]!;
      return toResult(row, source);
    }),

  get: protectedProcedure.input(z.object({ mediaId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    await requireMediaAccess(ctx.user.id, input.mediaId);
    const database = await requireDatabase();
    const row = (await database.select().from(mediaAnalysis).where(eq(mediaAnalysis.mediaId, input.mediaId)).limit(1))[0];
    return row ? toResult(row, "cache") : null;
  }),

  /** Link / unlink a detected person to a family member. */
  tagPerson: protectedProcedure
    .input(z.object({ mediaId: z.number().int().positive(), personId: z.string().min(1).max(16), userId: z.number().int().positive().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const item = await requireMediaAccess(ctx.user.id, input.mediaId);
      const database = await requireDatabase();
      if (input.userId) {
        const member = await database
          .select({ id: familyMembers.id })
          .from(familyMembers)
          .where(and(eq(familyMembers.familyId, item.familyId), eq(familyMembers.userId, input.userId)))
          .limit(1);
        if (!member[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "That user is not a member of this family" });
      }
      const row = (await database.select().from(mediaAnalysis).where(eq(mediaAnalysis.mediaId, item.id)).limit(1))[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Analyze the photo first" });
      const people = parseJson<DetectedPerson[]>(row.people, []);
      const idx = people.findIndex((p) => p.id === input.personId);
      if (idx < 0) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found in this photo" });
      people[idx] = { ...people[idx]!, userId: input.userId ?? undefined };
      await database.update(mediaAnalysis).set({ people: JSON.stringify(people) }).where(eq(mediaAnalysis.mediaId, item.id));
      return toResult({ ...row, people: JSON.stringify(people) }, "cache");
    }),

  /** Members with tagged photo counts (for "filter by person"). */
  peopleIndex: protectedProcedure.input(z.object({ familyId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    await requireFamilyMember(ctx.user.id, input.familyId);
    const database = await requireDatabase();
    const rows = await database.select({ mediaId: mediaAnalysis.mediaId, people: mediaAnalysis.people }).from(mediaAnalysis).where(eq(mediaAnalysis.familyId, input.familyId));
    const counts = new Map<number, number>();
    let untagged = 0;
    for (const r of rows) {
      for (const p of parseJson<DetectedPerson[]>(r.people, [])) {
        if (p.userId) counts.set(p.userId, (counts.get(p.userId) ?? 0) + 1);
        else untagged += 1;
      }
    }
    const ids = [...counts.keys()];
    const userRows = ids.length ? await database.select({ id: users.id, name: users.name, avatar: users.avatar }).from(users).where(inArray(users.id, ids)) : [];
    return {
      analyzed: rows.length,
      untaggedPeople: untagged,
      people: userRows.map((u) => ({ ...u, count: counts.get(u.id) ?? 0 })).sort((a, b) => b.count - a.count),
    };
  }),

  /** Photos where `userId` is tagged (newest first). */
  byPerson: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive(), userId: z.number().int().positive(), take: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const rows = await database.select({ mediaId: mediaAnalysis.mediaId, people: mediaAnalysis.people }).from(mediaAnalysis).where(eq(mediaAnalysis.familyId, input.familyId));
      const ids = rows.filter((r) => parseJson<DetectedPerson[]>(r.people, []).some((p) => p.userId === input.userId)).map((r) => r.mediaId);
      if (ids.length === 0) return [];
      return database.select().from(media).where(inArray(media.id, ids)).orderBy(desc(media.createdAt)).limit(input.take);
    }),

  /**
   * Home-screen recommendations from real activity:
   *  - onThisDay: photos from the same calendar week in previous years
   *  - untitledGems: most-liked photos without a title (suggest naming)
   *  - bestShareHour: hour-of-day with most likes+comments in the last 90 days
   *  - nextAnniversary: nearest upcoming (yearly recurrence)
   *  - unanalyzed: how many photos still lack AI tags
   */
  recommend: protectedProcedure.input(z.object({ familyId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    await requireFamilyMember(ctx.user.id, input.familyId);
    const database = await requireDatabase();
    const now = new Date();

    const visible = await database
      .select({ id: albums.id })
      .from(albums)
      .where(and(eq(albums.familyId, input.familyId), or(eq(albums.isPrivate, false), eq(albums.createdBy, ctx.user.id))));
    const albumIds = visible.map((a) => a.id);
    if (albumIds.length === 0) {
      return { onThisDay: [], untitledGems: [], bestShareHour: null, nextAnniversary: null, unanalyzed: 0, totalPhotos: 0 };
    }

    const all = await database
      .select({ id: media.id, type: media.type, title: media.title, likeCount: media.likeCount, commentCount: media.commentCount, createdAt: media.createdAt, albumId: media.albumId })
      .from(media)
      .where(and(eq(media.familyId, input.familyId), inArray(media.albumId, albumIds)))
      .orderBy(desc(media.createdAt))
      .limit(2000);

    const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
    const today = dayOfYear(now);
    const onThisDay = all
      .filter((m) => m.createdAt.getUTCFullYear() < now.getUTCFullYear() && Math.abs(dayOfYear(m.createdAt) - today) <= 3)
      .slice(0, 6)
      .map((m) => ({ ...m, yearsAgo: now.getUTCFullYear() - m.createdAt.getUTCFullYear() }));

    const untitledGems = all
      .filter((m) => m.type === "photo" && !m.title)
      .sort((a, b) => b.likeCount + b.commentCount - (a.likeCount + a.commentCount))
      .slice(0, 4);

    const since = new Date(now.getTime() - 90 * 86_400_000);
    const mediaIds = all.map((m) => m.id);
    const hours = new Array<number>(24).fill(0);
    if (mediaIds.length) {
      const [likeRows, commentRows] = await Promise.all([
        database.select({ h: sql<number>`hour(${likes.createdAt})`, c: sql<number>`count(*)` }).from(likes).where(and(inArray(likes.mediaId, mediaIds), gte(likes.createdAt, since))).groupBy(sql`hour(${likes.createdAt})`),
        database.select({ h: sql<number>`hour(${comments.createdAt})`, c: sql<number>`count(*)` }).from(comments).where(and(inArray(comments.mediaId, mediaIds), gte(comments.createdAt, since))).groupBy(sql`hour(${comments.createdAt})`),
      ]);
      for (const r of [...likeRows, ...commentRows]) hours[Number(r.h)] = (hours[Number(r.h)] ?? 0) + Number(r.c);
    }
    const total = hours.reduce((a, b) => a + b, 0);
    let bestShareHour: { hour: number; share: number; sample: number } | null = null;
    if (total >= 5) {
      const hour = hours.indexOf(Math.max(...hours));
      bestShareHour = { hour, share: Math.round((hours[hour]! / total) * 100) / 100, sample: total };
    }

    const annivRows = await database.select().from(anniversaries).where(eq(anniversaries.familyId, input.familyId));
    const next = annivRows
      .map((a) => {
        const d = new Date(a.date);
        const candidate = new Date(now.getFullYear(), d.getMonth(), d.getDate());
        if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) candidate.setFullYear(now.getFullYear() + 1);
        const days = Math.round((candidate.getTime() - now.getTime()) / 86_400_000);
        return { id: a.id, type: a.type, couple: a.couple, date: candidate, daysUntil: Math.max(0, days), years: candidate.getFullYear() - d.getFullYear() };
      })
      .sort((a, b) => a.daysUntil - b.daysUntil)[0] ?? null;

    const analyzed = await database.select({ c: sql<number>`count(*)` }).from(mediaAnalysis).where(eq(mediaAnalysis.familyId, input.familyId));
    const totalPhotos = all.filter((m) => m.type === "photo").length;

    return {
      onThisDay,
      untitledGems,
      bestShareHour,
      nextAnniversary: next,
      unanalyzed: Math.max(0, totalPhotos - Number(analyzed[0]?.c ?? 0)),
      totalPhotos,
    };
  }),
});
