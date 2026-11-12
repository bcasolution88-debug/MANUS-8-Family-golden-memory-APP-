/**
 * P8 — email + password accounts.
 *
 * Replaces the `handleLogin` / `handleRegister` TODOs on the auth screens.
 * Sessions are the same HS256 JWT the OAuth flow issues (`sdk.createSessionToken`):
 * set as the httpOnly cookie for web and returned in the body so native clients
 * can store it as a Bearer token (`Auth.setSessionToken`).
 *
 * Hashing: Node `scrypt` (N=16384, r=8, p=1) with a 16-byte salt, encoded as
 * `scrypt$N$r$p$salt$hash` so parameters can be rotated later.
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

import { userPreferences, users } from "@/drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const.js";
import { getSessionCookieOptions } from "@/server/_core/cookies";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import { sdk } from "@/server/_core/sdk";
import { protectedProcedure, publicProcedure, router } from "@/server/_core/trpc";
import { getDb } from "@/server/db";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const expected = Buffer.from(hashB64!, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64!, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const emailInput = z.string().trim().toLowerCase().email().max(320);
const passwordInput = z.string().min(8, "Password must be at least 8 characters").max(128);

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

/** Per-IP guard for anonymous auth attempts (uses the user-bucket store with a synthetic id). */
async function assertAuthAttempt(ip: string | undefined, scope: "login" | "register") {
  // Hash the IP into a stable small integer bucket key so we never store raw IPs.
  let h = 0;
  for (const ch of ip ?? "unknown") h = (h * 31 + ch.charCodeAt(0)) | 0;
  await assertUserRateLimit(Math.abs(h) || 1, `auth:${scope}`, USER_LIMITS.authAttempt.limit, USER_LIMITS.authAttempt.windowMs);
}

async function issueSession(ctx: { req: any; res: any }, user: { openId: string; name: string | null }) {
  const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name ?? "", expiresInMs: ONE_YEAR_MS });
  const cookieOptions = getSessionCookieOptions(ctx.req);
  ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
  return sessionToken;
}

const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  openId: u.openId,
  email: u.email,
  name: u.name,
  avatar: u.avatar,
  relationship: u.relationship,
  loginMethod: u.loginMethod,
});

export const passwordAuthRouter = router({
  /** Create an email + password account and sign in. */
  register: publicProcedure
    .input(z.object({ email: emailInput, password: passwordInput, name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      await assertAuthAttempt(ctx.req.ip, "register");
      const database = await requireDatabase();
      const existing = await database.select({ id: users.id, passwordHash: users.passwordHash, loginMethod: users.loginMethod }).from(users).where(eq(users.email, input.email)).limit(1);
      if (existing[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: existing[0].passwordHash
            ? "An account with this email already exists — please sign in"
            : `This email is linked to a ${existing[0].loginMethod ?? "social"} login — sign in with that provider`,
        });
      }
      const passwordHash = await hashPassword(input.password);
      const openId = `email:${crypto.randomUUID()}`;
      await database.insert(users).values({ openId, email: input.email, name: input.name, loginMethod: "email", passwordHash });
      const [user] = await database.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create account" });
      const sessionToken = await issueSession(ctx, user);
      return { requires2fa: false as const, sessionToken, user: publicUser(user), isNewUser: true as const };
    }),

  /** Sign in with email + password. Generic error on any mismatch. */
  login: publicProcedure
    .input(z.object({ email: emailInput, password: z.string().min(1).max(128) }))
    .mutation(async ({ input, ctx }) => {
      await assertAuthAttempt(ctx.req.ip, "login");
      const database = await requireDatabase();
      const rows = await database.select().from(users).where(eq(users.email, input.email)).limit(1);
      const user = rows[0];
      const ok = user ? await verifyPassword(input.password, user.passwordHash) : await verifyPassword(input.password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AA=="); // constant-time-ish
      if (!user || !ok) {
        if (user && !user.passwordHash) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `This account uses ${user.loginMethod ?? "social"} sign-in` });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect email or password" });
      }
      // P9: emailed second factor (opt-in, requires verified email)
      const [prefs] = await database.select({ twoFactorEnabled: userPreferences.twoFactorEnabled }).from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
      if (prefs?.twoFactorEnabled && user.emailVerifiedAt) {
        const { issueCode, resolveCodeChannel } = await import("@/server/verificationRouter");
        const route = await resolveCodeChannel(user);
        const challenge = await issueCode({ email: user.email!, purpose: "login_2fa", userId: user.id, name: user.name, zh: true, channel: route.channel, phone: route.phone });
        return { requires2fa: true as const, challengeId: challenge.id, email: user.email!, delivered: challenge.delivered, channel: challenge.channel, destination: challenge.destination, isNewUser: false as const };
      }
      await database.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
      const sessionToken = await issueSession(ctx, user);
      return { requires2fa: false as const, sessionToken, user: publicUser(user), isNewUser: false as const };
    }),

  /** Set or change the password of the signed-in user (OAuth users can add one). */
  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordInput }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDatabase();
      const [user] = await database.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      if (user.passwordHash) {
        if (!input.currentPassword || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect" });
        }
      }
      if (!user.email) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add an email to your profile before setting a password" });
      await database.update(users).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(users.id, user.id));
      return { success: true as const, hadPassword: !!user.passwordHash };
    }),

  /** Whether the signed-in user has a password set (Settings → account). */
  passwordStatus: protectedProcedure.query(async ({ ctx }) => {
    const database = await requireDatabase();
    const [user] = await database.select({ passwordHash: users.passwordHash, loginMethod: users.loginMethod, email: users.email }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return { hasPassword: !!user?.passwordHash, loginMethod: user?.loginMethod ?? null, email: user?.email ?? null };
  }),
});
