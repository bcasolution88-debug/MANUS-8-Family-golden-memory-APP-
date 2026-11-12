import { router, protectedProcedure } from "@/server/_core/trpc";
import {
  requireAlbumAccess,
  requireMediaAccess,
  requireShareAccess,
} from "@/server/_core/authorization";
import { z } from "zod";
import { getDb } from "@/server/db";
import { SHARE_PLATFORMS, comments, likes, media, shares, users, type Share } from "@/drizzle/schema";
import { notifyMediaOwner } from "@/server/notifications";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

const mediaIdInput = z.coerce.number().int().positive();
const commentIdInput = z.coerce.number().int().positive();
async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export type ShareStatus = "active" | "expired" | "revoked";

/** Derive lifecycle status (P3). Revoked wins over expired. */
export function shareStatus(share: Pick<Share, "expiresAt" | "revokedAt">, now = new Date()): ShareStatus {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

const withStatus = <T extends Pick<Share, "expiresAt" | "revokedAt">>(share: T) => ({
  ...share,
  status: shareStatus(share),
});

export const interactionRouter = router({
  createComment: protectedProcedure
    .input(
      z.object({
        mediaId: mediaIdInput,
        content: z.string().min(1).max(10000),
        rating: z.number().int().min(1).max(5).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      const database = await requireDatabase();
      const inserted = await database.insert(comments).values({
        mediaId: input.mediaId,
        userId: ctx.user.id,
        content: input.content,
        rating: input.rating,
      });
      const commentId = Number(inserted[0].insertId);
      await database
        .update(media)
        .set({ commentCount: sql`${media.commentCount} + 1` })
        .where(eq(media.id, input.mediaId));
      await notifyMediaOwner(input.mediaId, ctx.user.id, "comment", {
        commentId,
        preview: input.content.slice(0, 200),
      });
      const rows = await database
        .select()
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);
      return rows[0];
    }),

  getComments: protectedProcedure
    .input(
      z.object({
        mediaId: mediaIdInput.optional(),
        skip: z.coerce.number().int().min(0).default(0),
        take: z.coerce.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await requireDatabase();
      if (input.mediaId) await requireMediaAccess(ctx.user.id, input.mediaId);
      // P4: join author profile so clients don't need a second round-trip.
      const rows = await database
        .select({ comment: comments, author: { id: users.id, name: users.name, avatar: users.avatar } })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .where(input.mediaId ? eq(comments.mediaId, input.mediaId) : undefined)
        .orderBy(desc(comments.createdAt))
        .limit(input.take)
        .offset(input.skip);
      return rows.map((r) => ({ ...r.comment, author: r.author?.id ? r.author : null }));
    }),

  deleteComment: protectedProcedure
    .input(z.object({ id: commentIdInput }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database
        .select()
        .from(comments)
        .where(eq(comments.id, input.id))
        .limit(1);
      const comment = rows[0];
      if (!comment) throw new Error("Comment not found");
      await requireMediaAccess(ctx.user.id, comment.mediaId);
      if (comment.userId !== ctx.user.id)
        throw new Error("Only comment author can delete");
      await database.delete(comments).where(eq(comments.id, input.id));
      await database
        .update(media)
        .set({ commentCount: sql`greatest(${media.commentCount} - 1, 0)` })
        .where(eq(media.id, comment.mediaId));
      return { success: true };
    }),

  createLike: protectedProcedure
    .input(z.object({ mediaId: mediaIdInput }))
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      const database = await requireDatabase();
      const existing = await database
        .select()
        .from(likes)
        .where(
          and(eq(likes.userId, ctx.user.id), eq(likes.mediaId, input.mediaId)),
        )
        .limit(1);
      // Idempotent: liking twice returns the existing row (UNIQUE(mediaId,userId) also guards the DB).
      if (existing.length > 0) return existing[0];
      const inserted = await database
        .insert(likes)
        .values({ userId: ctx.user.id, mediaId: input.mediaId });
      await database
        .update(media)
        .set({ likeCount: sql`${media.likeCount} + 1` })
        .where(eq(media.id, input.mediaId));
      await notifyMediaOwner(input.mediaId, ctx.user.id, "like");
      const rows = await database
        .select()
        .from(likes)
        .where(eq(likes.id, Number(inserted[0].insertId)))
        .limit(1);
      return rows[0];
    }),

  deleteLike: protectedProcedure
    .input(z.object({ mediaId: mediaIdInput }))
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      const database = await requireDatabase();
      const deleted = await database
        .delete(likes)
        .where(
          and(eq(likes.userId, ctx.user.id), eq(likes.mediaId, input.mediaId)),
        );
      if (Number((deleted[0] as { affectedRows?: number }).affectedRows ?? 0) > 0) {
        await database
          .update(media)
          .set({ likeCount: sql`greatest(${media.likeCount} - 1, 0)` })
          .where(eq(media.id, input.mediaId));
      }
      return { success: true };
    }),

  getLikes: protectedProcedure
    .input(
      z.object({
        mediaId: mediaIdInput,
        skip: z.coerce.number().int().min(0).default(0),
        take: z.coerce.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      const database = await requireDatabase();
      return database
        .select()
        .from(likes)
        .where(eq(likes.mediaId, input.mediaId))
        .orderBy(desc(likes.createdAt))
        .limit(input.take)
        .offset(input.skip);
    }),

  /** Whether the current user has liked this media (for the heart state). */
  hasLiked: protectedProcedure
    .input(z.object({ mediaId: mediaIdInput }))
    .query(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      const database = await requireDatabase();
      const rows = await database
        .select({ id: likes.id })
        .from(likes)
        .where(and(eq(likes.mediaId, input.mediaId), eq(likes.userId, ctx.user.id)))
        .limit(1);
      return { liked: rows.length > 0 };
    }),

  createShare: protectedProcedure
    .input(
      z.object({
        mediaId: mediaIdInput.optional(),
        albumId: z.coerce.number().int().positive().optional(),
        platform: z.enum(SHARE_PLATFORMS),
        caption: z.string().max(5000).optional(),
        /** 1–365 days; omit for a link that never expires. */
        expiresInDays: z.number().int().min(1).max(365).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!input.mediaId && !input.albumId)
        throw new Error("mediaId or albumId is required");
      if (input.mediaId) await requireMediaAccess(ctx.user.id, input.mediaId);
      if (input.albumId) await requireAlbumAccess(ctx.user.id, input.albumId);
      await assertUserRateLimit(ctx.user.id, "share", USER_LIMITS.share.limit, USER_LIMITS.share.windowMs);
      const database = await requireDatabase();
      const shareId = crypto.randomUUID();
      const appUrl = process.env.APP_URL;
      if (!appUrl) throw new Error("APP_URL is not configured");
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : undefined;
      await database.insert(shares).values({
        id: shareId,
        userId: ctx.user.id,
        mediaId: input.mediaId,
        albumId: input.albumId,
        platform: input.platform,
        caption: input.caption,
        expiresAt,
        shareUrl: `${appUrl.replace(/\/$/, "")}/share/${shareId}`,
      });
      const rows = await database
        .select()
        .from(shares)
        .where(eq(shares.id, shareId))
        .limit(1);
      return withStatus(rows[0]);
    }),

  getShares: protectedProcedure
    .input(
      z.object({
        mediaId: mediaIdInput.optional(),
        albumId: z.coerce.number().int().positive().optional(),
        /** `active` hides revoked + expired links (default: everything). */
        status: z.enum(["active", "all"]).default("all"),
        skip: z.coerce.number().int().min(0).default(0),
        take: z.coerce.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.mediaId) await requireMediaAccess(ctx.user.id, input.mediaId);
      if (input.albumId) await requireAlbumAccess(ctx.user.id, input.albumId);
      const database = await requireDatabase();
      const rows = await database
        .select()
        .from(shares)
        .where(
          and(
            eq(shares.userId, ctx.user.id),
            input.mediaId ? eq(shares.mediaId, input.mediaId) : undefined,
            input.albumId ? eq(shares.albumId, input.albumId) : undefined,
            input.status === "active" ? isNull(shares.revokedAt) : undefined,
            input.status === "active"
              ? sql`(${shares.expiresAt} IS NULL OR ${shares.expiresAt} > NOW())`
              : undefined,
          ),
        )
        .orderBy(desc(shares.createdAt))
        .limit(input.take)
        .offset(input.skip);
      return rows.map(withStatus);
    }),

  getShareStats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => withStatus(await requireShareAccess(ctx.user.id, input.id))),

  /** Clicks only count while the link is active; a revoked/expired link 410s. */
  recordShareClick: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const share = await requireShareAccess(ctx.user.id, input.id);
      if (shareStatus(share) !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: `Share link is ${shareStatus(share)}` });
      }
      const database = await requireDatabase();
      await database
        .update(shares)
        .set({ clicks: sql`${shares.clicks} + 1` })
        .where(eq(shares.id, input.id));
      return { success: true };
    }),

  /** Owner-only. Idempotent: revoking twice is a no-op. */
  revokeShare: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const share = await requireShareAccess(ctx.user.id, input.id);
      if (share.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the share owner can revoke it" });
      }
      const database = await requireDatabase();
      if (!share.revokedAt) {
        await database
          .update(shares)
          .set({ revokedAt: new Date() })
          .where(and(eq(shares.id, input.id), isNull(shares.revokedAt)));
      }
      const rows = await database.select().from(shares).where(eq(shares.id, input.id)).limit(1);
      return withStatus(rows[0]);
    }),

  /**
   * Owner-only. Set a new expiry (relative to now) or clear it with `null`.
   * Cannot resurrect a revoked link — create a new share instead.
   */
  updateShareExpiry: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        expiresInDays: z.number().int().min(1).max(365).nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const share = await requireShareAccess(ctx.user.id, input.id);
      if (share.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the share owner can change its expiry" });
      }
      if (share.revokedAt) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Revoked shares cannot be extended" });
      }
      const database = await requireDatabase();
      await database
        .update(shares)
        .set({
          expiresAt:
            input.expiresInDays === null
              ? null
              : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
        })
        .where(eq(shares.id, input.id));
      const rows = await database.select().from(shares).where(eq(shares.id, input.id)).limit(1);
      return withStatus(rows[0]);
    }),
});
