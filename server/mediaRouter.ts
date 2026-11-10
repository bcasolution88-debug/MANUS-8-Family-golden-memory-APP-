import { router, protectedProcedure } from "@/server/_core/trpc";
import { z } from "zod";
import { getDb } from "@/server/db";
import { media } from "@/drizzle/schema";
import { and, desc, eq } from "drizzle-orm";

const mediaIdInput = z.coerce.number().int().positive();
const albumIdInput = z.coerce.number().int().positive();

async function requireDb() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

const mediaTypeInput = z.enum(["image", "video"]);
type ClientMediaType = z.infer<typeof mediaTypeInput>;
const toDbMediaType = (type: ClientMediaType): "photo" | "video" =>
  type === "image" ? "photo" : "video";

export const mediaRouter = router({
  initUpload: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1),
        fileSize: z.number().int().nonnegative(),
        fileType: mediaTypeInput,
        albumId: albumIdInput,
      }),
    )
    .mutation(async ({ input }) => {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      return {
        uploadId,
        presignedUrl: generatePresignedUrl(uploadId, input.fileName),
        chunkSize: 5 * 1024 * 1024,
      };
    }),

  completeUpload: protectedProcedure
    .input(
      z.object({
        uploadId: z.string().min(1),
        fileName: z.string().min(1),
        fileSize: z.number().int().nonnegative(),
        fileType: mediaTypeInput,
        albumId: albumIdInput,
        familyId: z.coerce.number().int().positive(),
        title: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await requireDb();
      const s3Url = `https://${process.env.AWS_S3_BUCKET ?? "golden-memory"}.s3.amazonaws.com/${input.uploadId}/${input.fileName}`;
      const inserted = await database.insert(media).values({
        albumId: input.albumId,
        familyId: input.familyId,
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
    .query(async ({ input }) => {
      const database = await requireDb();
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
    .query(async ({ input }) => {
      const database = await requireDb();
      const rows = await database.select().from(media).where(eq(media.id, input.id)).limit(1);
      return rows[0];
    }),

  updateMedia: protectedProcedure
    .input(
      z.object({
        id: mediaIdInput,
        title: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const database = await requireDb();
      await database
        .update(media)
        .set({ title: input.title, description: input.description })
        .where(eq(media.id, input.id));
      const rows = await database.select().from(media).where(eq(media.id, input.id)).limit(1);
      return rows[0];
    }),

  deleteMedia: protectedProcedure
    .input(z.object({ id: mediaIdInput }))
    .mutation(async ({ input }) => {
      const database = await requireDb();
      await database.delete(media).where(eq(media.id, input.id));
      return { success: true };
    }),
});

function generatePresignedUrl(uploadId: string, fileName: string): string {
  const key = `${uploadId}/${encodeURIComponent(fileName)}`;
  const bucket = process.env.AWS_S3_BUCKET || "golden-memory";
  const region = process.env.AWS_REGION || "us-east-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
