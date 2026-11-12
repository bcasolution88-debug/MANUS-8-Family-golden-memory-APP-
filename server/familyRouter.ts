import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { requireFamilyAdmin, requireFamilyEditor, requireFamilyMember } from "./_core/authorization";
import { FAMILY_ROLES, anniversaries, families, invitations, loveStories, users } from "@/drizzle/schema";
import { createNotification, notifyFamily } from "./notifications";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  createFamily,
  getFamilyById,
  getUserFamilies,
  addFamilyMember,
  getFamilyMembers,
  updateFamilyMemberRole,
  removeFamilyMember,
  getLoveStoriesByFamily,
  createLoveStory,
  getAnniversariesByFamily,
  createAnniversary,
} from "./db";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const familyRouter = router({
  /** P6: rename / re-describe a family (owner | admin). */
  updateFamily: protectedProcedure
    .input(
      z.object({
        familyId: z.number().int().positive(),
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyAdmin(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      await database
        .update(families)
        .set({ name: input.name, description: input.description === undefined ? undefined : input.description })
        .where(eq(families.id, input.familyId));
      return getFamilyById(input.familyId);
    }),

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
      const familyId = Number((result[0] as any).insertId);
      await addFamilyMember({ familyId, userId: ctx.user.id, role: "owner" });
      // P6: return the created row so clients can switch to it immediately.
      return getFamilyById(familyId);
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
        // owner is assigned only via createFamily; admins may grant admin/editor/viewer.
        role: z.enum(FAMILY_ROLES.filter((r) => r !== "owner") as [Exclude<(typeof FAMILY_ROLES)[number], "owner">, ...Exclude<(typeof FAMILY_ROLES)[number], "owner">[]]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyAdmin(ctx.user.id, input.familyId);
      const result = await addFamilyMember(input);
      await createNotification({
        userId: input.userId,
        familyId: input.familyId,
        actorId: ctx.user.id,
        type: "invite",
      });
      await notifyFamily(input.familyId, { actorId: input.userId, type: "member_joined" }, input.userId);
      return result;
    }),

  /* ------------------------------ invitations (P6) ------------------------------ */

  /** Email invite with a one-time code (7 days). Existing users are added directly. */
  inviteByEmail: protectedProcedure
    .input(
      z.object({
        familyId: z.number().int().positive(),
        email: z.string().trim().email().max(320),
        role: z.enum(["admin", "editor", "viewer"]).default("editor"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyAdmin(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const email = input.email.toLowerCase();

      // Already a user? Add immediately (same as addMember) and notify.
      const existing = await database.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing[0]) {
        const members = await getFamilyMembers(input.familyId);
        if (members.some((m) => m.userId === existing[0].id)) {
          throw new TRPCError({ code: "CONFLICT", message: "This person is already a member" });
        }
        await addFamilyMember({ familyId: input.familyId, userId: existing[0].id, role: input.role });
        await createNotification({ userId: existing[0].id, familyId: input.familyId, actorId: ctx.user.id, type: "invite" });
        await notifyFamily(input.familyId, { actorId: existing[0].id, type: "member_joined" }, existing[0].id);
        return { status: "added" as const, userId: existing[0].id };
      }

      // Otherwise create / refresh a pending invitation.
      const pending = await database
        .select()
        .from(invitations)
        .where(and(eq(invitations.familyId, input.familyId), eq(invitations.invitedEmail, email), eq(invitations.status, "pending")))
        .limit(1);
      const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      if (pending[0]) {
        await database.update(invitations).set({ invitationCode: code, expiresAt, invitedBy: ctx.user.id }).where(eq(invitations.id, pending[0].id));
        return { status: "pending" as const, invitationId: pending[0].id, code, expiresAt };
      }
      const inserted = await database.insert(invitations).values({
        familyId: input.familyId,
        invitedEmail: email,
        invitedBy: ctx.user.id,
        invitationCode: code,
        expiresAt,
      });
      return { status: "pending" as const, invitationId: Number(inserted[0].insertId), code, expiresAt };
    }),

  listInvitations: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      return database
        .select()
        .from(invitations)
        .where(and(eq(invitations.familyId, input.familyId), eq(invitations.status, "pending")))
        .orderBy(desc(invitations.createdAt));
    }),

  revokeInvitation: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database.select().from(invitations).where(eq(invitations.id, input.id)).limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found" });
      await requireFamilyAdmin(ctx.user.id, rows[0].familyId);
      await database.update(invitations).set({ status: "declined" }).where(eq(invitations.id, input.id));
      return { success: true };
    }),

  /**
   * P7: look up an invitation code before joining (deep link `/join?code=`).
   * Returns the family name + inviter so the join sheet can show context.
   */
  previewInvitation: protectedProcedure
    .input(z.object({ code: z.string().trim().min(6).max(64) }))
    .query(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database
        .select({ invite: invitations, family: families, inviter: { id: users.id, name: users.name, avatar: users.avatar } })
        .from(invitations)
        .innerJoin(families, eq(families.id, invitations.familyId))
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .where(eq(invitations.invitationCode, input.code.toUpperCase()))
        .limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invitation code" });
      const expired = !!row.invite.expiresAt && row.invite.expiresAt.getTime() < Date.now();
      const members = await getFamilyMembers(row.invite.familyId);
      return {
        code: row.invite.invitationCode!,
        status: row.invite.status,
        expired,
        expiresAt: row.invite.expiresAt,
        family: { id: row.family.id, name: row.family.name, description: row.family.description, memberCount: members.length },
        inviter: row.inviter?.id ? row.inviter : null,
        alreadyMember: members.some((m) => m.userId === ctx.user.id),
      };
    }),

  /** Redeem an invitation code as the signed-in user. */
  acceptInvitation: protectedProcedure
    .input(z.object({ code: z.string().trim().min(6).max(64) }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database
        .select()
        .from(invitations)
        .where(and(eq(invitations.invitationCode, input.code.toUpperCase()), eq(invitations.status, "pending")))
        .limit(1);
      const invite = rows[0];
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or used invitation code" });
      if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Invitation has expired" });
      }
      const members = await getFamilyMembers(invite.familyId);
      if (!members.some((m) => m.userId === ctx.user.id)) {
        await addFamilyMember({ familyId: invite.familyId, userId: ctx.user.id, role: "editor" });
        await notifyFamily(invite.familyId, { actorId: ctx.user.id, type: "member_joined" }, ctx.user.id);
      }
      await database.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, invite.id));
      return { familyId: invite.familyId };
    }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        familyId: z.number().int().positive(),
        userId: z.number().int().positive(),
        role: z.enum(["admin", "editor", "viewer"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireFamilyAdmin(ctx.user.id, input.familyId);
      const target = (await getFamilyMembers(input.familyId)).find((m) => m.userId === input.userId);
      if (!target) throw new Error("Member not found");
      if (target.role === "owner") throw new Error("Owner role cannot be changed");
      return updateFamilyMemberRole(input.familyId, input.userId, input.role);
    }),

  removeMember: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive(), userId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const actor = await requireFamilyMember(ctx.user.id, input.familyId);
      const target = (await getFamilyMembers(input.familyId)).find((m) => m.userId === input.userId);
      if (!target) throw new Error("Member not found");
      if (target.role === "owner") throw new Error("Owner cannot be removed");
      const isSelf = input.userId === ctx.user.id;
      if (!isSelf && actor.role !== "owner" && actor.role !== "admin")
        throw new Error("Family administrator permission required");
      await removeFamilyMember(input.familyId, input.userId);
      return { success: true };
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
      await requireFamilyEditor(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const result = await createLoveStory({ ...input, createdBy: ctx.user.id });
      const id = Number((result[0] as any).insertId);
      return (await database.select().from(loveStories).where(eq(loveStories.id, id)).limit(1))[0]!;
    }),

  getLoveStories: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return getLoveStoriesByFamily(input.familyId);
    }),

  /** P6: edit a chapter (creator or family admin). */
  updateLoveStory: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        chapter: z.number().int().optional(),
        year: z.number().int().nullable().optional(),
        title: z.string().min(1).max(255).optional(),
        titleEn: z.string().max(255).nullable().optional(),
        description: z.string().max(20000).nullable().optional(),
        voiceRecording: z.string().url().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database.select().from(loveStories).where(eq(loveStories.id, input.id)).limit(1);
      const story = rows[0];
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });
      const member = await requireFamilyMember(ctx.user.id, story.familyId);
      if (story.createdBy !== ctx.user.id && member.role !== "owner" && member.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author or a family admin can edit this chapter" });
      }
      const { id, ...patch } = input;
      await database.update(loveStories).set(patch).where(eq(loveStories.id, id));
      return (await database.select().from(loveStories).where(eq(loveStories.id, id)).limit(1))[0];
    }),

  deleteLoveStory: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database.select().from(loveStories).where(eq(loveStories.id, input.id)).limit(1);
      const story = rows[0];
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story not found" });
      const member = await requireFamilyMember(ctx.user.id, story.familyId);
      if (story.createdBy !== ctx.user.id && member.role !== "owner" && member.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author or a family admin can delete this chapter" });
      }
      await database.delete(loveStories).where(eq(loveStories.id, input.id));
      return { success: true };
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
      await requireFamilyEditor(ctx.user.id, input.familyId);
      const database = await requireDatabase();
      const result = await createAnniversary({ ...input, createdBy: ctx.user.id });
      await notifyFamily(
        input.familyId,
        { actorId: ctx.user.id, type: "anniversary", preview: input.couple },
        ctx.user.id,
      );
      const id = Number((result[0] as any).insertId);
      return (await database.select().from(anniversaries).where(eq(anniversaries.id, id)).limit(1))[0]!;
    }),

  getAnniversaries: protectedProcedure
    .input(z.object({ familyId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await requireFamilyMember(ctx.user.id, input.familyId);
      return getAnniversariesByFamily(input.familyId);
    }),

  /** P6: edit / delete an anniversary (creator or family admin). */
  updateAnniversary: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        type: z.enum(["silver", "golden", "diamond", "platinum"]).optional(),
        date: z.date().optional(),
        couple: z.string().min(1).max(255).optional(),
        description: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database.select().from(anniversaries).where(eq(anniversaries.id, input.id)).limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Anniversary not found" });
      const member = await requireFamilyMember(ctx.user.id, row.familyId);
      if (row.createdBy !== ctx.user.id && member.role !== "owner" && member.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the creator or a family admin can edit this" });
      }
      const { id, ...patch } = input;
      await database.update(anniversaries).set(patch).where(eq(anniversaries.id, id));
      return (await database.select().from(anniversaries).where(eq(anniversaries.id, id)).limit(1))[0];
    }),

  deleteAnniversary: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const rows = await database.select().from(anniversaries).where(eq(anniversaries.id, input.id)).limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Anniversary not found" });
      const member = await requireFamilyMember(ctx.user.id, row.familyId);
      if (row.createdBy !== ctx.user.id && member.role !== "owner" && member.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the creator or a family admin can delete this" });
      }
      await database.delete(anniversaries).where(eq(anniversaries.id, input.id));
      return { success: true };
    }),
});
