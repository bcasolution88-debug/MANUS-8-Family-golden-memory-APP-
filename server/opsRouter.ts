/**
 * P10 — operations diagnostics (admin only). Lets the deployer verify
 * production channels from the app instead of tailing logs.
 *
 *   channels     mail transport + Resend domain status, SMS transport, push, Redis, scheduler leadership
 *   testMail     send a real test email to the admin's own address
 *   testSms      send a real test SMS to the admin's verified phone
 *   P12: metrics / evaluateAlerts · P13: alertRules / setAlertRule / silenceAlert / alertChannels CRUD + test
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { ALERT_CHANNEL_KINDS, alertChannels, alertRules, users } from "@/drizzle/schema";
import { ALERT_CHANNEL_LABELS, sendToChannel, validateChannelUrl } from "@/server/_core/alertChannels";
import { ackIncident, addIncidentNote, ESCALATE_AFTER_MIN, listIncidents, MAX_TIER } from "@/server/_core/alertIncidents";
import { listHandovers, loadShifts, manualHandover, onDutyFor, rosterPreview } from "@/server/_core/onCall";
import { onCallShifts } from "@/drizzle/schema";
import { listOrphanScans, ORPHAN_MIN_AGE_HOURS, purgeOrphans, scanOrphans } from "@/server/storageOrphans";
import { sealSecret } from "@/server/_core/webdav";
import { isMailConfigured, mailDiagnostics, sendMail } from "@/server/_core/mailer";
import { isPushConfigured } from "@/server/_core/push";
import { rateLimitBackend } from "@/server/_core/rateLimit";
import { isSmsConfigured, maskPhone, sendSms, smsTransportName } from "@/server/_core/sms";
import { coordinatorStatus } from "@/server/_core/coordination";
import { ALERT_MIN_RATE, ALERT_MIN_SAMPLES, ALERT_WINDOW_HOURS, evaluateAlerts, loadRules, metricSeries, metricSummary, pushOpenBreakdown } from "@/server/_core/metrics";
import { AB_MIN_LIFT, AB_MIN_SENT_PER_ARM, copyExperimentEnabled, refreshExperiment, resetExperiment } from "@/server/_core/pushDigest";
import { METRIC_KINDS } from "@/drizzle/schema";
import { adminProcedure, router } from "@/server/_core/trpc";
import { getDb } from "@/server/db";
import { __queueState } from "@/server/studioRouter";

export const opsRouter = router({
  /** P12: per-kind success rate + hourly series for the dashboard charts. */
  metrics: adminProcedure.input(z.object({ hours: z.number().int().min(1).max(24 * 14).default(24) }).optional()).query(async ({ input }) => {
    const hours = input?.hours ?? 24;
    const summary = await metricSummary(hours);
    const series = Object.fromEntries(await Promise.all(METRIC_KINDS.map(async (k) => [k, await metricSeries(k, hours)] as const)));
    const ab = await pushOpenBreakdown(hours);
    const exp = await refreshExperiment();
    return { hours, summary, series, alert: { minRate: ALERT_MIN_RATE, minSamples: ALERT_MIN_SAMPLES, windowHours: ALERT_WINDOW_HOURS }, ab: { enabled: copyExperimentEnabled(), ...ab, winner: exp.winner, stats: exp.stats ? { sentA: exp.stats.sentA, sentB: exp.stats.sentB, openA: exp.stats.openA, openB: exp.stats.openB } : null, minSentPerArm: AB_MIN_SENT_PER_ARM, minLift: AB_MIN_LIFT } };
  }),

  /* ---------------------------------------------------------------- */
  /* P13 — alert rules (per kind) + channels                            */
  /* ---------------------------------------------------------------- */

  /** Effective rule per metric kind (env defaults unless overridden). */
  alertRules: adminProcedure.query(() => loadRules()),

  /** Override one kind's thresholds; `reset` drops the override. */
  setAlertRule: adminProcedure
    .input(
      z.object({
        kind: z.enum(METRIC_KINDS),
        reset: z.boolean().optional(),
        enabled: z.boolean().optional(),
        minRatePct: z.number().int().min(0).max(100).optional(),
        minSamples: z.number().int().min(1).max(10_000).optional(),
        windowHours: z.number().int().min(1).max(24 * 14).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.reset) {
        await database.delete(alertRules).where(eq(alertRules.kind, input.kind));
        return (await loadRules()).find((r) => r.kind === input.kind)!;
      }
      const current = (await loadRules()).find((r) => r.kind === input.kind)!;
      const row = {
        kind: input.kind,
        enabled: input.enabled ?? current.enabled,
        minRatePct: input.minRatePct ?? Math.round(current.minRate * 100),
        minSamples: input.minSamples ?? current.minSamples,
        windowHours: input.windowHours ?? current.windowHours,
        silencedUntil: current.silencedUntil,
        updatedBy: ctx.user.id,
      };
      await database.insert(alertRules).values(row).onDuplicateKeyUpdate({ set: row });
      return (await loadRules()).find((r) => r.kind === input.kind)!;
    }),

  /** Silence a kind for N minutes (0 = unsilence). */
  silenceAlert: adminProcedure.input(z.object({ kind: z.enum(METRIC_KINDS), minutes: z.number().int().min(0).max(60 * 24 * 14) })).mutation(async ({ input, ctx }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const current = (await loadRules()).find((r) => r.kind === input.kind)!;
    const silencedUntil = input.minutes > 0 ? new Date(Date.now() + input.minutes * 60_000) : null;
    const row = { kind: input.kind, enabled: current.enabled, minRatePct: Math.round(current.minRate * 100), minSamples: current.minSamples, windowHours: current.windowHours, silencedUntil, updatedBy: ctx.user.id };
    await database.insert(alertRules).values(row).onDuplicateKeyUpdate({ set: { silencedUntil, updatedBy: ctx.user.id } });
    return { kind: input.kind, silencedUntil };
  }),

  /** P14: clear the copy experiment (winner + tallies) to start a new round. */
  resetCopyExperiment: adminProcedure.mutation(async () => {
    await resetExperiment();
    return { reset: true as const };
  }),

  /* P14: incidents — escalation chain + ack + timeline */
  incidents: adminProcedure.input(z.object({ status: z.enum(["open", "acked", "resolved", "active"]).optional(), take: z.number().int().min(1).max(100).default(30) }).optional()).query(async ({ input }) => ({
    incidents: await listIncidents({ status: input?.status, take: input?.take }),
    escalateAfterMin: ESCALATE_AFTER_MIN,
    maxTier: MAX_TIER,
  })),
  ackIncident: adminProcedure.input(z.object({ id: z.number().int().positive(), note: z.string().trim().max(300).optional() })).mutation(async ({ input, ctx }) => {
    try {
      const inc = await ackIncident(input.id, ctx.user.id, input.note ?? null);
      return { ok: true as const, status: inc.status, ackedAt: inc.ackedAt };
    } catch (e) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: e instanceof Error ? e.message : "ack failed" });
    }
  }),
  incidentNote: adminProcedure.input(z.object({ id: z.number().int().positive(), note: z.string().trim().min(1).max(300) })).mutation(async ({ input, ctx }) => {
    await addIncidentNote(input.id, ctx.user.id, input.note);
    return { ok: true as const };
  }),

  /* P15 — on-call roster & rotation */
  onCall: adminProcedure.query(async () => {
    const database = await getDb();
    const shifts = await loadShifts();
    const userIds = [...new Set(shifts.map((s) => s.userId))];
    const admins = database ? await database.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.role, "admin")) : [];
    const now = new Date();
    const duty = await Promise.all([1, 2, 3].map(async (tier) => ({ tier, ...((await onDutyFor(tier, now)) ?? { userId: null, shiftId: null, fallback: false }) })));
    const roster = [1, 2, 3].map((tier) => ({ tier, segments: rosterPreview(shifts, tier, now, 24 * 7, 1) }));
    return {
      shifts,
      admins: admins.map((a) => ({ id: a.id, name: a.name, email: a.email, smsReady: !!(a.phone && a.phoneVerifiedAt) })),
      knownUserIds: userIds,
      duty,
      roster,
      handovers: await listHandovers(20),
      maxTier: MAX_TIER,
    };
  }),
  addShift: adminProcedure
    .input(
      z
        .object({
          userId: z.number().int().positive(),
          kind: z.enum(["weekly", "range"]).default("weekly"),
          weekday: z.number().int().min(0).max(6).optional(),
          startHour: z.number().int().min(0).max(24).default(0),
          endHour: z.number().int().min(0).max(24).default(24),
          tz: z.string().max(64).default("Asia/Shanghai"),
          startsAt: z.coerce.date().optional(),
          endsAt: z.coerce.date().optional(),
          order: z.number().int().min(-10).max(100).default(0),
          tier: z.number().int().min(1).max(MAX_TIER).default(1),
          note: z.string().trim().max(200).optional(),
        })
        .refine((v) => (v.kind === "weekly" ? v.weekday != null : !!v.startsAt && !!v.endsAt && v.endsAt > v.startsAt), { message: "weekly needs weekday · range needs startsAt < endsAt" }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [u] = await database.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!u || u.role !== "admin") throw new TRPCError({ code: "BAD_REQUEST", message: "On-call person must be an admin" });
      const ins = await database.insert(onCallShifts).values({ ...input, weekday: input.kind === "weekly" ? input.weekday! : null, startsAt: input.kind === "range" ? input.startsAt! : null, endsAt: input.kind === "range" ? input.endsAt! : null, createdBy: ctx.user.id });
      return { id: Number(ins[0].insertId) };
    }),
  updateShift: adminProcedure.input(z.object({ id: z.number().int().positive(), enabled: z.boolean().optional(), order: z.number().int().min(-10).max(100).optional(), tier: z.number().int().min(1).max(MAX_TIER).optional(), note: z.string().trim().max(200).nullable().optional() })).mutation(async ({ input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const { id, ...patch } = input;
    const [row] = await database.select({ id: onCallShifts.id }).from(onCallShifts).where(eq(onCallShifts.id, id)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await database.update(onCallShifts).set(patch).where(eq(onCallShifts.id, id));
    return { ok: true as const };
  }),
  removeShift: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await database.delete(onCallShifts).where(eq(onCallShifts.id, input.id));
    return { ok: true as const };
  }),
  handover: adminProcedure.input(z.object({ toUserId: z.number().int().positive(), tier: z.number().int().min(1).max(MAX_TIER).default(1), note: z.string().trim().max(300).optional() })).mutation(async ({ input, ctx }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [u] = await database.select({ role: users.role }).from(users).where(eq(users.id, input.toUserId)).limit(1);
    if (!u || u.role !== "admin") throw new TRPCError({ code: "BAD_REQUEST", message: "Hand over to an admin" });
    const id = await manualHandover({ by: ctx.user.id, toUserId: input.toUserId, tier: input.tier, note: input.note ?? null });
    return { id };
  }),

  /* P15 — object-storage orphan sweep */
  orphanScans: adminProcedure.input(z.object({ take: z.number().int().min(1).max(50).default(10) }).optional()).query(async ({ input }) => ({ scans: await listOrphanScans(input?.take ?? 10), minAgeHours: ORPHAN_MIN_AGE_HOURS })),
  scanOrphans: adminProcedure.input(z.object({ familyId: z.number().int().positive().optional() }).optional()).mutation(async ({ input, ctx }) => scanOrphans({ familyId: input?.familyId ?? null, by: ctx.user.id })),
  purgeOrphans: adminProcedure.input(z.object({ scanId: z.number().int().positive(), keys: z.array(z.string().max(512)).max(5000).optional() })).mutation(async ({ input }) => {
    try {
      return await purgeOrphans(input.scanId, { keys: input.keys ?? null });
    } catch (e) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: e instanceof Error ? e.message : "purge failed" });
    }
  }),

  /** Alert destinations (URLs never returned — only host + kind). */
  alertChannels: adminProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { channels: [], kinds: ALERT_CHANNEL_KINDS.map((k) => ({ kind: k, ...ALERT_CHANNEL_LABELS[k] })) };
    const rows = await database.select().from(alertChannels).orderBy(alertChannels.id);
    return {
      channels: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, enabled: r.enabled, tier: r.tier, hasSecret: !!r.secretEnc, lastStatus: r.lastStatus, lastError: r.lastError, lastSentAt: r.lastSentAt, createdAt: r.createdAt })),
      kinds: ALERT_CHANNEL_KINDS.map((k) => ({ kind: k, ...ALERT_CHANNEL_LABELS[k] })),
    };
  }),

  addAlertChannel: adminProcedure
    .input(z.object({ kind: z.enum(ALERT_CHANNEL_KINDS), name: z.string().trim().min(1).max(64), url: z.string().min(12).max(2048), secret: z.string().max(512).optional(), test: z.boolean().default(true), tier: z.number().int().min(1).max(MAX_TIER).default(1) }))
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const v = validateChannelUrl(input.kind, input.url);
      if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: v.error });
      const urlEnc = sealSecret(v.url);
      const secretEnc = input.secret?.trim() ? sealSecret(input.secret.trim()) : null;
      if (input.test) {
        const r = await sendToChannel({ kind: input.kind, urlEnc, secretEnc }, { title: "金色韶华 · 告警通道测试 / Alert channel test", text: `Channel “${input.name}” is connected. ${new Date().toISOString()}`, kinds: [] });
        if (!r.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Test message failed: ${r.error}` });
      }
      const ins = await database.insert(alertChannels).values({ kind: input.kind, name: input.name, urlEnc, secretEnc, tier: input.tier, createdBy: ctx.user.id, lastStatus: input.test ? "ok" : null, lastSentAt: input.test ? new Date() : null });
      return { id: Number(ins[0].insertId), tested: input.test };
    }),

  updateAlertChannel: adminProcedure.input(z.object({ id: z.number().int().positive(), enabled: z.boolean().optional(), name: z.string().trim().min(1).max(64).optional(), tier: z.number().int().min(1).max(MAX_TIER).optional() })).mutation(async ({ input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const patch: Partial<typeof alertChannels.$inferInsert> = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.name !== undefined) patch.name = input.name;
    if (input.tier !== undefined) patch.tier = input.tier;
    if (Object.keys(patch).length) await database.update(alertChannels).set(patch).where(eq(alertChannels.id, input.id));
    return { ok: true as const };
  }),

  removeAlertChannel: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await database.delete(alertChannels).where(eq(alertChannels.id, input.id));
    return { removed: true as const };
  }),

  testAlertChannel: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [ch] = await database.select().from(alertChannels).where(eq(alertChannels.id, input.id)).limit(1);
    if (!ch) throw new TRPCError({ code: "NOT_FOUND" });
    const r = await sendToChannel(ch, { title: "金色韶华 · 告警通道测试 / Alert channel test", text: `Manual test from the ops panel. ${new Date().toISOString()}`, kinds: [] });
    await database.update(alertChannels).set({ lastStatus: r.ok ? "ok" : "failed", lastError: r.ok ? null : r.error.slice(0, 300), lastSentAt: new Date() }).where(eq(alertChannels.id, ch.id));
    return r;
  }),

  /** P12: run the alert evaluation now (sends email if any kind is below threshold). */
  evaluateAlerts: adminProcedure.mutation(async () => ({ alerted: await evaluateAlerts() })),

  channels: adminProcedure.query(async () => {
    const mail = await mailDiagnostics();
    return {
      mail,
      sms: { configured: isSmsConfigured(), transport: smsTransportName(), hint: isSmsConfigured() ? null : "Set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM, or SMS_WEBHOOK_URL." },
      push: { configured: isPushConfigured(), hint: isPushConfigured() ? null : "Set EXPO_ACCESS_TOKEN (recommended for production; Expo Push works unauthenticated with lower limits)." },
      redis: rateLimitBackend(),
      coordination: coordinatorStatus(),
      studio: __queueState(),
    };
  }),

  testMail: adminProcedure.input(z.object({ to: z.string().email().optional() }).optional()).mutation(async ({ input, ctx }) => {
    const to = input?.to ?? ctx.user.email;
    if (!to) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No recipient — add an email to your profile" });
    if (!isMailConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Mail transport not configured" });
    const result = await sendMail({ to, subject: "金色韶华 · 邮件通道测试 / Mail channel test", text: `This is a test message from Golden Memory (${new Date().toISOString()}). If you can read this, outbound mail works.` });
    return { ...result, to };
  }),

  testSms: adminProcedure.mutation(async ({ ctx }) => {
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [u] = await database.select({ phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!u?.phone || !u.phoneVerifiedAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Verify your own phone number first (Settings → Security)" });
    if (!isSmsConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SMS transport not configured" });
    const result = await sendSms({ to: u.phone, text: `【金色韶华】短信通道测试 ${new Date().toISOString().slice(11, 16)} UTC` });
    return { ...result, to: maskPhone(u.phone) };
  }),
});
