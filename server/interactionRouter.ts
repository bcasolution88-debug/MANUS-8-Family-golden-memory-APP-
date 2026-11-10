import { router, protectedProcedure } from "@/server/_core/trpc";
import {
  requireAlbumAccess,
  requireMediaAccess,
  requireShareAccess,
} from "@/server/_core/authorization";
import { z } from "zod";
import { getDb } from "@/server/db";
import { comments, likes, shares } from "@/drizzle/schema";
import { and, desc, eq } from "drizzle-orm";

const mediaIdInput = z.coerce.number().int().positive();
const commentIdInput = z.coerce.number().int().positive();
async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

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
      const rows = await database
        .select()
        .from(comments)
        .where(eq(comments.id, Number(inserted[0].insertId)))
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
      return database
        .select()
        .from(comments)
        .where(input.mediaId ? eq(comments.mediaId, input.mediaId) : undefined)
        .orderBy(desc(comments.createdAt))
        .limit(input.take)
        .offset(input.skip);
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
      if (existing.length > 0) throw new Error("Already liked");
      const inserted = await database
        .insert(likes)
        .values({ userId: ctx.user.id, mediaId: input.mediaId });
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
      await database
        .delete(likes)
        .where(
          and(eq(likes.userId, ctx.user.id), eq(likes.mediaId, input.mediaId)),
        );
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

  createShare: protectedProcedure
    .input(
      z.object({
        mediaId: mediaIdInput.optional(),
        albumId: z.coerce.number().int().positive().optional(),
        platform: z.enum([
          "wechat",
          "facebook",
          "instagram",
          "whatsapp",
          "link",
        ]),
        caption: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!input.mediaId && !input.albumId)
        throw new Error("mediaId or albumId is required");
      if (input.mediaId) await requireMediaAccess(ctx.user.id, input.mediaId);
      if (input.albumId) await requireAlbumAccess(ctx.user.id, input.albumId);
      const database = await requireDatabase();
      const shareId = crypto.randomUUID();
      const appUrl = process.env.APP_URL;
      if (!appUrl) throw new Error("APP_URL is not configured");
      await database.insert(shares).values({
        id: shareId,
        userId: ctx.user.id,
        mediaId: input.mediaId,
        albumId: input.albumId,
        platform: input.platform,
        caption: input.caption,
        shareUrl: `${appUrl.replace(/\/$/, "")}/share/${shareId}`,
      });
      const rows = await database
        .select()
        .from(shares)
        .where(eq(shares.id, shareId))
        .limit(1);
      return rows[0];
    }),

  getShares: protectedProcedure
    .input(
      z.object({
        mediaId: mediaIdInput.optional(),
        albumId: z.coerce.number().int().positive().optional(),
        skip: z.coerce.number().int().min(0).default(0),
        take: z.coerce.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.mediaId) await requireMediaAccess(ctx.user.id, input.mediaId);
      if (input.albumId) await requireAlbumAccess(ctx.user.id, input.albumId);
      const database = await requireDatabase();
      return database
        .select()
        .from(shares)
        .where(
          and(
            eq(shares.userId, ctx.user.id),
            input.mediaId ? eq(shares.mediaId, input.mediaId) : undefined,
            input.albumId ? eq(shares.albumId, input.albumId) : undefined,
          ),
        )
        .orderBy(desc(shares.createdAt))
        .limit(input.take)
        .offset(input.skip);
    }),

  getShareStats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input, ctx }) => requireShareAccess(ctx.user.id, input.id)),

  recordShareClick: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const share = await requireShareAccess(ctx.user.id, input.id);
      const database = await requireDatabase();
      await database
        .update(shares)
        .set({ clicks: share.clicks + 1 })
        .where(eq(shares.id, input.id));
      return { success: true };
    }),
});
