import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

import { useLanguage } from "@/lib/language-provider";
import { trpc } from "@/lib/trpc";

export type VoiceInputPhase = "idle" | "recording" | "uploading" | "transcribing";

/** Hard cap so a forgotten recording cannot blow the 16 MB transcription limit. */
export const MAX_RECORDING_SECONDS = 60;

type Options = {
  /** Called with the recognised text when transcription succeeds. */
  onResult: (text: string) => void;
  onError?: (message: string) => void;
};

/**
 * Press-to-talk voice input for comment composers (P3).
 *
 * Pipeline: expo-audio recorder → `voice.initUpload` (presigned PUT under the
 * caller's private `users/{uid}/voice/…` prefix) → direct upload → `voice.transcribe`
 * (server signs a GET URL and calls Whisper). Audio never passes through a
 * public bucket and the server never stores the transcript.
 */
export function useVoiceInput({ onResult, onError }: Options) {
  const { language, t } = useLanguage();
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<VoiceInputPhase>("idle");
  const autoStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initUpload = trpc.voice.initUpload.useMutation();
  const transcribe = trpc.voice.transcribe.useMutation();

  const fail = useCallback(
    (message: string) => {
      setPhase("idle");
      onError?.(message);
    },
    [onError],
  );

  const stop = useCallback(async () => {
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }
    if (phase !== "recording") return;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return fail(t("voice.noAudioCaptured"));

      setPhase("uploading");
      const ext = uri.split(".").pop()?.toLowerCase();
      const audioExt = (["m4a", "mp3", "wav", "webm", "ogg", "mp4"] as const).find((e) => e === ext) ?? "m4a";
      const contentType = audioExt === "webm" ? "audio/webm" : audioExt === "wav" ? "audio/wav" : "audio/mp4";

      const blob = await (await fetch(uri)).blob();
      const { storageKey, presignedUrl, maxBytes } = await initUpload.mutateAsync({ ext: audioExt, contentType, fileSize: blob.size || undefined });
      if (blob.size > maxBytes) return fail(t("voice.recordingTooLong"));

      const put = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
      if (!put.ok) return fail(t("voice.uploadFailed"));

      setPhase("transcribing");
      const result = await transcribe.mutateAsync({ storageKey, language });
      setPhase("idle");
      if (result.text) onResult(result.text);
      else fail(t("voice.nothingRecognized"));
    } catch (error) {
      fail(error instanceof Error ? error.message : t("voice.transcriptionFailed"));
    }
  }, [phase, recorder, initUpload, transcribe, language, onResult, fail, t]);

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return fail(t("voice.permissionDenied"));
      if (Platform.OS !== "web") {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
      autoStopTimer.current = setTimeout(() => void stop(), MAX_RECORDING_SECONDS * 1000);
    } catch (error) {
      fail(error instanceof Error ? error.message : t("voice.recordingFailed"));
    }
  }, [phase, recorder, fail, stop, t]);

  const cancel = useCallback(async () => {
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }
    if (phase === "recording") {
      try {
        await recorder.stop();
      } catch {
        // ignore — we are discarding the clip anyway
      }
    }
    setPhase("idle");
  }, [phase, recorder]);

  return {
    phase,
    isBusy: phase !== "idle",
    isRecording: phase === "recording",
    /** Seconds elapsed in the current recording. */
    seconds: Math.floor(recorderState.durationMillis / 1000),
    start,
    stop,
    cancel,
  };
}
