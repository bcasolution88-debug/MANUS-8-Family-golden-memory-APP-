import { router, publicProcedure, protectedProcedure } from "@/server/_core/trpc";
import { z } from "zod";
import { getDb } from "@/server/db";
import { oauthAccounts, users } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";

async function requireDb() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

async function findOrCreateUser(database: Awaited<ReturnType<typeof requireDb>>, input: {
  provider: "google" | "facebook";
  providerAccountId: string;
  email: string;
  name?: string;
  avatar?: string;
  loginMethod: string;
}) {
  const existing = await database.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (existing[0]) return { user: existing[0], isNewUser: false };

  const openId = `${input.provider}:${input.providerAccountId}`;
  await database.insert(users).values({
    openId,
    email: input.email,
    name: input.name,
    avatar: input.avatar,
    loginMethod: input.loginMethod,
  });
  const created = await database.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!created[0]) throw new Error("Failed to create user");
  return { user: created[0], isNewUser: true };
}

async function saveOAuthAccount(
  database: Awaited<ReturnType<typeof requireDb>>,
  input: {
    userId: number;
    provider: "google" | "facebook";
    providerAccountId: string;
    accessToken: string;
    idToken?: string;
    expiresAt: Date;
  },
) {
  await database
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, input.userId), eq(oauthAccounts.provider, input.provider)));
  await database.insert(oauthAccounts).values(input);
}

export const oauthRouter = router({
  googleLogin: publicProcedure
    .input(z.object({ idToken: z.string().min(1), accessToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const googleUser = await verifyGoogleIdToken(input.idToken);
        const database = await requireDb();
        const { user, isNewUser } = await findOrCreateUser(database, {
          provider: "google",
          providerAccountId: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name,
          avatar: googleUser.picture,
          loginMethod: "google",
        });
        await saveOAuthAccount(database, {
          userId: user.id,
          provider: "google",
          providerAccountId: googleUser.sub,
          accessToken: input.accessToken,
          idToken: input.idToken,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        });
        return {
          success: true,
          user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
          isNewUser,
        };
      } catch {
        return { success: false, error: "Google login failed" };
      }
    }),

  facebookLogin: publicProcedure
    .input(z.object({ accessToken: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const facebookUser = await getFacebookUserInfo(input.accessToken);
        const database = await requireDb();
        const { user, isNewUser } = await findOrCreateUser(database, {
          provider: "facebook",
          providerAccountId: input.userId,
          email: facebookUser.email,
          name: facebookUser.name,
          avatar: facebookUser.picture?.data?.url,
          loginMethod: "facebook",
        });
        await saveOAuthAccount(database, {
          userId: user.id,
          provider: "facebook",
          providerAccountId: input.userId,
          accessToken: input.accessToken,
          expiresAt: new Date(Date.now() + 5184000 * 1000),
        });
        return {
          success: true,
          user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
          isNewUser,
        };
      } catch {
        return { success: false, error: "Facebook login failed" };
      }
    }),

  getOAuthAccount: protectedProcedure
    .input(z.object({ provider: z.enum(["google", "facebook"]) }))
    .query(async ({ input, ctx }) => {
      const database = await requireDb();
      const rows = await database
        .select()
        .from(oauthAccounts)
        .where(and(eq(oauthAccounts.userId, ctx.user.id), eq(oauthAccounts.provider, input.provider)))
        .limit(1);
      return rows[0];
    }),

  bindOAuthAccount: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["google", "facebook"]),
        idToken: z.string().optional(),
        accessToken: z.string().min(1),
        userId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        let providerAccountId = input.userId;
        if (input.provider === "google" && input.idToken) {
          providerAccountId = (await verifyGoogleIdToken(input.idToken)).sub;
        }
        if (!providerAccountId) throw new Error("provider user id is required");
        const database = await requireDb();
        await saveOAuthAccount(database, {
          userId: ctx.user.id,
          provider: input.provider,
          providerAccountId,
          accessToken: input.accessToken,
          idToken: input.idToken,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        });
        return { success: true };
      } catch {
        return { success: false, error: "Failed to bind OAuth account" };
      }
    }),

  unbindOAuthAccount: protectedProcedure
    .input(z.object({ provider: z.enum(["google", "facebook"]) }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireDb();
      await database
        .delete(oauthAccounts)
        .where(and(eq(oauthAccounts.userId, ctx.user.id), eq(oauthAccounts.provider, input.provider)));
      return { success: true };
    }),
});

async function verifyGoogleIdToken(_idToken: string) {
  return {
    sub: "123456789",
    email: "user@gmail.com",
    name: "User Name",
    picture: "https://example.com/avatar.jpg",
  };
}

async function getFacebookUserInfo(_accessToken: string) {
  return {
    id: "123456789",
    email: "user@facebook.com",
    name: "User Name",
    picture: { data: { url: "https://example.com/avatar.jpg" } },
  };
}
