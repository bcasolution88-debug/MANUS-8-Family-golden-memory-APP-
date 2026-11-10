import { router, protectedProcedure } from "@/server/_core/trpc";
import { z } from "zod";
import { getDb } from "@/server/db";
import { albums, comments, familyMembers, likes, media } from "@/drizzle/schema";
import { and, desc, eq } from "drizzle-orm";

const albumIdInput = z.coerce.number().int().positive();
const familyIdInput = z.coerce.number().int().positive();

async function requireDb() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export const albumDetailRouter = router({
  createAlbum: protectedProcedure
    .input(
      z.object({
        familyId: familyIdInput,
        title: z.string().min(1),
        description: z.string().optional(),
        type: z.enum(["anniversary", "memory", "timeline", "story"]).default("memory"),
        isPrivate: z.boolean().default(false),
        coverImage: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await requireDb();
      const member = await database
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.familyId, input.familyId), eq(familyMembers.userId, ctx.user.id)))
        .limit(1);

      if (member.length === 0) throw new Error("User is not a member of this family");

      const inserted = await database.insert(albums).values({
        familyId: input.familyId,
        createdBy: ctx.user.id,
        name: input.title,
        description: input.description,
        category: input.type,
        isPrivate: input.isPrivate,
        thumbnail: input.coverImage,
      });

      const created = await database
        .select()
        .from(albums)
        .where(eq(albums.id, Number(inserted[0].insertId)))
        .limit(1);
      return created[0];
    }),

  getAlbums: protectedProcedure
    .input(
      z.object({
        familyId: familyIdInput,
        type: z.enum(["anniversary", "memory", "timeline", "story"]).optional(),
        skip: z.coerce.number().int().min(0).default(0),
        take: z.coerce.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await requireDb();
      const member = await database
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.familyId, input.familyId), eq(familyMembers.userId, ctx.user.id)))
        .limit(1);
      if (member.length === 0) throw new Error("User is not a member of this family");

      return database
        .select()
        .from(albums)
        .where(
          and(
            eq(albums.familyId, input.familyId),
            input.type ? eq(albums.category, input.type) : undefined,
          ),
        )
        .orderBy(desc(albums.createdAt))
        .limit(input.take)
        .offset(input.skip);
    }),

  getAlbum: protectedProcedure
    .input(z.object({ id: albumIdInput }))
    .query(async ({ input, ctx }) => {
      const database = await requireDb();
      const albumRows = await database.select().from(albums).where(eq(albums.id, input.id)).limit(1);
      const album = albumRows[0];
      if (!album) throw new Error("Album not found");

      const member = await database
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.familyId, album.familyId), eq(familyMembers.userId, ctx.user.id)))
        .limit(1);
      if (album.isPrivate && member.length === 0) throw new Error("Access denied");
      return album;
    }),

  updateAlbum: protectedProcedure
    .input(
      z.object({
        id: albumIdInput,
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        coverImage: z.string().url().nullable().optional(),
        isPrivate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await requireDb();
      const rows = await database.select().from(albums).where(eq(albums.id, input.id)).limit(1);
      const album = rows[0];
      if (!album) throw new Error("Album not found");
      if (album.createdBy !== ctx.user.id) throw new Error("Only album creator can update");

      await database
        .update(albums)
        .set({
          name: input.title,
          description: input.description,
          thumbnail: input.coverImage,
          isPrivate: input.isPrivate,
        })
        .where(eq(albums.id, input.id));
      const updated = await database.select().from(albums).where(eq(albums.id, input.id)).limit(1);
      return updated[0];
    }),

  deleteAlbum: protectedProcedure
    .input(z.object({ id: albumIdInput }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDb();
      const rows = await database.select().from(albums).where(eq(albums.id, input.id)).limit(1);
      const album = rows[0];
      if (!album) throw new Error("Album not found");
      if (album.createdBy !== ctx.user.id) throw new Error("Only album creator can delete");
      await database.delete(albums).where(eq(albums.id, input.id));
      return { success: true };
    }),

  getAlbumStats: protectedProcedure
    .input(z.object({ id: albumIdInput }))
    .query(async ({ input }) => {
      const database = await requireDb();
      const rows = await database.select().from(albums).where(eq(albums.id, input.id)).limit(1);
      const album = rows[0];
      if (!album) throw new Error("Album not found");

      const [mediaRows, commentRows, likeRows] = await Promise.all([
        database.select({ id: media.id }).from(media).where(eq(media.albumId, input.id)),
        database
          .select({ id: comments.id })
          .from(comments)
          .innerJoin(media, eq(comments.mediaId, media.id))
          .where(eq(media.albumId, input.id)),
        database
          .select({ id: likes.id })
          .from(likes)
          .innerJoin(media, eq(likes.mediaId, media.id))
          .where(eq(media.albumId, input.id)),
      ]);

      return {
        mediaCount: mediaRows.length,
        commentCount: commentRows.length,
        likeCount: likeRows.length,
        createdAt: album.createdAt,
        updatedAt: album.updatedAt,
      };
    }),
});
