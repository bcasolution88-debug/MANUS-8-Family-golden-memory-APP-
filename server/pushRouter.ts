/**
 * P10 — device registration for Expo Push.
 *
 *   register    {token, platform, deviceName?}  upsert; re-registering refreshes lastSeenAt and clears failedAt
 *   unregister  {token}                          on sign-out
 *   devices                                      my registered devices (Settings → 通知)
 *   test                                         send a test push to my own devices
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { NOTIFICATION_TYPES, PUSH_PLATFORMS, pushTokens } from "@/drizzle/schema";
import { recordMetric } from "@/server/_core/metrics";
import { bumpExperiment, copyExperimentEnabled, copyVariantFor, PUSH_COPY_EXPERIMENT, refreshExperiment } from "@/server/_core/pushDigest";
import { isExpoPushToken, isPushConfigured, pushToUsers } from "@/server/_core/push";
import { protectedProcedure, router } from "@/server/_core/trpc";
import { getDb } from "@/server/db";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

export const pushRouter = router({
  register: protectedProcedure
    .input(z.object({ token: z.string().min(10).max(255), platform: z.enum(PUSH_PLATFORMS), deviceName: z.string().trim().max(128).optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!isExpoPushToken(input.token)) throw new TRPCError({ code: "BAD_REQUEST", message: "Not an Expo push token" });
      const database = await requireDatabase();
      // A token belongs to exactly one device; if another account used it on this device, take it over.
      await database
        .insert(pushTokens)
        .values({ userId: ctx.user.id, token: input.token, platform: input.platform, deviceName: input.deviceName ?? null, lastSeenAt: new Date(), failedAt: null })
        .onDuplicateKeyUpdate({ set: { userId: ctx.user.id, platform: input.platform, deviceName: input.deviceName ?? null, lastSeenAt: new Date(), failedAt: null } });
      return { registered: true as const, pushConfigured: isPushConfigured() };
    }),

  unregister: protectedProcedure.input(z.object({ token: z.string().min(10).max(255) })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const result = await database.delete(pushTokens).where(and(eq(pushTokens.token, input.token), eq(pushTokens.userId, ctx.user.id)));
    return { removed: Number((result[0] as { affectedRows?: number }).affectedRows ?? 0) };
  }),

  devices: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDatabase();
    const rows = await database
      .select({ id: pushTokens.id, platform: pushTokens.platform, deviceName: pushTokens.deviceName, lastSeenAt: pushTokens.lastSeenAt, failedAt: pushTokens.failedAt, token: pushTokens.token })
      .from(pushTokens)
      .where(eq(pushTokens.userId, ctx.user.id))
      .orderBy(desc(pushTokens.lastSeenAt));
    return { devices: rows.map(({ token, ...r }) => ({ ...r, tokenSuffix: token.slice(-6) })), pushConfigured: isPushConfigured() };
  }),

  removeDevice: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    await database.delete(pushTokens).where(and(eq(pushTokens.id, input.id), eq(pushTokens.userId, ctx.user.id)));
    return { removed: true as const };
  }),

  /** P13: client reports a tapped notification → push_open metric tagged with the A/B variant. */
  opened: protectedProcedure
    .input(z.object({ type: z.enum([...NOTIFICATION_TYPES, "digest"]), variant: z.enum(["A", "B"]).optional() }))
    .mutation(({ input, ctx }) => {
      const variant = input.variant ?? copyVariantFor(ctx.user.id);
      recordMetric("push_open", true, { detail: `${variant}:${input.type}`, userId: ctx.user.id });
      if (input.type !== "digest") void bumpExperiment(variant === "B" ? "openB" : "openA");
      return { recorded: true as const, variant };
    }),

  /** P13: which copy variant this user sees. P14: + promoted winner / tallies. */
  experiment: protectedProcedure.query(async ({ ctx }) => {
    const r = await refreshExperiment();
    return { enabled: copyExperimentEnabled(), experiment: PUSH_COPY_EXPERIMENT, variant: copyVariantFor(ctx.user.id), winner: r.winner, stats: r.stats ? { sentA: r.stats.sentA, sentB: r.stats.sentB, openA: r.stats.openA, openB: r.stats.openB } : null };
  }),

  test: protectedProcedure.mutation(async ({ ctx }) => {
    return pushToUsers({ userIds: [ctx.user.id], type: "system", preview: "推送通道正常 · Push works 🎉", data: { route: "/settings" } });
  }),
});
