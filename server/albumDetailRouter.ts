import { router, protectedProcedure } from "@/server/_core/trpc";
import {
  requireAlbumAccess,
  requireFamilyMember,
} from "@/server/_core/authorization";
import { z } from "zod";
import { getDb } from "@/server/db";
import {
  albums,
  comments,
  familyMembers,
  likes,
  media,
} from "@/drizzle/schema";
import { and, desc, eq } from "drizzle-orm";

const albumIdInput = z.coerce.number().int().positive();
const familyIdInput = z.coerce.number().int().positive();
async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export const albumDetailRouter = router({
  createAlbum: protectedProcedure
    .input(
      z.object({
        familyId: familyIdInput,
        title: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
        type: z
          .enum(["anniversary", "memory", "timeline", "story"])
          .default("memory"),
        isPrivate: z.boolean().default(false),
        coverImage: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      const database = await requireDatabase();
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
      await requireFamilyMember(ctx.user.id, input.familyId);
      const database = await requireDatabase();
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
    .query(async ({ input, ctx }) => requireAlbumAccess(ctx.user.id, input.id)),

  updateAlbum: protectedProcedure
    .input(
      z.object({
        id: albumIdInput,
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(5000).optional(),
        coverImage: z.string().url().nullable().optional(),
        isPrivate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.id);
      if (album.createdBy !== ctx.user.id)
        throw new Error("Only album creator can update");
      const database = await requireDatabase();
      await database
        .update(albums)
        .set({
          name: input.title,
          description: input.description,
          thumbnail: input.coverImage,
          isPrivate: input.isPrivate,
        })
        .where(eq(albums.id, input.id));
      const updated = await database
        .select()
        .from(albums)
        .where(eq(albums.id, input.id))
        .limit(1);
      return updated[0];
    }),

  deleteAlbum: protectedProcedure
    .input(z.object({ id: albumIdInput }))
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.id);
      if (album.createdBy !== ctx.user.id)
        throw new Error("Only album creator can delete");
      const database = await requireDatabase();
      await database.delete(albums).where(eq(albums.id, input.id));
      return { success: true };
    }),

  getAlbumStats: protectedProcedure
    .input(z.object({ id: albumIdInput }))
    .query(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.id);
      const database = await requireDatabase();
      const [mediaRows, commentRows, likeRows] = await Promise.all([
        database
          .select({ id: media.id })
          .from(media)
          .where(eq(media.albumId, input.id)),
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
