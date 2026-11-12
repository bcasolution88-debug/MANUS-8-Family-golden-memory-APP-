import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { familyRouter } from "./familyRouter";
import { albumRouter } from "./albumRouter";
import { mediaRouter } from "./mediaRouter";
import { interactionRouter } from "./interactionRouter";
import { oauthRouter } from "./oauthRouter";
import { notificationRouter } from "./notifications";
import { voiceRouter } from "./voiceRouter";
import { studioRouter } from "./studioRouter";
import { profileRouter, timelineRouter } from "./timelineRouter";
import { passwordAuthRouter } from "./passwordAuthRouter";
import { preferencesRouter } from "./preferencesRouter";
import { aiRouter } from "./aiRouter";
import { verificationRouter } from "./verificationRouter";
import { backupRouter } from "./backupRouter";
import { pushRouter } from "./pushRouter";
import { opsRouter } from "./opsRouter";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    // P8: email + password accounts
    register: passwordAuthRouter._def.procedures.register,
    login: passwordAuthRouter._def.procedures.login,
    changePassword: passwordAuthRouter._def.procedures.changePassword,
    passwordStatus: passwordAuthRouter._def.procedures.passwordStatus,
    // P9: emailed codes — password reset, email verification, 2FA
    requestPasswordReset: verificationRouter._def.procedures.requestPasswordReset,
    resetPassword: verificationRouter._def.procedures.resetPassword,
    requestEmailVerification: verificationRouter._def.procedures.requestEmailVerification,
    verifyEmail: verificationRouter._def.procedures.verifyEmail,
    securityStatus: verificationRouter._def.procedures.securityStatus,
    setTwoFactor: verificationRouter._def.procedures.setTwoFactor,
    complete2fa: verificationRouter._def.procedures.complete2fa,
    resend2fa: verificationRouter._def.procedures.resend2fa,
    // P10: phone number + SMS code channel
    requestPhoneVerification: verificationRouter._def.procedures.requestPhoneVerification,
    verifyPhone: verificationRouter._def.procedures.verifyPhone,
    removePhone: verificationRouter._def.procedures.removePhone,
    setTwoFactorChannel: verificationRouter._def.procedures.setTwoFactorChannel,
    // P11: passwordless sign-in with a texted code
    requestSmsLogin: verificationRouter._def.procedures.requestSmsLogin,
    completeSmsLogin: verificationRouter._def.procedures.completeSmsLogin,
    // P12: account merge
    requestMerge: verificationRouter._def.procedures.requestMerge,
    completeMerge: verificationRouter._def.procedures.completeMerge,
    previewMerge: verificationRouter._def.procedures.previewMerge,
    mergeOwnership: verificationRouter._def.procedures.mergeOwnership,
    mergeOwnershipCsv: verificationRouter._def.procedures.mergeOwnershipCsv,
    mergeHistory: verificationRouter._def.procedures.mergeHistory,
    undoMerge: verificationRouter._def.procedures.undoMerge,
    mergeAuditCsv: verificationRouter._def.procedures.mergeAuditCsv,
  }),
  push: pushRouter,
  ops: opsRouter,
  preferences: preferencesRouter,
  ai: aiRouter,
  backup: backupRouter,
  family: familyRouter,
  album: albumRouter,
  media: mediaRouter,
  interaction: interactionRouter,
  notification: notificationRouter,
  voice: voiceRouter,
  studio: studioRouter,
  timeline: timelineRouter,
  profile: profileRouter,
  oauth: oauthRouter,
});

export type AppRouter = typeof appRouter;
