import { router, protectedProcedure } from "@/server/_core/trpc";
import {
  requireAlbumAccess,
  requireMediaAccess,
} from "@/server/_core/authorization";
import { z } from "zod";
import { getDb } from "@/server/db";
import { media } from "@/drizzle/schema";
import { and, desc, eq } from "drizzle-orm";

const mediaIdInput = z.coerce.number().int().positive();
const albumIdInput = z.coerce.number().int().positive();
const mediaTypeInput = z.enum(["image", "video"]);
type ClientMediaType = z.infer<typeof mediaTypeInput>;
const toDbMediaType = (type: ClientMediaType): "photo" | "video" =>
  type === "image" ? "photo" : "video";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export const mediaRouter = router({
  initUpload: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(255),
        fileSize: z
          .number()
          .int()
          .positive()
          .max(1024 * 1024 * 1024),
        fileType: mediaTypeInput,
        albumId: albumIdInput,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireAlbumAccess(ctx.user.id, input.albumId);
      const uploadId = `${crypto.randomUUID()}`;
      return {
        uploadId,
        presignedUrl: generatePresignedUrl(uploadId, input.fileName),
        chunkSize: 5 * 1024 * 1024,
      };
    }),

  completeUpload: protectedProcedure
    .input(
      z.object({
        uploadId: z.string().uuid(),
        fileName: z.string().min(1).max(255),
        fileSize: z
          .number()
          .int()
          .positive()
          .max(1024 * 1024 * 1024),
        fileType: mediaTypeInput,
        albumId: albumIdInput,
        familyId: z.coerce.number().int().positive(),
        title: z.string().max(255).optional(),
        description: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.albumId);
      if (album.familyId !== input.familyId)
        throw new Error("Family does not match album");
      const database = await requireDatabase();
      const bucket = process.env.AWS_S3_BUCKET;
      const region = process.env.AWS_REGION || "us-east-1";
      if (!bucket) throw new Error("Storage bucket is not configured");
      const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${input.uploadId}/${encodeURIComponent(input.fileName)}`;
      const inserted = await database.insert(media).values({
        albumId: input.albumId,
        familyId: album.familyId,
        uploadedBy: ctx.user.id,
        type: toDbMediaType(input.fileType),
        url: s3Url,
        thumbnail: input.fileType === "image" ? s3Url : undefined,
        title: input.title ?? input.fileName,
        description: input.description,
        fileSize: input.fileSize,
      });
      const rows = await database
        .select()
        .from(media)
        .where(eq(media.id, Number(inserted[0].insertId)))
        .limit(1);
      return rows[0];
    }),

  getMediaList: protectedProcedure
    .input(
      z.object({
        albumId: albumIdInput,
        skip: z.coerce.number().int().min(0).default(0),
        take: z.coerce.number().int().min(1).max(100).default(20),
        type: mediaTypeInput.optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await requireAlbumAccess(ctx.user.id, input.albumId);
      const database = await requireDatabase();
      return database
        .select()
        .from(media)
        .where(
          and(
            eq(media.albumId, input.albumId),
            input.type ? eq(media.type, toDbMediaType(input.type)) : undefined,
          ),
        )
        .orderBy(desc(media.createdAt))
        .limit(input.take)
        .offset(input.skip);
    }),

  getMedia: protectedProcedure
    .input(z.object({ id: mediaIdInput }))
    .query(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.id);
      const database = await requireDatabase();
      const rows = await database
        .select()
        .from(media)
        .where(eq(media.id, input.id))
        .limit(1);
      return rows[0];
    }),

  updateMedia: protectedProcedure
    .input(
      z.object({
        id: mediaIdInput,
        title: z.string().max(255).optional(),
        description: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.id);
      const database = await requireDatabase();
      await database
        .update(media)
        .set({ title: input.title, description: input.description })
        .where(eq(media.id, input.id));
      const rows = await database
        .select()
        .from(media)
        .where(eq(media.id, input.id))
        .limit(1);
      return rows[0];
    }),

  deleteMedia: protectedProcedure
    .input(z.object({ id: mediaIdInput }))
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.id);
      const database = await requireDatabase();
      await database.delete(media).where(eq(media.id, input.id));
      return { success: true };
    }),
});

function generatePresignedUrl(uploadId: string, fileName: string): string {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION || "us-east-1";
  if (!bucket) throw new Error("Storage bucket is not configured");
  return `https://${bucket}.s3.${region}.amazonaws.com/${uploadId}/${encodeURIComponent(fileName)}`;
}
