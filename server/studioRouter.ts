/**
 * P7 — Studio router: turn the "video studio" UI prototype into a real
 * server-side slideshow renderer.
 *
 *   templates   → built-in presets (transition / pacing / accent / music mood)
 *   suggest     → LLM title + captions for the chosen photos (falls back to
 *                 deterministic copy when the LLM is not configured)
 *   render      → kicks off an async ffmpeg job; result is uploaded to the
 *                 album's private S3 prefix and inserted as a `media` row
 *                 (type video, thumbnailKey = poster) so it shows up in the
 *                 album grid / timeline / Home like any other upload.
 *   job         → poll job status + progress
 *
 * P8: jobs are persisted in `studioJobs` so progress survives restarts and
 * works across instances. On boot `reapInterruptedStudioJobs()` marks any job
 * still queued / rendering / uploading as failed ("interrupted").
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { z } from "zod";

import { albums, media, studioJobs, type StudioJobRow } from "@/drizzle/schema";
import { requireAlbumAccess, requireFamilyEditor } from "@/server/_core/authorization";
import { ENV } from "@/server/_core/env";
import { invokeLLM } from "@/server/_core/llm";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import { withLock } from "@/server/_core/coordination";
import { recordMetric } from "@/server/_core/metrics";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { MUSIC_MOODS, isFfmpegAvailable, renderSlideshow, type MusicMood, type RenderTransition, MUSIC_CONTENT_TYPES, MUSIC_MAX_BYTES } from "@/server/_core/videoRender";
import { getDb } from "@/server/db";
import { notifyFamily } from "@/server/notifications";
import {
  buildMediaKey,
  isStorageConfigured,
  storageGetSignedUrl,
  storagePresignPut,
  storageProxyPath,
  buildMusicKey,
  parseStorageKey,
} from "@/server/storage";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const STUDIO_TEMPLATE_IDS = ["romantic", "gathering", "travel", "birthday", "memorial"] as const;
export type StudioTemplateId = (typeof STUDIO_TEMPLATE_IDS)[number];

export interface StudioTemplate {
  id: StudioTemplateId;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  transition: RenderTransition;
  secondsPerSlide: number;
  accent: string;
  /** P8: generated background music mood (see videoRender MUSIC_PRESETS). */
  music: MusicMood;
  /** Display label for the mood. */
  musicLabel: string;
  icon: string;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  { id: "romantic", name: "浪漫爱情", nameEn: "Romantic Love", description: "柔和淡入淡出，金色标题", descriptionEn: "Soft cross-fades, golden titles", transition: "fade", secondsPerSlide: 4, accent: "D4AF37", music: "romance", musicLabel: "Romance", icon: "favorite" },
  { id: "gathering", name: "家庭聚会", nameEn: "Family Gathering", description: "明快节奏，溶解转场", descriptionEn: "Upbeat pacing, dissolve transitions", transition: "dissolve", secondsPerSlide: 3, accent: "E8B86D", music: "joy", musicLabel: "Joy", icon: "groups" },
  { id: "travel", name: "旅游回忆", nameEn: "Travel Memories", description: "横向滑动，像翻相册", descriptionEn: "Horizontal slides like flipping an album", transition: "slideleft", secondsPerSlide: 3, accent: "7DB9DE", music: "adventure", musicLabel: "Adventure", icon: "flight" },
  { id: "birthday", name: "生日庆典", nameEn: "Birthday Celebration", description: "圆形展开，欢快明亮", descriptionEn: "Circle-open reveals, bright and cheerful", transition: "circleopen", secondsPerSlide: 3, accent: "F28B82", music: "celebration", musicLabel: "Celebration", icon: "cake" },
  { id: "memorial", name: "金婚纪念", nameEn: "Golden Anniversary", description: "缓慢庄重，适合纪念日", descriptionEn: "Slow and dignified, for anniversaries", transition: "fade", secondsPerSlide: 5, accent: "D4AF37", music: "classic", musicLabel: "Classic", icon: "emoji-events" },
];

/* ------------------------------------------------------------------ */
/* Jobs (persisted — P8)                                               */
/* ------------------------------------------------------------------ */

export type StudioJobStatus = StudioJobRow["status"];

/** Public shape returned to clients (dates as epoch ms, no raw input blob). */
export interface StudioJob {
  id: string;
  userId: number;
  albumId: number;
  familyId: number;
  status: StudioJobStatus;
  /** 0–100 */
  progress: number;
  stage: string;
  mediaId?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

function toPublic(row: StudioJobRow): StudioJob {
  return {
    id: row.id,
    userId: row.userId,
    albumId: row.albumId,
    familyId: row.familyId,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    mediaId: row.mediaId ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Throttle progress writes so a render doesn't hammer the DB. */
const lastWrite = new Map<string, number>();
async function updateJob(id: string, patch: Partial<Pick<StudioJobRow, "status" | "progress" | "stage" | "mediaId" | "error">>, force = false) {
  const now = Date.now();
  const significant = force || patch.status !== undefined || patch.mediaId !== undefined || patch.error !== undefined;
  if (!significant && now - (lastWrite.get(id) ?? 0) < 700) return;
  lastWrite.set(id, now);
  try {
    const database = await requireDatabase();
    await database.update(studioJobs).set({ ...patch, error: patch.error ? patch.error.slice(0, 500) : patch.error }).where(eq(studioJobs.id, id));
  } catch (error) {
    console.error("[studio] failed to update job", id, error);
  }
}

/* ------------------------------------------------------------------ */
/* Queue (P9) — DB-backed, concurrency-capped, multi-instance safe       */
/* ------------------------------------------------------------------ */

/** Max simultaneous ffmpeg renders per server process (env STUDIO_CONCURRENCY, default 2). */
export const STUDIO_CONCURRENCY = Math.max(1, Number(process.env.STUDIO_CONCURRENCY ?? 2));
/** A claimed job that hasn't written progress for this long is considered dead. */
export const STUDIO_STALE_MS = Number(process.env.STUDIO_STALE_MS ?? 15 * 60 * 1000);
export const WORKER_ID = `${hostname()}:${process.pid}`;

let active = 0;
let pumping = false;

export function __queueState() {
  return { active, concurrency: STUDIO_CONCURRENCY, workerId: WORKER_ID };
}

/**
 * Atomically claim the oldest queued job: UPDATE … WHERE status='queued' AND workerId IS NULL
 * only succeeds for one instance. Returns the claimed row or null.
 */
async function claimNextJob(): Promise<StudioJobRow | null> {
  const database = await requireDatabase();
  const candidates = await database
    .select({ id: studioJobs.id })
    .from(studioJobs)
    .where(and(eq(studioJobs.status, "queued"), isNull(studioJobs.workerId)))
    .orderBy(asc(studioJobs.createdAt))
    .limit(5);
  for (const c of candidates) {
    const result = await database
      .update(studioJobs)
      .set({ workerId: WORKER_ID, startedAt: new Date(), stage: "claimed" })
      .where(and(eq(studioJobs.id, c.id), eq(studioJobs.status, "queued"), isNull(studioJobs.workerId)));
    if (Number((result[0] as { affectedRows?: number }).affectedRows ?? 0) === 1) {
      const [row] = await database.select().from(studioJobs).where(eq(studioJobs.id, c.id)).limit(1);
      if (row) return row;
    }
  }
  return null;
}

/** Pull jobs while we have free slots. Safe to call often; re-entrancy guarded. */
export async function pumpStudioQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (active < STUDIO_CONCURRENCY) {
      const row = await claimNextJob();
      if (!row) break;
      active += 1;
      void (async () => {
        try {
          const parsed = renderInput.safeParse(JSON.parse(row.input));
          if (!parsed.success) {
            await updateJob(row.id, { status: "failed", stage: "error", error: "Stored job input is invalid" });
            return;
          }
          const database = await requireDatabase();
          const [album] = await database.select().from(albums).where(eq(albums.id, row.albumId)).limit(1);
          if (!album) {
            await updateJob(row.id, { status: "failed", stage: "error", error: "Album no longer exists" });
            return;
          }
          await runJob(row.id, row.userId, album, parsed.data);
        } catch (error) {
          console.error("[studio] worker crashed", error);
          await updateJob(row.id, { status: "failed", stage: "error", error: error instanceof Error ? error.message : "Worker crashed" });
        } finally {
          active -= 1;
          // Keep draining — another job may have been queued meanwhile.
          void pumpStudioQueue();
        }
      })();
    }
  } finally {
    pumping = false;
  }
}

/** Position of a queued job among all queued jobs (1-based), null when not queued. */
async function queuePosition(jobId: string, createdAt: Date): Promise<number | null> {
  const database = await requireDatabase();
  const ahead = await database
    .select({ id: studioJobs.id })
    .from(studioJobs)
    .where(and(eq(studioJobs.status, "queued"), isNull(studioJobs.workerId), lt(studioJobs.createdAt, createdAt)));
  return ahead.length + 1;
}

/**
 * Boot + periodic maintenance:
 *  - jobs claimed by *this* worker id before restart can never finish → failed
 *  - jobs claimed by any worker but silent for STUDIO_STALE_MS → back to queued (one retry) or failed
 *  - prune > 30 days
 * Then pump the queue so queued work from before the restart resumes.
 */
export async function reapInterruptedStudioJobs(): Promise<number> {
  const database = await getDb();
  if (!database) return 0;
  const mine = await database
    .update(studioJobs)
    .set({ status: "failed", stage: "error", error: "Render interrupted by server restart — please try again", workerId: null })
    .where(and(inArray(studioJobs.status, ["rendering", "uploading"]), eq(studioJobs.workerId, WORKER_ID)));
  let affected = Number((mine[0] as { affectedRows?: number }).affectedRows ?? 0);

  const staleBefore = new Date(Date.now() - STUDIO_STALE_MS);
  const stale = await database
    .select({ id: studioJobs.id, stage: studioJobs.stage })
    .from(studioJobs)
    .where(and(inArray(studioJobs.status, ["queued", "rendering", "uploading"]), lt(studioJobs.updatedAt, staleBefore)));
  for (const j of stale) {
    if (j.stage === "requeued") {
      await database.update(studioJobs).set({ status: "failed", stage: "error", error: "Render stalled twice — please try again", workerId: null }).where(eq(studioJobs.id, j.id));
    } else {
      await database.update(studioJobs).set({ status: "queued", stage: "requeued", progress: 0, workerId: null, startedAt: null }).where(eq(studioJobs.id, j.id));
    }
    affected += 1;
  }
  if (affected) console.warn(`[studio] ${WORKER_ID}: handled ${affected} interrupted / stale job(s)`);
  await database.delete(studioJobs).where(lt(studioJobs.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  void pumpStudioQueue();
  return affected;
}

let maintenanceTimer: NodeJS.Timeout | null = null;
/**
 * Every 5 min: requeue stale jobs + pump (picks up jobs enqueued by other instances).
 * P10: the stale-requeue pass is cluster-locked (`withLock`) so two instances
 * cannot both flip the same job; every instance still pumps its own workers.
 */
export function startStudioWorker(intervalMs = 5 * 60 * 1000): void {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(
    () =>
      void withLock("studio-reaper", 4 * 60 * 1000, () => reapInterruptedStudioJobs())
        .then((r) => {
          if (!r.ran) void pumpStudioQueue();
        })
        .catch((e) => console.error("[studio] maintenance failed", e)),
    intervalMs,
  );
  maintenanceTimer.unref?.();
  // Also poll for new work frequently when idle (cheap indexed query).
  const poll = setInterval(() => void pumpStudioQueue().catch(() => undefined), 10_000);
  poll.unref?.();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const renderInput = z.object({
  albumId: z.number().int().positive(),
  /** Photos (media.id) in display order. 1–12. */
  mediaIds: z.array(z.number().int().positive()).min(1).max(12),
  templateId: z.enum(STUDIO_TEMPLATE_IDS),
  title: z.string().trim().max(60).optional(),
  subtitle: z.string().trim().max(80).optional(),
  /** Per-slide captions aligned with mediaIds (missing / empty = none). */
  captions: z.array(z.string().trim().max(80)).max(12).optional(),
  /** Override template pacing (2–6 s). */
  secondsPerSlide: z.number().min(2).max(6).optional(),
  /** Override template transition. */
  transition: z.enum(["fade", "slideleft", "wipeleft", "circleopen", "dissolve"]).optional(),
  /** P8: override template music ("none" = silent). */
  music: z.enum(MUSIC_MOODS).optional(),
  /** P10: user-uploaded soundtrack key from `studio.presignMusic` (takes precedence over `music`). */
  musicKey: z.string().max(512).optional(),
});

/** P10: a musicKey must be one of the caller's own soundtracks. */
function assertOwnMusicKey(userId: number, key: string) {
  const parsed = parseStorageKey(key);
  if (parsed.kind !== "music" || parsed.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Soundtrack does not belong to you" });
  }
}

async function loadPhotos(albumId: number, mediaIds: number[]) {
  const database = await requireDatabase();
  const rows = await database
    .select()
    .from(media)
    .where(and(eq(media.albumId, albumId), inArray(media.id, mediaIds)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = mediaIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  if (ordered.length !== mediaIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Some photos are missing or belong to another album" });
  }
  const notPhoto = ordered.find((r) => r.type !== "photo");
  if (notPhoto) throw new TRPCError({ code: "BAD_REQUEST", message: "Only photos can be used in a slideshow" });
  return ordered;
}

async function resolveSlideUrl(item: typeof media.$inferSelect): Promise<string> {
  if (item.storageKey && isStorageConfigured()) return storageGetSignedUrl(item.storageKey);
  // Legacy rows / dev without storage: use the stored URL if it's absolute.
  if (/^https?:\/\//.test(item.url)) return item.url;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Photo is not downloadable (storage not configured)" });
}

async function putObject(key: string, filePath: string, contentType: string): Promise<void> {
  const { url } = await storagePresignPut(key, contentType);
  const body = await readFile(filePath);
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body });
  if (!res.ok) throw new Error(`Storage PUT failed (${res.status})`);
}

async function runJob(jobId: string, userId: number, album: typeof albums.$inferSelect, input: z.infer<typeof renderInput>) {
  const template = STUDIO_TEMPLATES.find((t) => t.id === input.templateId)!;
  const renderStarted = Date.now();
  try {
    await updateJob(jobId, { status: "rendering", stage: "preparing", progress: 2 });
    const photos = await loadPhotos(album.id, input.mediaIds);
    const slides = await Promise.all(
      photos.map(async (p, i) => ({ source: await resolveSlideUrl(p), caption: input.captions?.[i] || undefined })),
    );

    const musicSource = input.musicKey && isStorageConfigured() ? await storageGetSignedUrl(input.musicKey) : undefined;
    const result = await renderSlideshow({
      slides,
      title: input.title,
      subtitle: input.subtitle,
      secondsPerSlide: input.secondsPerSlide ?? template.secondsPerSlide,
      transition: input.transition ?? template.transition,
      accent: template.accent,
      music: input.music ?? template.music,
      musicSource,
      onProgress: (done, total, stage) => void updateJob(jobId, { stage, progress: 5 + Math.round((done / total) * 75) }),
    });

    try {
      await updateJob(jobId, { status: "uploading", stage: "upload", progress: 82 });
      const uploadId = crypto.randomUUID();
      const base = `studio_${template.id}_${Date.now()}`;
      const storageKey = buildMediaKey(album.familyId, album.id, uploadId, `${base}.mp4`);
      const thumbnailKey = buildMediaKey(album.familyId, album.id, uploadId, `thumb_${base}.jpg`);
      if (isStorageConfigured()) {
        await putObject(storageKey, result.videoPath, "video/mp4");
        await updateJob(jobId, { progress: 92 }, true);
        await putObject(thumbnailKey, result.posterPath, "image/jpeg");
      } else if (ENV.isProduction) {
        throw new Error("Storage is not configured");
      }
      const size = (await stat(result.videoPath)).size;
      const database = await requireDatabase();
      const inserted = await database.insert(media).values({
        albumId: album.id,
        familyId: album.familyId,
        uploadedBy: userId,
        type: "video",
        url: storageProxyPath(storageKey),
        thumbnail: storageProxyPath(thumbnailKey),
        storageKey,
        thumbnailKey,
        title: input.title || template.name,
        description: input.subtitle || `${template.name} · ${photos.length} 张照片${result.hasAudio ? ` · ${input.musicKey ? "自选配乐" : template.musicLabel}` : ""}`,
        duration: Math.round(result.durationSeconds),
        fileSize: size,
      });
      const mediaId = Number(inserted[0].insertId);
      await notifyFamily(
        album.familyId,
        { actorId: userId, type: "upload", mediaId, albumId: album.id, preview: input.title || template.name },
        userId,
      );
      await updateJob(jobId, { status: "completed", stage: "done", progress: 100, mediaId });
      recordMetric("studio", true, { durationMs: Date.now() - renderStarted, detail: template.id });
    } finally {
      await result.cleanup();
    }
  } catch (error) {
    console.error("[studio] render failed", error);
    recordMetric("studio", false, { durationMs: Date.now() - renderStarted, detail: error instanceof Error ? error.message : "Render failed" });
    await updateJob(jobId, { status: "failed", stage: "error", error: error instanceof Error ? error.message : "Render failed" });
  }
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export const studioRouter = router({
  templates: protectedProcedure.query(async () => ({
    templates: STUDIO_TEMPLATES,
    rendererAvailable: await isFfmpegAvailable(),
    storageConfigured: isStorageConfigured(),
  })),

  /**
   * LLM-written title / subtitle / per-photo captions. Falls back to
   * deterministic copy when the LLM is not configured so the UI never blocks.
   */
  suggest: protectedProcedure
    .input(
      z.object({
        albumId: z.number().int().positive(),
        mediaIds: z.array(z.number().int().positive()).min(1).max(12),
        templateId: z.enum(STUDIO_TEMPLATE_IDS),
        language: z.enum(["zh", "en"]).default("zh"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.albumId);
      const photos = await loadPhotos(album.id, input.mediaIds);
      const template = STUDIO_TEMPLATES.find((t) => t.id === input.templateId)!;
      const zh = input.language === "zh";

      const fallback = {
        title: zh ? `${album.name} · ${template.name}` : `${album.name} · ${template.nameEn}`,
        subtitle: zh
          ? `${photos.length} 张照片 · ${new Date().getFullYear()}`
          : `${photos.length} photos · ${new Date().getFullYear()}`,
        captions: photos.map((p) => p.title ?? ""),
        source: "fallback" as const,
      };
      if (!ENV.forgeApiUrl || !ENV.forgeApiKey) return fallback;

      try {
        await assertUserRateLimit(ctx.user.id, "ai", USER_LIMITS.ai.limit, USER_LIMITS.ai.windowMs);
        const photoLines = photos
          .map((p, i) => `${i + 1}. ${[p.title, p.description].filter(Boolean).join(" — ") || (zh ? "（无标题）" : "(untitled)")} · ${p.createdAt.toISOString().slice(0, 10)}`)
          .join("\n");
        const prompt = zh
          ? `你是家庭回忆视频的文案编辑。相册名「${album.name}」，模板「${template.name}」（${template.description}）。下面是按顺序出现的 ${photos.length} 张照片的标题/描述/日期：\n${photoLines}\n\n请输出 JSON：{"title": 不超过 14 个汉字的温暖标题, "subtitle": 不超过 24 个字的副标题, "captions": 与照片数量相同的数组，每条不超过 16 个字的字幕，可为空字符串}。只输出 JSON。`
          : `You write copy for family memory videos. Album "${album.name}", template "${template.nameEn}" (${template.descriptionEn}). Photos in order (title/description/date):\n${photoLines}\n\nReturn JSON: {"title": warm title ≤ 40 chars, "subtitle": ≤ 60 chars, "captions": array with one caption (≤ 40 chars, may be empty) per photo}. JSON only.`;
        const res = await invokeLLM({
          messages: [{ role: "user", content: prompt }],
          responseFormat: { type: "json_object" },
          maxTokens: 600,
        });
        const raw = res.choices[0]?.message.content;
        const text = typeof raw === "string" ? raw : raw?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
        const parsed = JSON.parse(text) as { title?: string; subtitle?: string; captions?: string[] };
        const captions = Array.isArray(parsed.captions) ? parsed.captions.map((c) => String(c ?? "").slice(0, 80)) : fallback.captions;
        while (captions.length < photos.length) captions.push("");
        return {
          title: (parsed.title || fallback.title).slice(0, 60),
          subtitle: (parsed.subtitle || fallback.subtitle).slice(0, 80),
          captions: captions.slice(0, photos.length),
          source: "llm" as const,
        };
      } catch (error) {
        if (error instanceof TRPCError && error.code === "TOO_MANY_REQUESTS") throw error;
        console.warn("[studio] suggest fell back", error);
        return fallback;
      }
    }),

  /** Start an async render. Editor role on the album's family is required. */
  /**
   * P10: presigned PUT for a user soundtrack (mp3 / m4a / wav / aac / ogg, ≤ 20 MB).
   * The returned `musicKey` is passed to `render`.
   */
  presignMusic: protectedProcedure
    .input(z.object({ fileName: z.string().min(1).max(255), contentType: z.enum(MUSIC_CONTENT_TYPES), fileSize: z.number().int().positive().max(MUSIC_MAX_BYTES) }))
    .mutation(async ({ input, ctx }) => {
      if (!isStorageConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is not configured" });
      await assertUserRateLimit(ctx.user.id, "presign", USER_LIMITS.presign.limit, USER_LIMITS.presign.windowMs);
      const ext = input.fileName.split(".").pop() ?? "mp3";
      const musicKey = buildMusicKey(ctx.user.id, ext);
      const { url } = await storagePresignPut(musicKey, input.contentType);
      return { musicKey, presignedUrl: url, maxBytes: MUSIC_MAX_BYTES };
    }),

  render: protectedProcedure.input(renderInput).mutation(async ({ input, ctx }) => {
    const album = await requireAlbumAccess(ctx.user.id, input.albumId);
    await requireFamilyEditor(ctx.user.id, album.familyId);
    await assertUserRateLimit(ctx.user.id, "studio", USER_LIMITS.studio.limit, USER_LIMITS.studio.windowMs);
    if (!(await isFfmpegAvailable())) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Video renderer (ffmpeg) is not installed on the server" });
    }
    if (!isStorageConfigured() && ENV.isProduction) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is not configured" });
    }
    // Validate photos up-front so the client gets a synchronous error.
    await loadPhotos(album.id, input.mediaIds);
    if (input.musicKey) assertOwnMusicKey(ctx.user.id, input.musicKey);

    const id = crypto.randomUUID();
    const database = await requireDatabase();
    await database.insert(studioJobs).values({
      id,
      userId: ctx.user.id,
      albumId: album.id,
      familyId: album.familyId,
      status: "queued",
      progress: 0,
      stage: "queued",
      input: JSON.stringify(input),
    });
    // P9: enqueue; the worker pump claims it when a slot is free.
    void pumpStudioQueue();
    const position = await queuePosition(id, new Date());
    return { jobId: id, queuePosition: position, concurrency: STUDIO_CONCURRENCY };
  }),

  job: protectedProcedure.input(z.object({ jobId: z.string().uuid() })).query(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const rows = await database.select().from(studioJobs).where(eq(studioJobs.id, input.jobId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
    const pub = toPublic(row);
    return { ...pub, queuePosition: row.status === "queued" && !row.workerId ? await queuePosition(row.id, row.createdAt) : null, workerId: row.workerId };
  }),

  /** My recent renders (persisted, newest first). */
  myJobs: protectedProcedure
    .input(z.object({ take: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database
        .select()
        .from(studioJobs)
        .where(eq(studioJobs.userId, ctx.user.id))
        .orderBy(desc(studioJobs.createdAt))
        .limit(input?.take ?? 20);
      return rows.map(toPublic);
    }),

  /** P8: re-run a failed job with its stored input. */
  retry: protectedProcedure.input(z.object({ jobId: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const rows = await database.select().from(studioJobs).where(eq(studioJobs.id, input.jobId)).limit(1);
    const row = rows[0];
    if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
    if (row.status !== "failed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only failed jobs can be retried" });
    const parsed = renderInput.safeParse(JSON.parse(row.input));
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Stored job input is no longer valid" });
    const album = await requireAlbumAccess(ctx.user.id, parsed.data.albumId);
    await requireFamilyEditor(ctx.user.id, album.familyId);
    await assertUserRateLimit(ctx.user.id, "studio", USER_LIMITS.studio.limit, USER_LIMITS.studio.windowMs);
    await loadPhotos(album.id, parsed.data.mediaIds);
    const id = crypto.randomUUID();
    await database.insert(studioJobs).values({
      id,
      userId: ctx.user.id,
      albumId: album.id,
      familyId: album.familyId,
      status: "queued",
      progress: 0,
      stage: "queued",
      input: row.input,
    });
    void pumpStudioQueue();
    return { jobId: id, queuePosition: await queuePosition(id, new Date()), concurrency: STUDIO_CONCURRENCY };
  }),
});
