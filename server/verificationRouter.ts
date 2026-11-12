/**
 * P9 — emailed one-time codes: password reset, email verification, login 2FA.
 *
 *   requestPasswordReset {email}            → always "ok" (no account enumeration); mails a code
 *   resetPassword {email, code, newPassword} → verifies, sets hash, consumes code, signs in
 *   requestEmailVerification                 → signed-in user, mails a code
 *   verifyEmail {code}                        → sets users.emailVerifiedAt
 *   setTwoFactor {enabled}                    → requires verified email
 *   complete2fa {challengeId, code}           → finishes a password login that returned `requires2fa`
 *
 * Codes: 6 digits, scrypt-hashed, 10-minute TTL, 5 attempts, 1 request/minute
 * per (email, purpose). The email layer degrades to console logging when no
 * transport is configured; responses expose `delivered` so the UI can say so.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { z } from "zod";

import { users, verificationCodes, userPreferences, type VerificationChannel, type VerificationPurpose } from "@/drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const.js";
import { getSessionCookieOptions } from "@/server/_core/cookies";
import { codeEmail, isMailConfigured, sendMail } from "@/server/_core/mailer";
import { codeSms, isSmsConfigured, maskPhone, normalizePhone, sendSms } from "@/server/_core/sms";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import { sdk } from "@/server/_core/sdk";
import { protectedProcedure, publicProcedure, router } from "@/server/_core/trpc";
import { getDb } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/passwordAuthRouter";
import { AUDIT_TABLES, exportMergeAudit, findMergeSource, listMerges, MERGE_UNDO_DAYS, ownershipAudit, ownershipAuditCsv, performMerge, previewMerge, undoMerge } from "@/server/mergeService";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_MS = 60 * 1000;

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Test hook: the last code issued per (email, purpose) — only populated outside production. */
export const __lastIssuedCodes = new Map<string, string>();

/**
 * Issue a code (invalidating previous unconsumed ones for the same email+purpose).
 * Returns the delivery result; throws TOO_MANY_REQUESTS when asked again within a minute.
 */
export async function issueCode(opts: {
  /** Lookup key: the account email, or the E.164 phone for `verify_phone`. */
  email: string;
  purpose: VerificationPurpose;
  userId?: number | null;
  name?: string | null;
  zh: boolean;
  /** P10: delivery channel (default email). `phone` is required for "sms". */
  channel?: VerificationChannel;
  phone?: string | null;
}) {
  const database = await requireDatabase();
  const email = opts.email.toLowerCase();
  const channel: VerificationChannel = opts.channel ?? "email";
  if (channel === "sms" && !opts.phone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No phone number for SMS delivery" });
  const recent = await database
    .select({ id: verificationCodes.id })
    .from(verificationCodes)
    .where(and(eq(verificationCodes.email, email), eq(verificationCodes.purpose, opts.purpose), gte(verificationCodes.createdAt, new Date(Date.now() - CODE_RESEND_MS))))
    .limit(1);
  if (recent[0] && process.env.RATE_LIMIT_DISABLED !== "1") {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait a minute before requesting another code" });
  }
  // Consume older pending codes so only the newest is valid.
  await database
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(verificationCodes.email, email), eq(verificationCodes.purpose, opts.purpose), isNull(verificationCodes.consumedAt)));

  const code = generateCode();
  const id = crypto.randomUUID();
  await database.insert(verificationCodes).values({
    id,
    userId: opts.userId ?? null,
    email,
    purpose: opts.purpose,
    channel,
    codeHash: await hashPassword(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  if (process.env.NODE_ENV !== "production") __lastIssuedCodes.set(`${email}:${opts.purpose}`, code);

  const minutes = CODE_TTL_MS / 60_000;
  if (channel === "sms") {
    const sms = await sendSms({ to: opts.phone!, text: codeSms({ code, purpose: opts.purpose, minutes, zh: opts.zh }) });
    return { id, delivered: sms.delivered, transport: sms.transport, channel, destination: maskPhone(opts.phone!), expiresAt: new Date(Date.now() + CODE_TTL_MS) };
  }
  const mail = await sendMail({ to: email, ...codeEmail({ code, purpose: opts.purpose, name: opts.name, minutes, zh: opts.zh }) });
  return { id, delivered: mail.delivered, transport: mail.transport, channel, destination: email, expiresAt: new Date(Date.now() + CODE_TTL_MS) };
}

/** P10: which channel a user's 2FA / reset codes go through, honouring prefs + verified phone. */
export async function resolveCodeChannel(user: { id: number; phone: string | null; phoneVerifiedAt: Date | null }): Promise<{ channel: VerificationChannel; phone: string | null }> {
  const database = await requireDatabase();
  const [p] = await database.select({ twoFactorChannel: userPreferences.twoFactorChannel }).from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
  if (p?.twoFactorChannel === "sms" && user.phone && user.phoneVerifiedAt) return { channel: "sms", phone: user.phone };
  return { channel: "email", phone: null };
}

/** Verify + consume. Throws with a specific code on failure. */
export async function consumeCode(opts: { email: string; purpose: VerificationPurpose; code: string; id?: string }) {
  return verifyCodeRow({ ...opts, consume: true });
}

/** P14: validate a code without consuming it (wrong guesses still count). Used by merge preview. */
export async function peekCode(opts: { email: string; purpose: VerificationPurpose; code: string; id?: string }) {
  return verifyCodeRow({ ...opts, consume: false });
}

async function verifyCodeRow(opts: { email: string; purpose: VerificationPurpose; code: string; id?: string; consume: boolean }) {
  const database = await requireDatabase();
  const email = opts.email.toLowerCase();
  const rows = await database
    .select()
    .from(verificationCodes)
    .where(
      and(
        // A challenge id is unguessable, so it alone identifies the row (destination may be a phone).
        opts.id ? eq(verificationCodes.id, opts.id) : eq(verificationCodes.email, email),
        eq(verificationCodes.purpose, opts.purpose),
        isNull(verificationCodes.consumedAt),
      ),
    )
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No pending code — request a new one" });
  if (row.expiresAt.getTime() < Date.now()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Code expired — request a new one" });
  if (row.attempts >= CODE_MAX_ATTEMPTS) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts — request a new code" });
  const ok = await verifyPassword(opts.code.trim(), row.codeHash);
  if (!ok) {
    await database.update(verificationCodes).set({ attempts: row.attempts + 1 }).where(eq(verificationCodes.id, row.id));
    const left = CODE_MAX_ATTEMPTS - row.attempts - 1;
    throw new TRPCError({ code: "UNAUTHORIZED", message: left > 0 ? `Incorrect code (${left} attempts left)` : "Incorrect code — request a new one" });
  }
  if (opts.consume) await database.update(verificationCodes).set({ consumedAt: new Date() }).where(eq(verificationCodes.id, row.id));
  return row;
}

async function issueSession(ctx: { req: any; res: any }, user: { openId: string; name: string | null }) {
  const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: ONE_YEAR_MS });
  ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
  return sessionToken;
}

const emailInput = z.string().trim().toLowerCase().email().max(320);
const codeInput = z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits");
const lang = z.enum(["zh", "en"]).default("zh");

function ipBucket(ip: string | undefined) {
  let h = 0;
  for (const ch of ip ?? "unknown") h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) || 1;
}

export const verificationRouter = router({
  /** Always succeeds (no account enumeration). Mails a code if the email has a password account. */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: emailInput, language: lang }))
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ipBucket(ctx.req.ip), "auth:reset", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
      const database = await requireDatabase();
      const [user] = await database.select({ id: users.id, name: users.name, passwordHash: users.passwordHash, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.email, input.email)).limit(1);
      let delivered = false;
      let channel: VerificationChannel = "email";
      let destination: string | null = null;
      if (user) {
        try {
          const route = await resolveCodeChannel(user);
          const r = await issueCode({ email: input.email, purpose: "password_reset", userId: user.id, name: user.name, zh: input.language === "zh", channel: route.channel, phone: route.phone });
          delivered = r.delivered;
          channel = r.channel;
          destination = r.destination;
        } catch (error) {
          if (error instanceof TRPCError && error.code === "TOO_MANY_REQUESTS") throw error;
          console.error("[verification] reset issue failed", error);
        }
      }
      return { ok: true as const, delivered, channel, destination, mailConfigured: isMailConfigured(), smsConfigured: isSmsConfigured(), ttlMinutes: CODE_TTL_MS / 60_000 };
    }),

  resetPassword: publicProcedure
    .input(z.object({ email: emailInput, code: codeInput, newPassword: z.string().min(8).max(128) }))
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ipBucket(ctx.req.ip), "auth:reset-verify", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
      const database = await requireDatabase();
      const row = await consumeCode({ email: input.email, purpose: "password_reset", code: input.code });
      const [user] = await database.select().from(users).where(row.userId ? eq(users.id, row.userId) : eq(users.email, input.email)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      await database
        .update(users)
        .set({ passwordHash: await hashPassword(input.newPassword), emailVerifiedAt: user.emailVerifiedAt ?? new Date(), lastSignedIn: new Date() })
        .where(eq(users.id, user.id));
      const sessionToken = await issueSession(ctx, user);
      return { sessionToken, user: { id: user.id, openId: user.openId, email: user.email, name: user.name, avatar: user.avatar, relationship: user.relationship, loginMethod: user.loginMethod } };
    }),

  /** Signed-in: mail a code to the account email. */
  requestEmailVerification: protectedProcedure.input(z.object({ language: lang }).optional()).mutation(async ({ input, ctx }) => {
    if (!ctx.user.email) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add an email to your profile first" });
    const r = await issueCode({ email: ctx.user.email, purpose: "verify_email", userId: ctx.user.id, name: ctx.user.name, zh: (input?.language ?? "zh") === "zh" });
    return { ...r, mailConfigured: isMailConfigured() };
  }),

  verifyEmail: protectedProcedure.input(z.object({ code: codeInput })).mutation(async ({ input, ctx }) => {
    if (!ctx.user.email) throw new TRPCError({ code: "PRECONDITION_FAILED" });
    await consumeCode({ email: ctx.user.email, purpose: "verify_email", code: input.code });
    const database = await requireDatabase();
    await database.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, ctx.user.id));
    return { verified: true as const, verifiedAt: new Date() };
  }),

  /** Verification + 2FA status for Settings. */
  securityStatus: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDatabase();
    const [u] = await database.select({ emailVerifiedAt: users.emailVerifiedAt, email: users.email, passwordHash: users.passwordHash, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const [p] = await database.select({ twoFactorEnabled: userPreferences.twoFactorEnabled, twoFactorChannel: userPreferences.twoFactorChannel }).from(userPreferences).where(eq(userPreferences.userId, ctx.user.id)).limit(1);
    return {
      email: u?.email ?? null,
      emailVerified: !!u?.emailVerifiedAt,
      emailVerifiedAt: u?.emailVerifiedAt ?? null,
      hasPassword: !!u?.passwordHash,
      twoFactorEnabled: p?.twoFactorEnabled ?? false,
      /** P10 */
      twoFactorChannel: (p?.twoFactorChannel ?? "email") as VerificationChannel,
      phone: u?.phone ?? null,
      phoneMasked: u?.phone ? maskPhone(u.phone) : null,
      phoneVerified: !!u?.phoneVerifiedAt,
      mailConfigured: isMailConfigured(),
      smsConfigured: isSmsConfigured(),
    };
  }),

  /** Toggle emailed 2FA on password sign-in. Requires a verified email. */
  setTwoFactor: protectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    if (input.enabled) {
      const [u] = await database.select({ emailVerifiedAt: users.emailVerifiedAt, passwordHash: users.passwordHash }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!u?.emailVerifiedAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Verify your email before enabling two-factor sign-in" });
      if (!u.passwordHash) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Two-factor applies to password sign-in — set a password first" });
    }
    await database
      .insert(userPreferences)
      .values({ userId: ctx.user.id, twoFactorEnabled: input.enabled })
      .onDuplicateKeyUpdate({ set: { twoFactorEnabled: input.enabled } });
    return { twoFactorEnabled: input.enabled };
  }),

  /** Finish a password login that returned `requires2fa` (see auth.login). */
  complete2fa: publicProcedure
    .input(z.object({ challengeId: z.string().uuid(), email: emailInput, code: codeInput }))
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ipBucket(ctx.req.ip), "auth:2fa", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
      const row = await consumeCode({ email: input.email, purpose: "login_2fa", code: input.code, id: input.challengeId });
      if (row.email !== input.email.toLowerCase()) throw new TRPCError({ code: "UNAUTHORIZED", message: "Challenge does not belong to this account" });
      const database = await requireDatabase();
      const [user] = await database.select().from(users).where(eq(users.id, row.userId!)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      await database.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
      const sessionToken = await issueSession(ctx, user);
      return { sessionToken, user: { id: user.id, openId: user.openId, email: user.email, name: user.name, avatar: user.avatar, relationship: user.relationship, loginMethod: user.loginMethod } };
    }),

  /** Resend the 2FA code for an in-flight challenge. */
  resend2fa: publicProcedure.input(z.object({ email: emailInput, language: lang })).mutation(async ({ input, ctx }) => {
    await assertUserRateLimit(ipBucket(ctx.req.ip), "auth:2fa", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
    const database = await requireDatabase();
    const [user] = await database.select({ id: users.id, name: users.name, phone: users.phone, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.email, input.email)).limit(1);
    if (!user) return { ok: true as const, delivered: false, challengeId: null, channel: "email" as VerificationChannel, destination: null };
    const route = await resolveCodeChannel(user);
    const r = await issueCode({ email: input.email, purpose: "login_2fa", userId: user.id, name: user.name, zh: input.language === "zh", channel: route.channel, phone: route.phone });
    return { ok: true as const, delivered: r.delivered, challengeId: r.id, channel: r.channel, destination: r.destination };
  }),

  /* ---------------------------------------------------------------- */
  /* P10 — phone number + SMS channel                                   */
  /* ---------------------------------------------------------------- */

  /** Save a phone number (unverified) and text it a code. */
  requestPhoneVerification: protectedProcedure
    .input(z.object({ phone: z.string().trim().min(8).max(32), language: lang }))
    .mutation(async ({ input, ctx }) => {
      const phone = normalizePhone(input.phone);
      if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the number in international format, e.g. +86 138 0013 8000" });
      const database = await requireDatabase();
      const [taken] = await database.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
      if (taken && taken.id !== ctx.user.id) throw new TRPCError({ code: "CONFLICT", message: "This phone number is linked to another account" });
      await database.update(users).set({ phone, phoneVerifiedAt: null }).where(eq(users.id, ctx.user.id));
      // Switching the phone invalidates an SMS 2FA preference until re-verified.
      await database.update(userPreferences).set({ twoFactorChannel: "email" }).where(eq(userPreferences.userId, ctx.user.id));
      const r = await issueCode({ email: phone, purpose: "verify_phone", userId: ctx.user.id, name: ctx.user.name, zh: input.language === "zh", channel: "sms", phone });
      return { ...r, smsConfigured: isSmsConfigured(), phoneMasked: maskPhone(phone) };
    }),

  verifyPhone: protectedProcedure.input(z.object({ code: codeInput })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    const [u] = await database.select({ phone: users.phone }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!u?.phone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add a phone number first" });
    await consumeCode({ email: u.phone, purpose: "verify_phone", code: input.code });
    await database.update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.id, ctx.user.id));
    return { verified: true as const, verifiedAt: new Date() };
  }),

  removePhone: protectedProcedure.mutation(async ({ ctx }) => {
    const database = await requireDatabase();
    await database.update(users).set({ phone: null, phoneVerifiedAt: null }).where(eq(users.id, ctx.user.id));
    await database.update(userPreferences).set({ twoFactorChannel: "email" }).where(eq(userPreferences.userId, ctx.user.id));
    return { removed: true as const };
  }),

  /* ---------------------------------------------------------------- */
  /* P11 — passwordless sign-in with a texted code                      */
  /* ---------------------------------------------------------------- */

  /**
   * Text a sign-in code to a *verified* phone. Always returns ok (no account
   * enumeration); `delivered` is false when the number is unknown or SMS is
   * not configured. The challengeId is required to complete the login.
   */
  requestSmsLogin: publicProcedure
    .input(z.object({ phone: z.string().trim().min(8).max(32), language: lang }))
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ipBucket(ctx.req.ip), "auth:sms-login", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
      const phone = normalizePhone(input.phone);
      if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the number in international format, e.g. +86 138 0013 8000" });
      const database = await requireDatabase();
      const [user] = await database.select({ id: users.id, name: users.name, phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(and(eq(users.phone, phone), isNull(users.mergedIntoUserId))).limit(1);
      if (!user?.phoneVerifiedAt) {
        return { ok: true as const, delivered: false, challengeId: null, destination: maskPhone(phone), smsConfigured: isSmsConfigured(), ttlMinutes: CODE_TTL_MS / 60_000 };
      }
      const r = await issueCode({ email: phone, purpose: "login_sms", userId: user.id, name: user.name, zh: input.language === "zh", channel: "sms", phone });
      return { ok: true as const, delivered: r.delivered, challengeId: r.id, destination: r.destination, smsConfigured: isSmsConfigured(), ttlMinutes: CODE_TTL_MS / 60_000 };
    }),

  /** Finish a passwordless sign-in. Does not require (or bypass) the 2FA flag — the phone *is* the second factor. */
  completeSmsLogin: publicProcedure
    .input(z.object({ challengeId: z.string().uuid(), phone: z.string().trim().min(8).max(32), code: codeInput }))
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ipBucket(ctx.req.ip), "auth:sms-login-verify", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
      const phone = normalizePhone(input.phone);
      if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phone number" });
      const row = await consumeCode({ email: phone, purpose: "login_sms", code: input.code, id: input.challengeId });
      if (row.email !== phone || !row.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Challenge does not match this phone" });
      const database = await requireDatabase();
      const [user] = await database.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || user.phone !== phone || !user.phoneVerifiedAt) throw new TRPCError({ code: "UNAUTHORIZED", message: "Phone is no longer linked to an account" });
      await database.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
      const sessionToken = await issueSession(ctx, user);
      return { sessionToken, user: { id: user.id, openId: user.openId, email: user.email, name: user.name, avatar: user.avatar, relationship: user.relationship, loginMethod: user.loginMethod } };
    }),

  /* ---------------------------------------------------------------- */
  /* P12 — account merge (source → the signed-in target)                */
  /* ---------------------------------------------------------------- */

  /** Name the other account by email; a code is sent *to that email* so only its owner can approve. */
  requestMerge: protectedProcedure.input(z.object({ email: emailInput, language: lang })).mutation(async ({ input, ctx }) => {
    await assertUserRateLimit(ctx.user.id, "merge", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
    const src = await findMergeSource(ctx.user.id, input.email);
    // No enumeration: same shape whether or not the email exists.
    if (!src) return { ok: true as const, delivered: false, destination: input.email, ttlMinutes: CODE_TTL_MS / 60_000, mailConfigured: isMailConfigured() };
    const r = await issueCode({ email: input.email, purpose: "merge_account", userId: src.id, name: src.name, zh: input.language === "zh" });
    return { ok: true as const, delivered: r.delivered, destination: input.email, ttlMinutes: CODE_TTL_MS / 60_000, mailConfigured: isMailConfigured() };
  }),

  /** Verify the code sent to the *source* email, then fold that account into the signed-in one. */
  /**
   * P14: preview what a merge would do — requires the same verified code (not consumed),
   * so only someone holding the source inbox can see the source's data summary.
   */
  previewMerge: protectedProcedure.input(z.object({ email: emailInput, code: codeInput })).mutation(async ({ input, ctx }) => {
    await assertUserRateLimit(ctx.user.id, "merge-verify", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
    const row = await peekCode({ email: input.email, purpose: "merge_account", code: input.code });
    if (!row.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Challenge is not bound to an account" });
    return previewMerge(ctx.user.id, row.userId);
  }),

  completeMerge: protectedProcedure
    .input(z.object({ email: emailInput, code: codeInput, choices: z.record(z.string(), z.enum(["target", "source"])).optional() }))
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ctx.user.id, "merge-verify", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
      const row = await consumeCode({ email: input.email, purpose: "merge_account", code: input.code });
      if (!row.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Challenge is not bound to an account" });
      const outcome = await performMerge(ctx.user.id, row.userId, new Date(), input.choices ?? null);
      return { merged: true as const, ...outcome };
    }),

  mergeHistory: protectedProcedure.query(({ ctx }) => listMerges(ctx.user.id)),

  /** P13: reverse a merge within MERGE_UNDO_DAYS (source account comes back with its data). */
  undoMerge: protectedProcedure.input(z.object({ mergeId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    await assertUserRateLimit(ctx.user.id, "merge-undo", USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
    return { undone: true as const, ...(await undoMerge(ctx.user.id, input.mergeId)) };
  }),

  /** P13: CSV audit of merges — own rows, or every row for admins (`all`). */
  mergeAuditCsv: protectedProcedure.input(z.object({ all: z.boolean().default(false) }).optional()).mutation(async ({ input, ctx }) => {
    const all = !!input?.all && ctx.user.role === "admin";
    const content = await exportMergeAudit({ userId: ctx.user.id, all });
    return { content, filename: `golden-memory-merges-${new Date().toISOString().slice(0, 10)}.csv`, contentType: "text/csv", all, undoDays: MERGE_UNDO_DAYS };
  }),

  /** P15: per-row ownership audit of merges (what moved from whom to whom, current owner, filter by merge / table). */
  mergeOwnership: protectedProcedure
    .input(z.object({ all: z.boolean().default(false), mergeId: z.number().int().positive().optional(), table: z.enum(AUDIT_TABLES).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input, ctx }) => {
      const all = !!input?.all && ctx.user.role === "admin";
      const r = await ownershipAudit({ userId: ctx.user.id, all, mergeId: input?.mergeId ?? null, table: input?.table ?? null, offset: input?.offset ?? 0, limit: input?.limit ?? 100 });
      return { ...r, all, tablesKnown: AUDIT_TABLES };
    }),
  mergeOwnershipCsv: protectedProcedure.input(z.object({ all: z.boolean().default(false), mergeId: z.number().int().positive().optional(), table: z.enum(AUDIT_TABLES).optional() }).optional()).mutation(async ({ input, ctx }) => {
    const all = !!input?.all && ctx.user.role === "admin";
    const r = await ownershipAudit({ userId: ctx.user.id, all, mergeId: input?.mergeId ?? null, table: input?.table ?? null, offset: 0, limit: 500 });
    return { content: ownershipAuditCsv(r.rows), filename: `golden-memory-merge-ownership-${new Date().toISOString().slice(0, 10)}.csv`, contentType: "text/csv", total: r.total, truncated: r.total > r.rows.length };
  }),

  /** Choose where 2FA / reset codes are delivered. "sms" needs a verified phone. */
  setTwoFactorChannel: protectedProcedure.input(z.object({ channel: z.enum(["email", "sms"]) })).mutation(async ({ input, ctx }) => {
    const database = await requireDatabase();
    if (input.channel === "sms") {
      const [u] = await database.select({ phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!u?.phoneVerifiedAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Verify your phone number before using SMS codes" });
    }
    await database
      .insert(userPreferences)
      .values({ userId: ctx.user.id, twoFactorChannel: input.channel })
      .onDuplicateKeyUpdate({ set: { twoFactorChannel: input.channel } });
    return { twoFactorChannel: input.channel };
  }),
});
