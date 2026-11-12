/**
 * P8 — per-user preferences backing the Settings page.
 *
 * Notification toggles are *enforced* in `createNotification` (server/notifications.ts),
 * `hideActivity` filters the user's like / comment events out of other members'
 * timelines, `defaultPrivateAlbums` pre-fills the album creation form.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { userPreferences, type UserPreferences } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { protectedProcedure, router } from "@/server/_core/trpc";

export const DEFAULT_PREFERENCES: Omit<UserPreferences, "userId" | "createdAt" | "updatedAt"> = {
  notifyEnabled: true,
  notifyComments: true,
  notifyLikes: true,
  notifyShares: true,
  notifyUploads: true,
  notifyAnniversaries: true,
  hideActivity: false,
  defaultPrivateAlbums: false,
  autoBackup: false,
  twoFactorEnabled: false,
  twoFactorChannel: "email",
  pushEnabled: true,
  backupIncludeMedia: false,
  quietStart: null,
  quietEnd: null,
  quietTz: null,
  pushMutedTypes: null,
  pushMutedFamilies: null,
  pushDigest: "off",
  pushDigestHour: 20,
  lastDigestAt: null,
  pushDigestSmart: false,
  pushDigestPerFamily: false,
  pushDigestHighlights: true,
};

export type PreferenceValues = typeof DEFAULT_PREFERENCES;

const preferencesInput = z.object({
  notifyEnabled: z.boolean().optional(),
  notifyComments: z.boolean().optional(),
  notifyLikes: z.boolean().optional(),
  notifyShares: z.boolean().optional(),
  notifyUploads: z.boolean().optional(),
  notifyAnniversaries: z.boolean().optional(),
  hideActivity: z.boolean().optional(),
  defaultPrivateAlbums: z.boolean().optional(),
  autoBackup: z.boolean().optional(),
  /** P10 */
  pushEnabled: z.boolean().optional(),
  backupIncludeMedia: z.boolean().optional(),
  /** P12: quiet hours (minutes since local midnight) + per-type / per-family push mutes. */
  quietStart: z.number().int().min(0).max(1439).nullable().optional(),
  quietEnd: z.number().int().min(0).max(1439).nullable().optional(),
  quietTz: z.string().max(64).nullable().optional(),
  pushMutedTypes: z.array(z.string().max(32)).max(20).nullable().optional(),
  pushMutedFamilies: z.array(z.number().int().positive()).max(50).nullable().optional(),
  /** P13: batch interaction pushes into a daily / weekly digest delivered at `pushDigestHour` (local). */
  pushDigest: z.enum(["off", "daily", "weekly"]).optional(),
  pushDigestHour: z.number().int().min(0).max(23).optional(),
  /** P14: smart delivery hour (learned from taps) + one digest per family. */
  pushDigestSmart: z.boolean().optional(),
  pushDigestPerFamily: z.boolean().optional(),
  pushDigestHighlights: z.boolean().optional(),
});

/** Read a user's preferences, falling back to defaults (no row yet). */
export async function getPreferences(userId: number): Promise<PreferenceValues> {
  const database = await getDb();
  if (!database) return DEFAULT_PREFERENCES;
  const rows = await database.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_PREFERENCES;
  const { userId: _u, createdAt: _c, updatedAt: _d, ...values } = row;
  return values;
}

export const preferencesRouter = router({
  get: protectedProcedure.query(({ ctx }) => getPreferences(ctx.user.id)),

  update: protectedProcedure.input(preferencesInput).mutation(async ({ input, ctx }) => {
    const database = await getDb();
    if (!database) throw new Error("Database not available");
    const current = await getPreferences(ctx.user.id);
    // JSON-encoded list columns (P12).
    const { pushMutedTypes, pushMutedFamilies, ...rest } = input;
    const next = {
      ...current,
      ...rest,
      ...(pushMutedTypes !== undefined ? { pushMutedTypes: pushMutedTypes ? JSON.stringify(pushMutedTypes) : null } : {}),
      ...(pushMutedFamilies !== undefined ? { pushMutedFamilies: pushMutedFamilies ? JSON.stringify(pushMutedFamilies) : null } : {}),
    };
    await database
      .insert(userPreferences)
      .values({ userId: ctx.user.id, ...next })
      .onDuplicateKeyUpdate({ set: next });
    return next;
  }),
});
