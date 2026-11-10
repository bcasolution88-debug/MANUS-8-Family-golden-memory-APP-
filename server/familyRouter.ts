import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { requireFamilyAdmin, requireFamilyMember } from "./_core/authorization";
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
  createFamily: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await createFamily({
        name: input.name,
        description: input.description,
        createdBy: ctx.user.id,
      });
      await addFamilyMember({
        familyId: Number((result[0] as any).insertId),
        userId: ctx.user.id,
        role: "admin",
      });
      return result;
    }),

  getFamily: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return getFamilyById(input.familyId);
    }),

  getUserFamilies: protectedProcedure.query(({ ctx }) =>
    getUserFamilies(ctx.user.id),
  ),

  addMember: protectedProcedure
    .input(
      z.object({
        familyId: z.number().int().positive(),
        userId: z.number().int().positive(),
        role: z.enum(["admin", "member", "viewer"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyAdmin(ctx.user.id, input.familyId);
      return addFamilyMember(input);
    }),

  getMembers: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return getFamilyMembers(input.familyId);
    }),

  createLoveStory: protectedProcedure
    .input(
      z.object({
        familyId: z.number().int().positive(),
        chapter: z.number().int(),
        year: z.number().int().optional(),
        title: z.string().min(1).max(255),
        titleEn: z.string().max(255).optional(),
        description: z.string().max(20000).optional(),
        voiceRecording: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return createLoveStory({ ...input, createdBy: ctx.user.id });
    }),

  getLoveStories: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return getLoveStoriesByFamily(input.familyId);
    }),

  createAnniversary: protectedProcedure
    .input(
      z.object({
        familyId: z.number().int().positive(),
        type: z.enum(["silver", "golden", "diamond", "platinum"]),
        date: z.date(),
        couple: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return createAnniversary({ ...input, createdBy: ctx.user.id });
    }),

  getAnniversaries: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return getAnniversariesByFamily(input.familyId);
    }),
});
