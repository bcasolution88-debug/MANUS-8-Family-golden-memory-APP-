import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "@/server/_core/trpc";
import { assertUserRateLimit, USER_LIMITS } from "@/server/_core/rateLimit";
import { transcribeAudio } from "@/server/_core/voiceTranscription";
import {
  SIGNED_URL_TTL_SECONDS,
  buildVoiceKey,
  isStorageConfigured,
  isValidStorageKey,
  parseStorageKey,
  storageGetSignedUrl,
  storagePresignPut,
} from "@/server/storage";

const AUDIO_EXT = ["m4a", "mp3", "wav", "webm", "ogg", "mp4"] as const;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024; // mirrors voiceTranscription.ts limit

/**
 * Voice → text for the comment composer (P3).
 *
 * Flow:
 *   1. `initUpload`  → presigned PUT under `users/{uid}/voice/{uuid}.{ext}`
 *   2. client PUTs the recording directly to S3
 *   3. `transcribe`  → server signs a GET URL for that private key and hands it
 *                      to the Whisper service; the text is returned, nothing is
 *                      persisted (the audio is scratch input, not a memory).
 */
export const voiceRouter = router({
  initUpload: protectedProcedure
    .input(
      z.object({
        ext: z.enum(AUDIO_EXT).default("m4a"),
        contentType: z.string().max(100).optional(),
        fileSize: z.number().int().positive().max(MAX_AUDIO_BYTES).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ctx.user.id, "transcribe", USER_LIMITS.transcribe.limit, USER_LIMITS.transcribe.windowMs);
      if (!isStorageConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Voice upload storage is not configured" });
      }
      const storageKey = buildVoiceKey(ctx.user.id, input.ext);
      const { url } = await storagePresignPut(storageKey, input.contentType ?? `audio/${input.ext}`);
      return { storageKey, presignedUrl: url, expiresIn: SIGNED_URL_TTL_SECONDS, maxBytes: MAX_AUDIO_BYTES };
    }),

  transcribe: protectedProcedure
    .input(
      z.object({
        storageKey: z.string().max(512),
        language: z.enum(["zh", "en"]).optional(),
        prompt: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertUserRateLimit(ctx.user.id, "transcribe", USER_LIMITS.transcribe.limit, USER_LIMITS.transcribe.windowMs);

      // Only the owner of a `users/{uid}/...` key may transcribe it.
      const parsed = parseStorageKey(input.storageKey);
      if (!isValidStorageKey(input.storageKey) || parsed.kind !== "user" || parsed.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Audio does not belong to you" });
      }
      if (!isStorageConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Voice transcription is not configured" });
      }

      const audioUrl = await storageGetSignedUrl(input.storageKey);
      const result = await transcribeAudio({ audioUrl, language: input.language, prompt: input.prompt });
      if ("error" in result) {
        throw new TRPCError({
          code: result.code === "FILE_TOO_LARGE" || result.code === "INVALID_FORMAT" ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
          message: result.error,
          cause: result,
        });
      }
      return {
        text: result.text.trim(),
        language: result.language,
        duration: result.duration,
        segments: result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
      };
    }),
});
