import { and, desc, eq, like, sql } from "drizzle-orm";
import { z } from "zod";

import { albums, comments, likes, media } from "@/drizzle/schema";
import {
  requireAlbumAccess,
  requireFamilyEditor,
  requireFamilyMember,
} from "@/server/_core/authorization";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { getDb } from "@/server/db";
import { notifyFamily } from "@/server/notifications";

/**
 * Album router — single source of truth for album CRUD + stats.
 *
 * Merged from the former `album` (v1, db.ts helpers) and `albumDetail` routers.
 * Likes / comments / shares live in `interactionRouter`; media CRUD and uploads
 * live in `mediaRouter`.
 *
 * Categories match the Upload / Album screens: daily / gathering / travel /
 * memorial / other (plus legacy values kept for existing rows).
 */

export const ALBUM_CATEGORIES = [
  "daily",
  "gathering",
  "travel",
  "memorial",
  "other",
  // legacy values from the old albumDetail router
  "anniversary",
  "memory",
  "timeline",
  "story",
] as const;

const idInput = z.coerce.number().int().positive();

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

export const albumRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        familyId: idInput,
        name: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
        category: z.enum(ALBUM_CATEGORIES).default("other"),
        isPrivate: z.boolean().default(false),
        thumbnail: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyEditor(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const inserted = await database.insert(albums).values({
        familyId: input.familyId,
        createdBy: ctx.user.id,
        name: input.name,
        description: input.description,
        category: input.category,
        isPrivate: input.isPrivate,
        thumbnail: input.thumbnail,
      });
      const id = Number(inserted[0].insertId);
      const rows = await database.select().from(albums).where(eq(albums.id, id)).limit(1);
      // Private albums are not announced.
      if (!input.isPrivate) {
        await notifyFamily(
          input.familyId,
          { actorId: ctx.user.id, type: "upload", albumId: id, preview: input.name },
          ctx.user.id,
        );
      }
      return rows[0];
    }),

  list: protectedProcedure
    .input(
      z.object({
        familyId: idInput,
        category: z.enum(ALBUM_CATEGORIES).optional(),
        search: z.string().trim().max(100).optional(),
        sort: z.enum(["newest", "oldest", "name"]).default("newest"),
        skip: z.coerce.number().int().min(0).default(0),
        take: z.coerce.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const member = await requireFamilyMember(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const canSeePrivate = member.role === "owner" || member.role === "admin";
      const orderBy =
        input.sort === "oldest"
          ? albums.createdAt
          : input.sort === "name"
            ? albums.name
            : desc(albums.createdAt);

      return database
        .select({
          album: albums,
          mediaCount: sql<number>`(select count(*) from ${media} where ${media.albumId} = ${albums.id})`,
        })
        .from(albums)
        .where(
          and(
            eq(albums.familyId, input.familyId),
            input.category ? eq(albums.category, input.category) : undefined,
            input.search ? like(albums.name, `%${input.search}%`) : undefined,
            // Private albums: visible to creator and family admins only.
            canSeePrivate
              ? undefined
              : sql`(${albums.isPrivate} = false OR ${albums.createdBy} = ${ctx.user.id})`,
          ),
        )
        .orderBy(orderBy)
        .limit(input.take)
        .offset(input.skip)
        .then((rows) => rows.map((r) => ({ ...r.album, mediaCount: Number(r.mediaCount) })));
    }),

  get: protectedProcedure
    .input(z.object({ id: idInput }))
    .query(async ({ input, ctx }) => requireAlbumAccess(ctx.user.id, input.id)),

  update: protectedProcedure
    .input(
      z.object({
        id: idInput,
        name: z.string().min(1).max(255).optional(),
        description: z.string().max(5000).nullable().optional(),
        category: z.enum(ALBUM_CATEGORIES).optional(),
        thumbnail: z.string().url().nullable().optional(),
        isPrivate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.id);
      const member = await requireFamilyMember(ctx.user.id, album.familyId);
      const isAdmin = member.role === "owner" || member.role === "admin";
      if (album.createdBy !== ctx.user.id && !isAdmin)
        throw new Error("Only the album creator or a family admin can update it");
      const database = await requireDatabase();
      const { id, ...patch } = input;
      await database.update(albums).set(patch).where(eq(albums.id, id));
      const rows = await database.select().from(albums).where(eq(albums.id, id)).limit(1);
      return rows[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: idInput }))
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.id);
      const member = await requireFamilyMember(ctx.user.id, album.familyId);
      const isAdmin = member.role === "owner" || member.role === "admin";
      if (album.createdBy !== ctx.user.id && !isAdmin)
        throw new Error("Only the album creator or a family admin can delete it");
      const database = await requireDatabase();
      // Cascade: media -> likes/comments -> album (no DB-level FKs in this schema).
      const mediaIds = (
        await database.select({ id: media.id }).from(media).where(eq(media.albumId, input.id))
      ).map((m) => m.id);
      if (mediaIds.length) {
        await database.delete(likes).where(sql`${likes.mediaId} in (${sql.join(mediaIds.map((m) => sql`${m}`), sql`, `)})`);
        await database.delete(comments).where(sql`${comments.mediaId} in (${sql.join(mediaIds.map((m) => sql`${m}`), sql`, `)})`);
        await database.delete(media).where(eq(media.albumId, input.id));
      }
      await database.delete(albums).where(eq(albums.id, input.id));
      return { success: true };
    }),

  stats: protectedProcedure
    .input(z.object({ id: idInput }))
    .query(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.id);
      const database = await requireDatabase();
      const [row] = await database
        .select({
          mediaCount: sql<number>`count(distinct ${media.id})`,
          photoCount: sql<number>`count(distinct case when ${media.type} = 'photo' then ${media.id} end)`,
          videoCount: sql<number>`count(distinct case when ${media.type} = 'video' then ${media.id} end)`,
          likeCount: sql<number>`coalesce(sum(${media.likeCount}), 0)`,
          commentCount: sql<number>`coalesce(sum(${media.commentCount}), 0)`,
        })
        .from(media)
        .where(eq(media.albumId, input.id));
      return {
        mediaCount: Number(row?.mediaCount ?? 0),
        photoCount: Number(row?.photoCount ?? 0),
        videoCount: Number(row?.videoCount ?? 0),
        likeCount: Number(row?.likeCount ?? 0),
        commentCount: Number(row?.commentCount ?? 0),
        createdAt: album.createdAt,
        updatedAt: album.updatedAt,
      };
    }),
});
