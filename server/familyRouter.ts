import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { 
  createFamily,
  getFamilyById,
  getUserFamilies,
  addFamilyMember,
  getFamilyMembers,
  getLoveStoriesByFamily,
  createLoveStory,
  getAnniversariesByFamily,
  createAnniversary,
} from "./db";

export const familyRouter = router({
  // Family operations
  createFamily: protectedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createFamily({
        name: input.name,
        description: input.description,
        createdBy: ctx.user.id,
      });

      // Add creator as admin member
      await addFamilyMember({
        familyId: (result[0] as any).insertId || 1,
        userId: ctx.user.id,
        role: "admin",
      });

      return result;
    }),

  getFamily: protectedProcedure
    .input(z.object({
      familyId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getFamilyById(input.familyId);
    }),

  getUserFamilies: protectedProcedure
    .query(async ({ ctx }) => {
      return await getUserFamilies(ctx.user.id);
    }),

  // Family member operations
  addMember: protectedProcedure
    .input(z.object({
      familyId: z.number(),
      userId: z.number(),
      role: z.enum(["admin", "member", "viewer"]),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is admin of the family
      const members = await getFamilyMembers(input.familyId);
      const userMember = members.find(m => m.userId === ctx.user.id);
      
      if (!userMember || userMember.role !== "admin") {
        throw new Error("Not authorized to add members");
      }

      return await addFamilyMember({
        familyId: input.familyId,
        userId: input.userId,
        role: input.role,
      });
    }),

  getMembers: protectedProcedure
    .input(z.object({
      familyId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getFamilyMembers(input.familyId);
    }),

  // Love Story operations
  createLoveStory: protectedProcedure
    .input(z.object({
      familyId: z.number(),
      chapter: z.number(),
      year: z.number().optional(),
      title: z.string(),
      titleEn: z.string().optional(),
      description: z.string().optional(),
      voiceRecording: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is a member of the family
      const members = await getFamilyMembers(input.familyId);
      if (!members.some(m => m.userId === ctx.user.id)) {
        throw new Error("Not a member of this family");
      }

      return await createLoveStory({
        familyId: input.familyId,
        chapter: input.chapter,
        year: input.year,
        title: input.title,
        titleEn: input.titleEn,
        description: input.description,
        voiceRecording: input.voiceRecording,
        createdBy: ctx.user.id,
      });
    }),

  getLoveStories: protectedProcedure
    .input(z.object({
      familyId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getLoveStoriesByFamily(input.familyId);
    }),

  // Anniversary operations
  createAnniversary: protectedProcedure
    .input(z.object({
      familyId: z.number(),
      type: z.enum(["silver", "golden", "diamond", "platinum"]),
      date: z.date(),
      couple: z.string(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is a member of the family
      const members = await getFamilyMembers(input.familyId);
      if (!members.some(m => m.userId === ctx.user.id)) {
        throw new Error("Not a member of this family");
      }

      return await createAnniversary({
        familyId: input.familyId,
        type: input.type,
        date: input.date,
        couple: input.couple,
        description: input.description,
        createdBy: ctx.user.id,
      });
    }),

  getAnniversaries: protectedProcedure
    .input(z.object({
      familyId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getAnniversariesByFamily(input.familyId);
    }),
});
