import { router, publicProcedure, protectedProcedure } from "@/server/_core/trpc";
import { z } from "zod";
import { db } from "@/server/db";
import { media, albums } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

export const mediaRouter = router({
  // 初始化上传
  initUpload: protectedProcedure
    .input(
      z.object({
        fileName: z.string(),
        fileSize: z.number(),
        fileType: z.enum(["image", "video"]),
        albumId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const presignedUrl = generatePresignedUrl(uploadId, input.fileName);

      return {
        uploadId,
        presignedUrl,
        chunkSize: 5 * 1024 * 1024, // 5MB chunks
      };
    }),

  // 完成上传
  completeUpload: protectedProcedure
    .input(
      z.object({
        uploadId: z.string(),
        fileName: z.string(),
        fileSize: z.number(),
        fileType: z.enum(["image", "video"]),
        albumId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const s3Url = `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${input.uploadId}/${input.fileName}`;

      // 创建媒体记录
      const result = await db
        .insert(media)
        .values({
          albumId: input.albumId,
          userId: ctx.user.id,
          type: input.fileType,
          url: s3Url,
          thumbnailUrl: input.fileType === "image" ? s3Url : null,
          title: input.title || input.fileName,
          description: input.description,
          size: input.fileSize,
          metadata: {
            uploadId: input.uploadId,
            tags: input.tags || [],
          },
          createdAt: new Date(),
        })
        .returning();

      return result[0];
    }),

  // 获取媒体列表
  getMediaList: protectedProcedure
    .input(
      z.object({
        albumId: z.string(),
        skip: z.number().default(0),
        take: z.number().default(20),
        type: z.enum(["image", "video"]).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const mediaList = await db.query.media.findMany({
        where: and(
          eq(media.albumId, input.albumId),
          input.type ? eq(media.type, input.type) : undefined
        ),
        orderBy: (media) => media.createdAt,
        limit: input.take,
        offset: input.skip,
      });

      return mediaList;
    }),

  // 获取媒体详情
  getMedia: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const result = await db.query.media.findFirst({
        where: eq(media.id, input.id),
      });

      return result;
    }),

  // 更新媒体
  updateMedia: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await db
        .update(media)
        .set({
          title: input.title,
          description: input.description,
          metadata: input.tags ? { tags: input.tags } : undefined,
        })
        .where(eq(media.id, input.id))
        .returning();

      return result[0];
    }),

  // 删除媒体
  deleteMedia: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db.delete(media).where(eq(media.id, input.id));
      return { success: true };
    }),
});

// 辅助函数：生成预签名URL
function generatePresignedUrl(uploadId: string, fileName: string): string {
  // 这是一个模拟实现，实际应该使用AWS SDK生成真实的预签名URL
  const key = `${uploadId}/${fileName}`;
  const bucket = process.env.AWS_S3_BUCKET || "golden-memory";
  const region = process.env.AWS_REGION || "us-east-1";

  // 实际实现应该使用AWS SDK的getSignedUrl方法
  // const s3 = new AWS.S3();
  // const presignedUrl = s3.getSignedUrl('putObject', {
  //   Bucket: bucket,
  //   Key: key,
  //   Expires: 3600,
  // });

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
