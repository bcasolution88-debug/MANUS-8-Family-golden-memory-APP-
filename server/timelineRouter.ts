import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { albums, anniversaries, comments, familyMembers, likes, loveStories, media, userPreferences, users } from "@/drizzle/schema";
import { requireFamilyMember } from "@/server/_core/authorization";
import { getDb } from "@/server/db";
import { buildExport } from "@/server/backupService";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { ENV } from "@/server/_core/env";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import {
  buildAvatarKey,
  isStorageConfigured,
  isValidStorageKey,
  parseStorageKey,
  storageGetSignedUrl,
  storagePresignPut,
  storageProxyPath,
} from "@/server/storage";

/** P7: soft per-user quota surfaced on the Settings page (bytes). */
export const STORAGE_QUOTA_BYTES = Number(process.env.STORAGE_QUOTA_BYTES ?? 10 * 1024 * 1024 * 1024);

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export const TIMELINE_EVENT_TYPES = ["upload", "comment", "like", "story", "anniversary"] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export type TimelineEvent = {
  /** Stable composite key, e.g. "upload:123". */
  id: string;
  type: TimelineEventType;
  at: Date;
  actor: { id: number; name: string | null; avatar: string | null } | null;
  mediaId: number | null;
  albumId: number | null;
  albumName: string | null;
  /** Comment body / story title / anniversary couple. */
  preview: string | null;
  /** For grouped uploads: how many items in the burst. */
  count: number;
};

const RANGE_MS: Record<"today" | "week" | "month" | "all", number | null> = {
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: null,
};

/**
 * Timeline (P6): a family activity feed assembled from existing tables, so no
 * extra event log is required. Each source is queried with the same time
 * window and type filter, merged in memory and sorted by time. Uploads by the
 * same user into the same album within 10 minutes collapse into one event.
 */
export const timelineRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        familyId: z.coerce.number().int().positive(),
        range: z.enum(["today", "week", "month", "all"]).default("all"),
        type: z.enum(TIMELINE_EVENT_TYPES).optional(),
        search: z.string().trim().max(100).optional(),
        take: z.coerce.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }): Promise<TimelineEvent[]> => {
      const member = await requireFamilyMember(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const canSeePrivate = member.role === "owner" || member.role === "admin";
      const windowMs = RANGE_MS[input.range];
      const since = windowMs ? new Date(Date.now() - windowMs) : null;
      const want = (t: TimelineEventType) => !input.type || input.type === t;
      const events: TimelineEvent[] = [];

      // Albums visible to this member (private → creator or admin only).
      const albumRows = await database
        .select({ id: albums.id, name: albums.name, isPrivate: albums.isPrivate, createdBy: albums.createdBy })
        .from(albums)
        .where(eq(albums.familyId, input.familyId));
      const visibleAlbums = albumRows.filter((a) => canSeePrivate || !a.isPrivate || a.createdBy === ctx.user.id);
      const albumName = new Map(visibleAlbums.map((a) => [a.id, a.name]));
      const albumIds = visibleAlbums.map((a) => a.id);
      const memberIds = (
        await database.select({ userId: familyMembers.userId }).from(familyMembers).where(eq(familyMembers.familyId, input.familyId))
      ).map((m) => m.userId);

      const userCache = new Map<number, TimelineEvent["actor"]>();
      const resolveUsers = async (ids: number[]) => {
        const missing = [...new Set(ids)].filter((id) => !userCache.has(id));
        if (missing.length) {
          const rows = await database.select({ id: users.id, name: users.name, avatar: users.avatar }).from(users).where(inArray(users.id, missing));
          for (const r of rows) userCache.set(r.id, r);
        }
      };

      if (albumIds.length > 0) {
        /* uploads — grouped */
        if (want("upload")) {
          const rows = await database
            .select({ id: media.id, albumId: media.albumId, uploadedBy: media.uploadedBy, createdAt: media.createdAt, title: media.title })
            .from(media)
            .where(and(inArray(media.albumId, albumIds), since ? gte(media.createdAt, since) : undefined))
            .orderBy(desc(media.createdAt))
            .limit(input.take * 4);
          await resolveUsers(rows.map((r) => r.uploadedBy));
          let current: TimelineEvent | null = null;
          for (const r of rows) {
            const sameBurst =
              current &&
              current.type === "upload" &&
              current.actor?.id === r.uploadedBy &&
              current.albumId === r.albumId &&
              current.at.getTime() - r.createdAt.getTime() < 10 * 60 * 1000;
            if (sameBurst && current) {
              current.count += 1;
            } else {
              current = {
                id: `upload:${r.id}`,
                type: "upload",
                at: r.createdAt,
                actor: userCache.get(r.uploadedBy) ?? null,
                mediaId: r.id,
                albumId: r.albumId,
                albumName: albumName.get(r.albumId) ?? null,
                preview: r.title,
                count: 1,
              };
              events.push(current);
            }
          }
        }

        /* P8: members who chose "hide my activity" don't surface likes / comments to others */
        const hiddenRows = await database
          .select({ userId: userPreferences.userId })
          .from(userPreferences)
          .where(and(eq(userPreferences.hideActivity, true), inArray(userPreferences.userId, memberIds)));
        const hidden = new Set(hiddenRows.map((r) => r.userId).filter((id) => id !== ctx.user.id));

        /* comments */
        if (want("comment")) {
          const rows = await database
            .select({ id: comments.id, mediaId: comments.mediaId, userId: comments.userId, content: comments.content, createdAt: comments.createdAt, albumId: media.albumId })
            .from(comments)
            .innerJoin(media, eq(media.id, comments.mediaId))
            .where(and(inArray(media.albumId, albumIds), since ? gte(comments.createdAt, since) : undefined))
            .orderBy(desc(comments.createdAt))
            .limit(input.take);
          await resolveUsers(rows.map((r) => r.userId));
          for (const r of rows) {
            if (hidden.has(r.userId)) continue;
            events.push({
              id: `comment:${r.id}`,
              type: "comment",
              at: r.createdAt,
              actor: userCache.get(r.userId) ?? null,
              mediaId: r.mediaId,
              albumId: r.albumId,
              albumName: albumName.get(r.albumId) ?? null,
              preview: r.content.slice(0, 140),
              count: 1,
            });
          }
        }

        /* likes */
        if (want("like")) {
          const rows = await database
            .select({ id: likes.id, mediaId: likes.mediaId, userId: likes.userId, createdAt: likes.createdAt, albumId: media.albumId, title: media.title })
            .from(likes)
            .innerJoin(media, eq(media.id, likes.mediaId))
            .where(and(inArray(media.albumId, albumIds), since ? gte(likes.createdAt, since) : undefined))
            .orderBy(desc(likes.createdAt))
            .limit(input.take);
          await resolveUsers(rows.map((r) => r.userId));
          for (const r of rows) {
            if (hidden.has(r.userId)) continue;
            events.push({
              id: `like:${r.id}`,
              type: "like",
              at: r.createdAt,
              actor: userCache.get(r.userId) ?? null,
              mediaId: r.mediaId,
              albumId: r.albumId,
              albumName: albumName.get(r.albumId) ?? null,
              preview: r.title,
              count: 1,
            });
          }
        }
      }

      /* love stories */
      if (want("story")) {
        const rows = await database
          .select()
          .from(loveStories)
          .where(and(eq(loveStories.familyId, input.familyId), since ? gte(loveStories.createdAt, since) : undefined))
          .orderBy(desc(loveStories.createdAt))
          .limit(input.take);
        await resolveUsers(rows.map((r) => r.createdBy));
        for (const r of rows) {
          events.push({
            id: `story:${r.id}`,
            type: "story",
            at: r.createdAt,
            actor: userCache.get(r.createdBy) ?? null,
            mediaId: null,
            albumId: null,
            albumName: null,
            preview: r.title,
            count: 1,
          });
        }
      }

      /* anniversaries */
      if (want("anniversary")) {
        const rows = await database
          .select()
          .from(anniversaries)
          .where(and(eq(anniversaries.familyId, input.familyId), since ? gte(anniversaries.createdAt, since) : undefined))
          .orderBy(desc(anniversaries.createdAt))
          .limit(input.take);
        await resolveUsers(rows.map((r) => r.createdBy));
        for (const r of rows) {
          events.push({
            id: `anniversary:${r.id}`,
            type: "anniversary",
            at: r.createdAt,
            actor: userCache.get(r.createdBy) ?? null,
            mediaId: null,
            albumId: null,
            albumName: null,
            preview: r.couple,
            count: 1,
          });
        }
      }

      const q = input.search?.toLowerCase();
      const filtered = q
        ? events.filter(
            (e) =>
              (e.actor?.name ?? "").toLowerCase().includes(q) ||
              (e.preview ?? "").toLowerCase().includes(q) ||
              (e.albumName ?? "").toLowerCase().includes(q),
          )
        : events;

      return filtered.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, input.take);
    }),
});

/* ------------------------------------------------------------------ */
/* Profile + personal stats (Me tab)                                   */
/* ------------------------------------------------------------------ */

export const profileRouter = router({
  /** Update own display name / avatar / relationship. Email stays bound to the login provider. */
  update: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        avatar: z.string().url().max(2000).nullable().optional(),
        relationship: z.string().trim().max(64).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      await database.update(users).set(input).where(eq(users.id, ctx.user.id));
      return (await database.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0];
    }),

  /**
   * P7: presign a PUT for a new profile picture. Key lives under
   * users/{uid}/avatar/ so the proxy can authorize it for any signed-in user.
   */
  initAvatarUpload: protectedProcedure
    .input(
      z.object({
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
        fileSize: z.number().int().positive().max(5 * 1024 * 1024).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ctx.user.id, "presign", USER_LIMITS.presign.limit, USER_LIMITS.presign.windowMs);
      const ext = input.contentType === "image/png" ? "png" : input.contentType === "image/webp" ? "webp" : "jpg";
      const storageKey = buildAvatarKey(ctx.user.id, ext);
      let presignedUrl: string;
      if (isStorageConfigured()) {
        presignedUrl = (await storagePresignPut(storageKey, input.contentType)).url;
      } else if (ENV.isProduction) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage is not configured" });
      } else {
        presignedUrl = storageProxyPath(storageKey);
      }
      return { storageKey, presignedUrl, contentType: input.contentType };
    }),

  /** P7: persist the uploaded avatar key as the user's avatar URL (proxy path). */
  completeAvatarUpload: protectedProcedure
    .input(z.object({ storageKey: z.string().max(512) }))
    .mutation(async ({ input, ctx }) => {
      const parsed = parseStorageKey(input.storageKey);
      if (!isValidStorageKey(input.storageKey) || parsed.kind !== "avatar" || parsed.userId !== ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Storage key does not belong to this user" });
      }
      const database = await requireDatabase();
      // Store an absolute-ish proxy path; clients resolve via `profile.avatarUrl`
      // or the storage proxy which 307s to a signed S3 URL.
      const avatar = storageProxyPath(input.storageKey);
      await database.update(users).set({ avatar }).where(eq(users.id, ctx.user.id));
      return (await database.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0];
    }),

  /**
   * P7: short-lived signed URL for a proxy-path avatar (`/manus-storage/users/..`).
   * External http(s) avatars (OAuth providers) are returned unchanged.
   */
  avatarUrl: protectedProcedure
    .input(z.object({ avatar: z.string().max(2000) }))
    .query(async ({ input }) => {
      const m = /^\/manus-storage\/(.+)$/.exec(input.avatar);
      if (!m) return { url: input.avatar, signed: false as const };
      const key = m[1]!;
      if (parseStorageKey(key).kind !== "avatar" || !isStorageConfigured()) return { url: input.avatar, signed: false as const };
      return { url: await storageGetSignedUrl(key), signed: true as const };
    }),

  /**
   * P7: storage usage for the Settings page. "Mine" = bytes I uploaded across
   * all families; per-family totals for the families I belong to.
   */
  storageUsage: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDatabase();
    const [mine] = await database
      .select({
        bytes: sql<number>`coalesce(sum(${media.fileSize}), 0)`,
        count: sql<number>`count(*)`,
        photos: sql<number>`sum(case when ${media.type} = 'photo' then 1 else 0 end)`,
        videos: sql<number>`sum(case when ${media.type} = 'video' then 1 else 0 end)`,
        photoBytes: sql<number>`coalesce(sum(case when ${media.type} = 'photo' then ${media.fileSize} else 0 end), 0)`,
        videoBytes: sql<number>`coalesce(sum(case when ${media.type} = 'video' then ${media.fileSize} else 0 end), 0)`,
      })
      .from(media)
      .where(eq(media.uploadedBy, ctx.user.id));
    const memberships = await database
      .select({ familyId: familyMembers.familyId })
      .from(familyMembers)
      .where(eq(familyMembers.userId, ctx.user.id));
    const familyIds = memberships.map((m) => m.familyId);
    const perFamily = familyIds.length
      ? await database
          .select({
            familyId: media.familyId,
            bytes: sql<number>`coalesce(sum(${media.fileSize}), 0)`,
            count: sql<number>`count(*)`,
          })
          .from(media)
          .where(inArray(media.familyId, familyIds))
          .groupBy(media.familyId)
      : [];
    const used = Number(mine?.bytes ?? 0);
    return {
      quotaBytes: STORAGE_QUOTA_BYTES,
      usedBytes: used,
      availableBytes: Math.max(0, STORAGE_QUOTA_BYTES - used),
      count: Number(mine?.count ?? 0),
      photos: Number(mine?.photos ?? 0),
      videos: Number(mine?.videos ?? 0),
      photoBytes: Number(mine?.photoBytes ?? 0),
      videoBytes: Number(mine?.videoBytes ?? 0),
      families: perFamily.map((f) => ({ familyId: f.familyId, bytes: Number(f.bytes), count: Number(f.count) })),
    };
  }),

  /**
   * P8: data export. Returns everything the user uploaded (metadata) as CSV or
   * JSON text; `includeLinks` adds 15-minute signed download URLs (ZIP-style
   * "take my photos with me" without the server zipping gigabytes).
   */
  /**
   * P8/P9: data export (shared builder in backupService). Returns the user's
   * uploads as CSV or JSON text; `includeLinks` adds 15-minute signed URLs.
   */
  exportData: protectedProcedure
    .input(z.object({ format: z.enum(["csv", "json"]).default("csv"), includeLinks: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ctx.user.id, "presign", USER_LIMITS.presign.limit, USER_LIMITS.presign.windowMs);
      return buildExport({ id: ctx.user.id, email: ctx.user.email, name: ctx.user.name }, input);
    }),

  /** Counts for the Me header: what I uploaded, how much love it got, how many families I'm in. */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDatabase();
    const [mine] = await database
      .select({
        uploads: sql<number>`count(*)`,
        photos: sql<number>`sum(case when ${media.type} = 'photo' then 1 else 0 end)`,
        videos: sql<number>`sum(case when ${media.type} = 'video' then 1 else 0 end)`,
        likesReceived: sql<number>`coalesce(sum(${media.likeCount}), 0)`,
        commentsReceived: sql<number>`coalesce(sum(${media.commentCount}), 0)`,
      })
      .from(media)
      .where(eq(media.uploadedBy, ctx.user.id));
    const [given] = await database.select({ likesGiven: sql<number>`count(*)` }).from(likes).where(eq(likes.userId, ctx.user.id));
    const [written] = await database.select({ commentsWritten: sql<number>`count(*)` }).from(comments).where(eq(comments.userId, ctx.user.id));
    const [stories] = await database.select({ stories: sql<number>`count(*)` }).from(loveStories).where(eq(loveStories.createdBy, ctx.user.id));
    return {
      uploads: Number(mine?.uploads ?? 0),
      photos: Number(mine?.photos ?? 0),
      videos: Number(mine?.videos ?? 0),
      likesReceived: Number(mine?.likesReceived ?? 0),
      commentsReceived: Number(mine?.commentsReceived ?? 0),
      likesGiven: Number(given?.likesGiven ?? 0),
      commentsWritten: Number(written?.commentsWritten ?? 0),
      stories: Number(stories?.stories ?? 0),
    };
  }),
});
