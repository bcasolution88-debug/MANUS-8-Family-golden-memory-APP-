import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
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
  getFamilyMembers,
} from "./db";

export const albumRouter = router({
  // Album operations
  createAlbum: protectedProcedure
    .input(z.object({
      familyId: z.number(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is a member of the family
      const members = await getFamilyMembers(input.familyId);
      if (!members.some(m => m.userId === ctx.user.id)) {
        throw new Error("Not a member of this family");
      }

      return await createAlbum({
        familyId: input.familyId,
        name: input.name,
        description: input.description,
        category: input.category,
        createdBy: ctx.user.id,
        isPrivate: false,
      });
    }),

  listAlbums: protectedProcedure
    .input(z.object({
      familyId: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      // Verify user is a member of the family
      const members = await getFamilyMembers(input.familyId);
      if (!members.some(m => m.userId === ctx.user.id)) {
        throw new Error("Not a member of this family");
      }

      return await getAlbumsByFamily(input.familyId);
    }),

  getAlbum: protectedProcedure
    .input(z.object({
      albumId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getAlbumById(input.albumId);
    }),

  // Media operations
  uploadMedia: protectedProcedure
    .input(z.object({
      albumId: z.number(),
      familyId: z.number(),
      type: z.enum(["photo", "video"]),
      url: z.string(),
      thumbnail: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      duration: z.number().optional(),
      fileSize: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is a member of the family
      const members = await getFamilyMembers(input.familyId);
      if (!members.some(m => m.userId === ctx.user.id)) {
        throw new Error("Not a member of this family");
      }

      return await uploadMedia({
        albumId: input.albumId,
        familyId: input.familyId,
        uploadedBy: ctx.user.id,
        type: input.type,
        url: input.url,
        thumbnail: input.thumbnail,
        title: input.title,
        description: input.description,
        duration: input.duration,
        fileSize: input.fileSize,
      });
    }),

  getMediaByAlbum: protectedProcedure
    .input(z.object({
      albumId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getMediaByAlbum(input.albumId);
    }),

  // Like operations
  addLike: protectedProcedure
    .input(z.object({
      mediaId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await addLike({
        mediaId: input.mediaId,
        userId: ctx.user.id,
      });
      return { success: true };
    }),

  removeLike: protectedProcedure
    .input(z.object({
      mediaId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await removeLike(input.mediaId, ctx.user.id);
      return { success: true };
    }),

  getLikes: protectedProcedure
    .input(z.object({
      mediaId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getLikesByMedia(input.mediaId);
    }),

  // Comment operations
  addComment: protectedProcedure
    .input(z.object({
      mediaId: z.number(),
      content: z.string(),
      rating: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return await addComment({
        mediaId: input.mediaId,
        userId: ctx.user.id,
        content: input.content,
        rating: input.rating,
      });
    }),

  getComments: protectedProcedure
    .input(z.object({
      mediaId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getCommentsByMedia(input.mediaId);
    }),

  deleteComment: protectedProcedure
    .input(z.object({
      commentId: z.number(),
      mediaId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is the comment author
      const comments = await getCommentsByMedia(input.mediaId);
      const comment = comments.find(c => c.id === input.commentId);
      
      if (!comment || comment.userId !== ctx.user.id) {
        throw new Error("Not authorized to delete this comment");
      }

      await deleteComment(input.commentId, input.mediaId);
      return { success: true };
    }),
});
