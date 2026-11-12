/**
 * P11 — react to push notifications on the client.
 *
 *   • Tap (background / killed → response): `router.push(data.route)`; the
 *     route is computed server-side (`pushRoute`) so copy and navigation stay
 *     in sync. The cold-start response is handled via `getLastNotificationResponseAsync`.
 *   • Foreground: Expo suppresses the system banner by default; we set a
 *     handler that shows it (iOS banner / Android heads-up) *and* surface an
 *     in-app toast with a tap-to-open action for web-like consistency.
 *
 * Native only. Safe when expo-notifications is unavailable (Expo Go Android).
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";

import { useToast } from "@/components/toast";
import { isSafeInternalRoute } from "@/lib/push-route";
import { trpc } from "@/lib/trpc";

type PushData = { route?: string; type?: string; mediaId?: number; albumId?: number; variant?: "A" | "B" };

export function usePushNavigation(enabled: boolean) {
  const router = useRouter();
  const toast = useToast();
  const handledIds = useRef(new Set<string>());
  // P13: report taps so the ops panel can compare copy variants (push_open metric).
  const opened = trpc.push.opened.useMutation();

  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    let subs: Array<{ remove: () => void }> = [];
    let cancelled = false;

    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        // Foreground: show the system banner too (default is silent in foreground).
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });

        const open = (data: PushData | undefined, id: string) => {
          if (handledIds.current.has(id)) return;
          handledIds.current.add(id);
          if (data?.type) opened.mutate({ type: data.type as never, variant: data.variant }, { onError: () => undefined });
          if (isSafeInternalRoute(data?.route)) router.push(data.route as never);
        };

        // Tap on a notification (app in background) or cold start.
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!cancelled && last) open(last.notification.request.content.data as PushData, last.notification.request.identifier);
        subs.push(Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data as PushData, r.notification.request.identifier)));

        // Received while in foreground → in-app banner with action.
        subs.push(
          Notifications.addNotificationReceivedListener((n) => {
            const data = n.request.content.data as PushData;
            const title = n.request.content.title ?? "金色韶华";
            const body = n.request.content.body ?? "";
            toast.show(body ? `${title} · ${body}` : title, {
              type: "info",
              duration: 5000,
              action: isSafeInternalRoute(data?.route) ? { label: "查看", onPress: () => router.push(data.route as never) } : undefined,
            });
          }),
        );
      } catch {
        /* expo-notifications unavailable (Expo Go Android) — ignore */
      }
    })();

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
      subs = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
