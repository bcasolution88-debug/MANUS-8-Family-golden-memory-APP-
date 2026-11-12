/**
 * P10 — register this device for Expo Push once the user is signed in.
 *
 * Native only (web has no Expo push token). Asks permission lazily, obtains
 * the Expo token, posts it to `push.register`, and re-registers after the
 * token changes. Exposes `unregister()` for sign-out. Safe to mount even
 * when expo-notifications is unavailable (Expo Go on Android SDK 53+):
 * every failure is swallowed and reported through `error`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";

import { trpc } from "@/lib/trpc";

type Status = "idle" | "unsupported" | "denied" | "registering" | "registered" | "error";

const PLATFORM = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  // Lazy import keeps web bundles free of native-only code and lets Expo Go
  // (where remote push is unsupported) fail gracefully.
  const Notifications = await import("expo-notifications");
  const settings = await Notifications.getPermissionsAsync();
  let granted = settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }
  if (!granted) throw Object.assign(new Error("Notification permission denied"), { code: "denied" });
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "金色韶华",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return data;
}

export function usePushRegistration(enabled: boolean) {
  const [status, setStatus] = useState<Status>(Platform.OS === "web" ? "unsupported" : "idle");
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const register = trpc.push.register.useMutation();
  const unregisterMutation = trpc.push.unregister.useMutation();

  useEffect(() => {
    if (!enabled || Platform.OS === "web" || status === "registered" || status === "registering") return;
    let cancelled = false;
    setStatus("registering");
    (async () => {
      try {
        const token = await getExpoPushToken();
        if (cancelled || !token) {
          if (!cancelled) setStatus("unsupported");
          return;
        }
        tokenRef.current = token;
        await register.mutateAsync({ token, platform: PLATFORM, deviceName: Constants.deviceName ?? undefined });
        if (!cancelled) setStatus("registered");
      } catch (e) {
        if (cancelled) return;
        const code = (e as { code?: string }).code;
        setStatus(code === "denied" ? "denied" : "error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const unregister = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      await unregisterMutation.mutateAsync({ token });
    } catch {
      /* best-effort */
    } finally {
      tokenRef.current = null;
      setStatus("idle");
    }
  }, [unregisterMutation]);

  return { status, error, unregister, token: tokenRef.current };
}
