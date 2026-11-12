import { router, protectedProcedure } from "@/server/_core/trpc";
import {
  requireAlbumAccess,
  requireFamilyMember,
  requireMediaAccess,
} from "@/server/_core/authorization";
import { z } from "zod";
import { notifyFamily } from "@/server/notifications";
import { getDb } from "@/server/db";
import { albums, comments, likes, media } from "@/drizzle/schema";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ENV } from "@/server/_core/env";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import {
  SIGNED_URL_TTL_SECONDS,
  buildMediaKey,
  isStorageConfigured,
  isValidStorageKey,
  parseStorageKey,
  storageGetSignedUrl,
  storagePresignPut,
  storageProxyPath,
} from "@/server/storage";

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
        contentType: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.albumId);
      await assertUserRateLimit(ctx.user.id, "presign", USER_LIMITS.presign.limit, USER_LIMITS.presign.windowMs);
      const uploadId = crypto.randomUUID();
      // P3: object key encodes ownership so the storage proxy can authorize by prefix.
      const storageKey = buildMediaKey(album.familyId, album.id, uploadId, input.fileName);
      // P5: client-generated thumbnail (expo-image-manipulator / expo-video-thumbnails)
      // lives beside the original under the same owned prefix.
      const thumbnailKey = buildMediaKey(album.familyId, album.id, uploadId, `thumb_${input.fileName.replace(/\.[^.]+$/, "")}.jpg`);
      const [presignedUrl, thumbnailPresignedUrl] = await Promise.all([
        presignUploadUrl(storageKey, input.contentType),
        presignUploadUrl(thumbnailKey, "image/jpeg"),
      ]);
      return {
        uploadId,
        storageKey,
        presignedUrl,
        thumbnailKey,
        thumbnailPresignedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
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
        /** Key returned by initUpload. Optional for backwards compatibility. */
        storageKey: z.string().max(512).optional(),
        thumbnailKey: z.string().max(512).optional(),
        duration: z.number().int().positive().optional(),
        title: z.string().max(255).optional(),
        description: z.string().max(20000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.albumId);
      if (album.familyId !== input.familyId)
        throw new Error("Family does not match album");
      const database = await requireDatabase();

      // Re-derive the key server-side; a client-supplied key must match exactly so
      // nobody can register an object that lives under another family's prefix.
      const expectedKey = buildMediaKey(album.familyId, album.id, input.uploadId, input.fileName);
      const storageKey = input.storageKey ?? expectedKey;
      if (storageKey !== expectedKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "storageKey does not match upload" });
      }
      const thumbnailKey = input.thumbnailKey ? assertOwnedKey(input.thumbnailKey, album.familyId, album.id) : undefined;

      const url = storageProxyPath(storageKey);
      const inserted = await database.insert(media).values({
        albumId: input.albumId,
        familyId: album.familyId,
        uploadedBy: ctx.user.id,
        type: toDbMediaType(input.fileType),
        url,
        thumbnail: thumbnailKey ? storageProxyPath(thumbnailKey) : input.fileType === "image" ? url : undefined,
        storageKey,
        thumbnailKey: thumbnailKey ?? (input.fileType === "image" ? storageKey : undefined),
        duration: input.duration,
        title: input.title ?? input.fileName,
        description: input.description,
        fileSize: input.fileSize,
      });
      const mediaId = Number(inserted[0].insertId);
      if (!album.isPrivate) {
        await notifyFamily(
          album.familyId,
          { actorId: ctx.user.id, type: "upload", mediaId, albumId: album.id, preview: album.name },
          ctx.user.id,
        );
      }
      const rows = await database
        .select()
        .from(media)
        .where(eq(media.id, mediaId))
        .limit(1);
      return rows[0];
    }),

  /** Offset-paginated list (legacy callers). Prefer `listMedia` for infinite scroll. */
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

  /** P5: latest media across the whole family (Home "featured memories"), with album name. */
  recent: protectedProcedure
    .input(
      z.object({
        familyId: z.coerce.number().int().positive(),
        take: z.coerce.number().int().min(1).max(30).default(6),
      }),
    )
    .query(async ({ input, ctx }) => {
      const member = await requireFamilyMember(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const canSeePrivate = member.role === "owner" || member.role === "admin";
      const rows = await database
        .select({ media, albumName: albums.name, albumPrivate: albums.isPrivate, albumCreatedBy: albums.createdBy })
        .from(media)
        .innerJoin(albums, eq(albums.id, media.albumId))
        .where(eq(media.familyId, input.familyId))
        .orderBy(desc(media.id))
        .limit(input.take * 2);
      return rows
        .filter((r) => canSeePrivate || !r.albumPrivate || r.albumCreatedBy === ctx.user.id)
        .slice(0, input.take)
        .map((r) => ({ ...r.media, albumName: r.albumName }));
    }),

  /** P5: keyset-paginated list for the album grid (`cursor` = last seen media.id). */
  listMedia: protectedProcedure
    .input(
      z.object({
        albumId: albumIdInput,
        type: mediaTypeInput.optional(),
        cursor: mediaIdInput.optional(),
        take: z.coerce.number().int().min(1).max(60).default(30),
      }),
    )
    .query(async ({ input, ctx }) => {
      await requireAlbumAccess(ctx.user.id, input.albumId);
      const database = await requireDatabase();
      const rows = await database
        .select()
        .from(media)
        .where(
          and(
            eq(media.albumId, input.albumId),
            input.type ? eq(media.type, toDbMediaType(input.type)) : undefined,
            input.cursor ? lt(media.id, input.cursor) : undefined,
          ),
        )
        .orderBy(desc(media.id))
        .limit(input.take + 1);
      const hasMore = rows.length > input.take;
      const items = rows.slice(0, input.take);
      return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
    }),

  /**
   * P5: move media items to another album in the same family.
   * Caller must be a member of both albums' family; the uploader or a family
   * admin may move an item. Returns the number of rows moved.
   */
  moveMedia: protectedProcedure
    .input(
      z.object({
        ids: z.array(mediaIdInput).min(1).max(100),
        targetAlbumId: albumIdInput,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await requireAlbumAccess(ctx.user.id, input.targetAlbumId);
      const database = await requireDatabase();
      const rows = await database
        .select({ id: media.id, familyId: media.familyId, uploadedBy: media.uploadedBy, albumId: media.albumId })
        .from(media)
        .where(inArray(media.id, input.ids));
      if (rows.length !== input.ids.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Some media items were not found" });
      }
      const member = await requireFamilyMember(ctx.user.id, target.familyId);
      const isAdmin = member.role === "owner" || member.role === "admin";
      for (const row of rows) {
        if (row.familyId !== target.familyId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot move media across families" });
        }
        if (!isAdmin && row.uploadedBy !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the uploader or a family admin can move this item" });
        }
      }
      const toMove = rows.filter((r) => r.albumId !== input.targetAlbumId).map((r) => r.id);
      if (toMove.length === 0) return { moved: 0 };
      await database.update(media).set({ albumId: input.targetAlbumId }).where(inArray(media.id, toMove));
      return { moved: toMove.length };
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

  /**
   * Short-lived S3 GET URL for a media item (and its thumbnail). Access is
   * checked against family membership; legacy rows without a storageKey fall
   * back to the stored URL so old content keeps rendering.
   */
  getSignedUrl: protectedProcedure
    .input(z.object({ id: mediaIdInput }))
    .query(async ({ input, ctx }) => {
      const item = await requireMediaAccess(ctx.user.id, input.id);
      await assertUserRateLimit(ctx.user.id, "presign", USER_LIMITS.presign.limit, USER_LIMITS.presign.windowMs);
      const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000);
      if (!item.storageKey || !isStorageConfigured()) {
        return { url: item.url, thumbnailUrl: item.thumbnail ?? item.url, expiresAt, signed: false as const };
      }
      const [url, thumbnailUrl] = await Promise.all([
        storageGetSignedUrl(item.storageKey),
        item.thumbnailKey && item.thumbnailKey !== item.storageKey
          ? storageGetSignedUrl(item.thumbnailKey)
          : undefined,
      ]);
      return { url, thumbnailUrl: thumbnailUrl ?? url, expiresAt, signed: true as const };
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

  /** Uploader or family admin. Cascades likes + comments (P5). */
  deleteMedia: protectedProcedure
    .input(z.object({ id: mediaIdInput }))
    .mutation(async ({ input, ctx }) => {
      const item = await requireMediaAccess(ctx.user.id, input.id);
      if (item.uploadedBy !== ctx.user.id) {
        const member = await requireFamilyMember(ctx.user.id, item.familyId);
        if (member.role !== "owner" && member.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the uploader or a family admin can delete this item" });
        }
      }
      const database = await requireDatabase();
      await database.delete(likes).where(eq(likes.mediaId, input.id));
      await database.delete(comments).where(eq(comments.mediaId, input.id));
      await database.delete(media).where(eq(media.id, input.id));
      return { success: true };
    }),

  /** P5: batch delete with the same permission rules as deleteMedia. */
  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(mediaIdInput).min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database
        .select({ id: media.id, familyId: media.familyId, uploadedBy: media.uploadedBy })
        .from(media)
        .where(inArray(media.id, input.ids));
      const familyIds = [...new Set(rows.map((r) => r.familyId))];
      const adminIn = new Set<number>();
      for (const fid of familyIds) {
        const member = await requireFamilyMember(ctx.user.id, fid);
        if (member.role === "owner" || member.role === "admin") adminIn.add(fid);
      }
      const allowed = rows.filter((r) => r.uploadedBy === ctx.user.id || adminIn.has(r.familyId)).map((r) => r.id);
      if (allowed.length === 0) return { deleted: 0 };
      await database.delete(likes).where(inArray(likes.mediaId, allowed));
      await database.delete(comments).where(inArray(comments.mediaId, allowed));
      await database.delete(media).where(inArray(media.id, allowed));
      return { deleted: allowed.length, skipped: rows.length - allowed.length };
    }),
});

/**
 * Presigned PUT for `storageKey`. When Forge is not configured outside
 * production (local dev / CI) we return the proxy path so the flow stays
 * exercisable end-to-end without real object storage.
 */
async function presignUploadUrl(storageKey: string, contentType?: string): Promise<string> {
  if (isStorageConfigured()) {
    const { url } = await storagePresignPut(storageKey, contentType);
    return url;
  }
  if (ENV.isProduction) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage is not configured" });
  }
  return storageProxyPath(storageKey);
}

/** Ensure a client-provided key belongs to the album being written to. */
function assertOwnedKey(key: string, familyId: number, albumId: number): string {
  const parsed = parseStorageKey(key);
  if (
    !isValidStorageKey(key) ||
    parsed.kind !== "media" ||
    parsed.familyId !== familyId ||
    parsed.albumId !== albumId
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Storage key does not belong to this album" });
  }
  return key;
}
