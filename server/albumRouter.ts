import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import {
  requireAlbumAccess,
  requireFamilyMember,
  requireMediaAccess,
  requireMediaBelongsToAlbum,
} from "./_core/authorization";
import {
  createAlbum,
  getAlbumsByFamily,
  getAlbumById,
  uploadMedia,
  getMediaByAlbum,
  addLike,
  removeLike,
  getLikesByMedia,
  addComment,
  getCommentsByMedia,
  deleteComment,
} from "./db";

export const albumRouter = router({
  createAlbum: protectedProcedure
    .input(
      z.object({
        familyId: z.number().int().positive(),
        name: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
        category: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return createAlbum({
        ...input,
        createdBy: ctx.user.id,
        isPrivate: false,
      });
    }),

  listAlbums: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return getAlbumsByFamily(input.familyId);
    }),

  getAlbum: protectedProcedure
    .input(z.object({ albumId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireAlbumAccess(ctx.user.id, input.albumId);
      return getAlbumById(input.albumId);
    }),

  uploadMedia: protectedProcedure
    .input(
      z.object({
        albumId: z.number().int().positive(),
        familyId: z.number().int().positive(),
        type: z.enum(["photo", "video"]),
        url: z.string().url(),
        thumbnail: z.string().url().optional(),
        title: z.string().max(255).optional(),
        description: z.string().max(20000).optional(),
        duration: z.number().int().nonnegative().optional(),
        fileSize: z
          .number()
          .int()
          .nonnegative()
          .max(1024 * 1024 * 1024)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const album = await requireAlbumAccess(ctx.user.id, input.albumId);
      if (album.familyId !== input.familyId)
        throw new Error("Family does not match album");
      return uploadMedia({ ...input, uploadedBy: ctx.user.id });
    }),

  getMediaByAlbum: protectedProcedure
    .input(z.object({ albumId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireAlbumAccess(ctx.user.id, input.albumId);
      return getMediaByAlbum(input.albumId);
    }),

  addLike: protectedProcedure
    .input(z.object({ mediaId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      await addLike({ mediaId: input.mediaId, userId: ctx.user.id });
      return { success: true };
    }),

  removeLike: protectedProcedure
    .input(z.object({ mediaId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      await removeLike(input.mediaId, ctx.user.id);
      return { success: true };
    }),

  getLikes: protectedProcedure
    .input(z.object({ mediaId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      return getLikesByMedia(input.mediaId);
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        mediaId: z.number().int().positive(),
        content: z.string().min(1).max(10000),
        rating: z.number().int().min(1).max(5).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      return addComment({ ...input, userId: ctx.user.id });
    }),

  getComments: protectedProcedure
    .input(z.object({ mediaId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      return getCommentsByMedia(input.mediaId);
    }),

  deleteComment: protectedProcedure
    .input(
      z.object({
        commentId: z.number().int().positive(),
        mediaId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireMediaAccess(ctx.user.id, input.mediaId);
      const comment = (await getCommentsByMedia(input.mediaId)).find(
        (item) => item.id === input.commentId,
      );
      if (!comment || comment.userId !== ctx.user.id)
        throw new Error("Not authorized to delete this comment");
      await deleteComment(input.commentId, input.mediaId);
      return { success: true };
    }),
});
