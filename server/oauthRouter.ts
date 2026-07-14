import { router, publicProcedure, protectedProcedure } from "@/server/_core/trpc";
import { z } from "zod";
import { db } from "@/server/db";
import { users, oauthAccounts } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const oauthRouter = router({
  // Google登录
  googleLogin: publicProcedure
    .input(
      z.object({
        idToken: z.string(),
        accessToken: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // 验证Google ID Token
        const googleUser = await verifyGoogleIdToken(input.idToken);

        // 查找或创建用户
        let user = await db.query.users.findFirst({
          where: eq(users.email, googleUser.email),
        });

        if (!user) {
          // 创建新用户
          const result = await db
            .insert(users)
            .values({
              email: googleUser.email,
              name: googleUser.name,
              avatar: googleUser.picture,
              emailVerified: true,
              createdAt: new Date(),
            })
            .returning();

          user = result[0];
        }

        // 保存或更新OAuth账户
        await db
          .insert(oauthAccounts)
          .values({
            userId: user.id,
            provider: "google",
            providerAccountId: googleUser.sub,
            accessToken: input.accessToken,
            idToken: input.idToken,
            expiresAt: new Date(Date.now() + 3600 * 1000),
          })
          .onConflictDoUpdate({
            target: [oauthAccounts.userId, oauthAccounts.provider],
            set: {
              accessToken: input.accessToken,
              idToken: input.idToken,
              expiresAt: new Date(Date.now() + 3600 * 1000),
            },
          });

        return {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
          },
          isNewUser: !user,
        };
      } catch (error) {
        return {
          success: false,
          error: "Google login failed",
        };
      }
    }),

  // Facebook登录
  facebookLogin: publicProcedure
    .input(
      z.object({
        accessToken: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // 获取Facebook用户信息
        const facebookUser = await getFacebookUserInfo(input.accessToken);

        // 查找或创建用户
        let user = await db.query.users.findFirst({
          where: eq(users.email, facebookUser.email),
        });

        if (!user) {
          // 创建新用户
          const result = await db
            .insert(users)
            .values({
              email: facebookUser.email,
              name: facebookUser.name,
              avatar: facebookUser.picture?.data?.url,
              emailVerified: false,
              createdAt: new Date(),
            })
            .returning();

          user = result[0];
        }

        // 保存或更新OAuth账户
        await db
          .insert(oauthAccounts)
          .values({
            userId: user.id,
            provider: "facebook",
            providerAccountId: input.userId,
            accessToken: input.accessToken,
            expiresAt: new Date(Date.now() + 5184000 * 1000), // 60 days
          })
          .onConflictDoUpdate({
            target: [oauthAccounts.userId, oauthAccounts.provider],
            set: {
              accessToken: input.accessToken,
              expiresAt: new Date(Date.now() + 5184000 * 1000),
            },
          });

        return {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatar: user.avatar,
          },
          isNewUser: !user,
        };
      } catch (error) {
        return {
          success: false,
          error: "Facebook login failed",
        };
      }
    }),

  // 获取OAuth账户信息
  getOAuthAccount: protectedProcedure
    .input(z.object({ provider: z.enum(["google", "facebook"]) }))
    .query(async ({ input, ctx }) => {
      const account = await db.query.oauthAccounts.findFirst({
        where: (oauthAccounts) =>
          eq(oauthAccounts.userId, ctx.user.id) &&
          eq(oauthAccounts.provider, input.provider),
      });

      return account;
    }),

  // 绑定OAuth账户
  bindOAuthAccount: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["google", "facebook"]),
        idToken: z.string().optional(),
        accessToken: z.string(),
        userId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        let providerAccountId = input.userId;

        if (input.provider === "google" && input.idToken) {
          const googleUser = await verifyGoogleIdToken(input.idToken);
          providerAccountId = googleUser.sub;
        }

        await db
          .insert(oauthAccounts)
          .values({
            userId: ctx.user.id,
            provider: input.provider,
            providerAccountId: providerAccountId!,
            accessToken: input.accessToken,
            idToken: input.idToken,
            expiresAt: new Date(Date.now() + 3600 * 1000),
          })
          .onConflictDoUpdate({
            target: [oauthAccounts.userId, oauthAccounts.provider],
            set: {
              accessToken: input.accessToken,
              idToken: input.idToken,
              expiresAt: new Date(Date.now() + 3600 * 1000),
            },
          });

        return { success: true };
      } catch (error) {
        return { success: false, error: "Failed to bind OAuth account" };
      }
    }),

  // 解绑OAuth账户
  unbindOAuthAccount: protectedProcedure
    .input(z.object({ provider: z.enum(["google", "facebook"]) }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(oauthAccounts)
        .where(
          (oauthAccounts) =>
            eq(oauthAccounts.userId, ctx.user.id) &&
            eq(oauthAccounts.provider, input.provider)
        );

      return { success: true };
    }),
});

// 辅助函数：验证Google ID Token
async function verifyGoogleIdToken(idToken: string) {
  // 实际实现应该使用Google的验证库
  // import { OAuth2Client } from 'google-auth-library';
  // const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  // const ticket = await client.verifyIdToken({
  //   idToken: idToken,
  //   audience: process.env.GOOGLE_CLIENT_ID,
  // });
  // return ticket.getPayload();

  // 模拟实现
  return {
    sub: "123456789",
    email: "user@gmail.com",
    name: "User Name",
    picture: "https://example.com/avatar.jpg",
  };
}

// 辅助函数：获取Facebook用户信息
async function getFacebookUserInfo(accessToken: string) {
  // 实际实现应该调用Facebook Graph API
  // const response = await fetch(
  //   `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
  // );
  // return response.json();

  // 模拟实现
  return {
    id: "123456789",
    email: "user@facebook.com",
    name: "User Name",
    picture: {
      data: {
        url: "https://example.com/avatar.jpg",
      },
    },
  };
}
