import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  NOTIFICATION_TYPES,
  familyMembers,
  media,
  notifications,
  userPreferences,
  users,
  type InsertNotification,
  type NotificationType,
} from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { pushToUsers } from "@/server/_core/push";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { DEFAULT_PREFERENCES, type PreferenceValues } from "@/server/preferencesRouter";

/* ------------------------------------------------------------------ */
/* P10 — Expo Push side-channel                                        */
/* ------------------------------------------------------------------ */

async function actorName(actorId: number | null | undefined): Promise<string | null> {
  if (!actorId) return null;
  try {
    const database = await requireDatabase();
    const [row] = await database.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1);
    return row?.name ?? null;
  } catch {
    return null;
  }
}

/** Fire-and-forget push for recipients who already passed the in-app preference gate. */
function pushAfterInsert(userIds: number[], input: Pick<NotifyInput, "type" | "actorId" | "preview" | "mediaId" | "albumId" | "familyId" | "commentId">) {
  if (userIds.length === 0 || process.env.PUSH_DISABLED === "1") return;
  void actorName(input.actorId)
    .then((name) =>
      pushToUsers({
        userIds,
        type: input.type,
        actorName: name,
        preview: input.preview,
        data: { mediaId: input.mediaId ?? undefined, albumId: input.albumId ?? undefined, familyId: input.familyId ?? undefined, commentId: input.commentId ?? undefined },
      }),
    )
    .catch((error) => console.error("[push] failed", error));
}

/* ------------------------------------------------------------------ */
/* P8 — per-recipient preference gating                                */
/* ------------------------------------------------------------------ */

/** Which preference switch governs each notification type. */
const TYPE_PREF: Partial<Record<NotificationType, keyof PreferenceValues>> = {
  like: "notifyLikes",
  comment: "notifyComments",
  reply: "notifyComments",
  share: "notifyShares",
  upload: "notifyUploads",
  anniversary: "notifyAnniversaries",
  // invite / member_joined / system always deliver
};

export function wantsNotification(prefs: PreferenceValues, type: NotificationType): boolean {
  if (!prefs.notifyEnabled) return type === "invite" || type === "system";
  const key = TYPE_PREF[type];
  return key ? Boolean(prefs[key]) : true;
}

/** Bulk-load preferences for a set of recipients (defaults when no row). */
async function loadPreferences(userIds: number[]): Promise<Map<number, PreferenceValues>> {
  const out = new Map<number, PreferenceValues>();
  if (userIds.length === 0) return out;
  const database = await requireDatabase();
  const rows = await database.select().from(userPreferences).where(inArray(userPreferences.userId, userIds));
  for (const id of userIds) out.set(id, DEFAULT_PREFERENCES);
  for (const r of rows) {
    const { userId, createdAt: _c, updatedAt: _u, ...values } = r;
    out.set(userId, values);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers (server-side side effects)                                  */
/* ------------------------------------------------------------------ */

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

type NotifyInput = Omit<InsertNotification, "id" | "createdAt" | "readAt">;

/**
 * Insert one notification. Swallows DB errors so a failing notification never
 * breaks the primary mutation (like / comment / upload …).
 */
export async function createNotification(input: NotifyInput): Promise<void> {
  // Never notify the actor about their own action.
  if (input.actorId && input.actorId === input.userId) return;
  try {
    const database = await requireDatabase();
    const prefs = (await loadPreferences([input.userId])).get(input.userId) ?? DEFAULT_PREFERENCES;
    if (!wantsNotification(prefs, input.type)) return;
    await database.insert(notifications).values(input);
    pushAfterInsert([input.userId], input);
  } catch (error) {
    console.error("[notifications] failed to create", error);
  }
}

/**
 * Fan-out to every member of a family except `excludeUserId` (usually the actor).
 */
export async function notifyFamily(
  familyId: number,
  input: Omit<NotifyInput, "userId" | "familyId">,
  excludeUserId?: number,
): Promise<void> {
  try {
    const database = await requireDatabase();
    const members = await database
      .select({ userId: familyMembers.userId })
      .from(familyMembers)
      .where(
        excludeUserId
          ? and(eq(familyMembers.familyId, familyId), ne(familyMembers.userId, excludeUserId))
          : eq(familyMembers.familyId, familyId),
      );
    if (members.length === 0) return;
    const prefs = await loadPreferences(members.map((m) => m.userId));
    const recipients = members.filter((m) => wantsNotification(prefs.get(m.userId) ?? DEFAULT_PREFERENCES, input.type));
    if (recipients.length === 0) return;
    await database.insert(notifications).values(
      recipients.map((m) => ({ ...input, userId: m.userId, familyId })),
    );
    pushAfterInsert(recipients.map((m) => m.userId), { ...input, familyId });
  } catch (error) {
    console.error("[notifications] failed to fan out", error);
  }
}

/** Notify the uploader of a media item (used by like / comment). */
export async function notifyMediaOwner(
  mediaId: number,
  actorId: number,
  type: Extract<NotificationType, "like" | "comment">,
  extra: Partial<Pick<NotifyInput, "commentId" | "preview">> = {},
): Promise<void> {
  try {
    const database = await requireDatabase();
    const rows = await database
      .select({ uploadedBy: media.uploadedBy, familyId: media.familyId })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1);
    const item = rows[0];
    if (!item) return;
    await createNotification({
      userId: item.uploadedBy,
      familyId: item.familyId,
      actorId,
      type,
      mediaId,
      ...extra,
    });
  } catch (error) {
    console.error("[notifications] failed to notify media owner", error);
  }
}

/* ------------------------------------------------------------------ */
/* tRPC router                                                         */
/* ------------------------------------------------------------------ */

const idInput = z.coerce.number().int().positive();

export const notificationRouter = router({
  /** Paginated feed for the Messages tab, newest first, joined with actor profile. */
  list: protectedProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        type: z.enum(NOTIFICATION_TYPES).optional(),
        cursor: idInput.optional(), // last seen id for keyset pagination
        take: z.coerce.number().int().min(1).max(100).default(30),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const conditions = [eq(notifications.userId, ctx.user.id)];
      if (input.unreadOnly) conditions.push(isNull(notifications.readAt));
      if (input.type) conditions.push(eq(notifications.type, input.type));
      if (input.cursor) conditions.push(sql`${notifications.id} < ${input.cursor}`);

      const rows = await database
        .select({
          notification: notifications,
          actor: { id: users.id, name: users.name, avatar: users.avatar },
        })
        .from(notifications)
        .leftJoin(users, eq(notifications.actorId, users.id))
        .where(and(...conditions))
        .orderBy(desc(notifications.id))
        .limit(input.take + 1);

      const hasMore = rows.length > input.take;
      const items = rows.slice(0, input.take).map((r) => ({ ...r.notification, actor: r.actor?.id ? r.actor : null }));
      return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
    }),

  /** Badge counts for the Tab bar (total + per-type). */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDatabase();
    const rows = await database
      .select({ type: notifications.type, count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)))
      .groupBy(notifications.type);
    const byType = Object.fromEntries(rows.map((r) => [r.type, Number(r.count)])) as Partial<
      Record<NotificationType, number>
    >;
    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
    return {
      total,
      comments: (byType.comment ?? 0) + (byType.reply ?? 0),
      likes: byType.like ?? 0,
      mentions: 0,
      messages: total - (byType.comment ?? 0) - (byType.reply ?? 0) - (byType.like ?? 0),
      byType,
    };
  }),

  markRead: protectedProcedure
    .input(z.object({ ids: z.array(idInput).min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      await database
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, ctx.user.id),
            inArray(notifications.id, input.ids),
            isNull(notifications.readAt),
          ),
        );
      return { success: true };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const database = await requireDatabase();
    await database
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { success: true };
  }),

  delete: protectedProcedure
    .input(z.object({ id: idInput }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      await database
        .delete(notifications)
        .where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)));
      return { success: true };
    }),
});
