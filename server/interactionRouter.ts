import { router, protectedProcedure } from "@/server/_core/trpc";
import { z } from "zod";
import { db } from "@/server/db";
import { comments, likes, shares } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

export const interactionRouter = router({
  // 创建评论
  createComment: protectedProcedure
    .input(
      z.object({
        mediaId: z.string(),
        albumId: z.string(),
        content: z.string(),
        mentions: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await db
        .insert(comments)
        .values({
          mediaId: input.mediaId,
          albumId: input.albumId,
          userId: ctx.user.id,
          content: input.content,
          mentions: input.mentions || [],
          createdAt: new Date(),
        })
        .returning();

      return result[0];
    }),

  // 获取评论列表
  getComments: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().optional(),
        albumId: z.string().optional(),
        skip: z.number().default(0),
        take: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      const commentList = await db.query.comments.findMany({
        where: (comments) =>
          and(
            input.mediaId ? eq(comments.mediaId, input.mediaId) : undefined,
            input.albumId ? eq(comments.albumId, input.albumId) : undefined
          ),
        orderBy: (comments) => comments.createdAt,
        limit: input.take,
        offset: input.skip,
      });

      return commentList;
    }),

  // 删除评论
  deleteComment: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const comment = await db.query.comments.findFirst({
        where: eq(comments.id, input.id),
      });

      if (!comment) {
        throw new Error("Comment not found");
      }

      if (comment.userId !== ctx.user.id) {
        throw new Error("Only comment author can delete");
      }

      await db.delete(comments).where(eq(comments.id, input.id));

      return { success: true };
    }),

  // 点赞
  createLike: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().optional(),
        albumId: z.string().optional(),
        commentId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 检查是否已经点赞
      const existingLike = await db.query.likes.findFirst({
        where: (likes) =>
          and(
            eq(likes.userId, ctx.user.id),
            input.mediaId ? eq(likes.mediaId, input.mediaId) : undefined,
            input.albumId ? eq(likes.albumId, input.albumId) : undefined,
            input.commentId ? eq(likes.commentId, input.commentId) : undefined
          ),
      });

      if (existingLike) {
        throw new Error("Already liked");
      }

      const result = await db
        .insert(likes)
        .values({
          userId: ctx.user.id,
          mediaId: input.mediaId,
          albumId: input.albumId,
          commentId: input.commentId,
          createdAt: new Date(),
        })
        .returning();

      return result[0];
    }),

  // 取消点赞
  deleteLike: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().optional(),
        albumId: z.string().optional(),
        commentId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(likes)
        .where(
          and(
            eq(likes.userId, ctx.user.id),
            input.mediaId ? eq(likes.mediaId, input.mediaId) : undefined,
            input.albumId ? eq(likes.albumId, input.albumId) : undefined,
            input.commentId ? eq(likes.commentId, input.commentId) : undefined
          )
        );

      return { success: true };
    }),

  // 获取点赞列表
  getLikes: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().optional(),
        albumId: z.string().optional(),
        commentId: z.string().optional(),
        skip: z.number().default(0),
        take: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      const likeList = await db.query.likes.findMany({
        where: (likes) =>
          and(
            input.mediaId ? eq(likes.mediaId, input.mediaId) : undefined,
            input.albumId ? eq(likes.albumId, input.albumId) : undefined,
            input.commentId ? eq(likes.commentId, input.commentId) : undefined
          ),
        orderBy: (likes) => likes.createdAt,
        limit: input.take,
        offset: input.skip,
      });

      return likeList;
    }),

  // 创建分享
  createShare: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().optional(),
        albumId: z.string().optional(),
        platform: z.enum(["wechat", "facebook", "instagram", "whatsapp", "link"]),
        caption: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const shareId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const result = await db
        .insert(shares)
        .values({
          id: shareId,
          userId: ctx.user.id,
          mediaId: input.mediaId,
          albumId: input.albumId,
          platform: input.platform,
          caption: input.caption,
          shareUrl: `${process.env.APP_URL}/share/${shareId}`,
          createdAt: new Date(),
        })
        .returning();

      return result[0];
    }),

  // 获取分享列表
  getShares: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().optional(),
        albumId: z.string().optional(),
        skip: z.number().default(0),
        take: z.number().default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const shareList = await db.query.shares.findMany({
        where: (shares) =>
          and(
            eq(shares.userId, ctx.user.id),
            input.mediaId ? eq(shares.mediaId, input.mediaId) : undefined,
            input.albumId ? eq(shares.albumId, input.albumId) : undefined
          ),
        orderBy: (shares) => shares.createdAt,
        limit: input.take,
        offset: input.skip,
      });

      return shareList;
    }),

  // 获取分享统计
  getShareStats: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const share = await db.query.shares.findFirst({
        where: eq(shares.id, input.id),
      });

      if (!share) {
        throw new Error("Share not found");
      }

      return {
        id: share.id,
        platform: share.platform,
        clicks: share.clicks || 0,
        shares: share.shares || 0,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
      };
    }),

  // 记录分享点击
  recordShareClick: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const share = await db.query.shares.findFirst({
        where: eq(shares.id, input.id),
      });

      if (!share) {
        throw new Error("Share not found");
      }

      await db
        .update(shares)
        .set({
          clicks: (share.clicks || 0) + 1,
        })
        .where(eq(shares.id, input.id));

      return { success: true };
    }),
});
