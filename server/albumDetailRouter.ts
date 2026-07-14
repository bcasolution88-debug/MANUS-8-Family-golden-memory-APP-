import { router, protectedProcedure } from "@/server/_core/trpc";
import { z } from "zod";
import { db } from "@/server/db";
import { albums, familyMembers } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

export const albumDetailRouter = router({
  // 创建相册
  createAlbum: protectedProcedure
    .input(
      z.object({
        familyId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        type: z.enum(["anniversary", "memory", "timeline", "story"]).default("memory"),
        isPrivate: z.boolean().default(false),
        coverImage: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 验证用户是否是家庭成员
      const member = await db.query.familyMembers.findFirst({
        where: (familyMembers) =>
          and(
            eq(familyMembers.familyId, input.familyId),
            eq(familyMembers.userId, ctx.user.id)
          ),
      });

      if (!member) {
        throw new Error("User is not a member of this family");
      }

      const result = await db
        .insert(albums)
        .values({
          familyId: input.familyId,
          createdBy: ctx.user.id,
          title: input.title,
          description: input.description,
          type: input.type,
          isPrivate: input.isPrivate,
          coverImage: input.coverImage,
          createdAt: new Date(),
        })
        .returning();

      return result[0];
    }),

  // 获取相册列表
  getAlbums: protectedProcedure
    .input(
      z.object({
        familyId: z.string(),
        type: z.enum(["anniversary", "memory", "timeline", "story"]).optional(),
        skip: z.number().default(0),
        take: z.number().default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      // 验证用户是否是家庭成员
      const member = await db.query.familyMembers.findFirst({
        where: (familyMembers) =>
          and(
            eq(familyMembers.familyId, input.familyId),
            eq(familyMembers.userId, ctx.user.id)
          ),
      });

      if (!member) {
        throw new Error("User is not a member of this family");
      }

      const albumList = await db.query.albums.findMany({
        where: (albums) =>
          and(
            eq(albums.familyId, input.familyId),
            input.type ? eq(albums.type, input.type) : undefined
          ),
        orderBy: (albums) => albums.createdAt,
        limit: input.take,
        offset: input.skip,
      });

      return albumList;
    }),

  // 获取相册详情
  getAlbum: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const album = await db.query.albums.findFirst({
        where: eq(albums.id, input.id),
      });

      if (!album) {
        throw new Error("Album not found");
      }

      // 验证用户是否有权限访问
      const member = await db.query.familyMembers.findFirst({
        where: (familyMembers) =>
          and(
            eq(familyMembers.familyId, album.familyId),
            eq(familyMembers.userId, ctx.user.id)
          ),
      });

      if (!member && album.isPrivate) {
        throw new Error("Access denied");
      }

      return album;
    }),

  // 更新相册
  updateAlbum: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        coverImage: z.string().optional(),
        isPrivate: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const album = await db.query.albums.findFirst({
        where: eq(albums.id, input.id),
      });

      if (!album) {
        throw new Error("Album not found");
      }

      // 验证用户是否是相册创建者
      if (album.createdBy !== ctx.user.id) {
        throw new Error("Only album creator can update");
      }

      const result = await db
        .update(albums)
        .set({
          title: input.title,
          description: input.description,
          coverImage: input.coverImage,
          isPrivate: input.isPrivate,
        })
        .where(eq(albums.id, input.id))
        .returning();

      return result[0];
    }),

  // 删除相册
  deleteAlbum: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const album = await db.query.albums.findFirst({
        where: eq(albums.id, input.id),
      });

      if (!album) {
        throw new Error("Album not found");
      }

      // 验证用户是否是相册创建者
      if (album.createdBy !== ctx.user.id) {
        throw new Error("Only album creator can delete");
      }

      await db.delete(albums).where(eq(albums.id, input.id));

      return { success: true };
    }),

  // 获取相册统计信息
  getAlbumStats: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const album = await db.query.albums.findFirst({
        where: eq(albums.id, input.id),
      });

      if (!album) {
        throw new Error("Album not found");
      }

      // 获取媒体数量
      const mediaCount = await db.query.media.findMany({
        where: (media) => eq(media.albumId, input.id),
      });

      // 获取评论数量
      const commentCount = await db.query.comments.findMany({
        where: (comments) => eq(comments.albumId, input.id),
      });

      // 获取点赞数量
      const likeCount = await db.query.likes.findMany({
        where: (likes) => eq(likes.albumId, input.id),
      });

      return {
        mediaCount: mediaCount.length,
        commentCount: commentCount.length,
        likeCount: likeCount.length,
        createdAt: album.createdAt,
        updatedAt: album.updatedAt,
      };
    }),
});
