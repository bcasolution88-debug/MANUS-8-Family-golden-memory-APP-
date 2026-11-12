import { useMemo } from "react";

import { useAuth } from "@/hooks/use-auth";
import type { UnreadCount } from "@/lib/messaging-system";
import { trpc } from "@/lib/trpc";

const EMPTY: UnreadCount = { messages: 0, comments: 0, mentions: 0, total: 0 };

/**
 * Unread notification counts for the Tab-bar badge.
 *
 * Backed by `notification.unreadCount` (server/notifications.ts). Polls every
 * 30s while the app is in the foreground; mutations that change the feed
 * (markRead / markAllRead / delete) should `utils.notification.unreadCount.invalidate()`.
 * Returns zeros when signed out so the badge never shows stale mock numbers.
 */
export function useUnreadCount(): UnreadCount & { isLoading: boolean } {
  const { isAuthenticated } = useAuth();
  const query = trpc.notification.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  return useMemo(() => {
    if (!isAuthenticated || !query.data) return { ...EMPTY, isLoading: query.isLoading };
    const { total, comments, likes, mentions, messages } = query.data;
    return {
      total,
      comments,
      mentions,
      // Treat likes as "messages" for the legacy three-bucket shape used by callers.
      messages: messages + likes,
      isLoading: false,
    };
  }, [isAuthenticated, query.data, query.isLoading]);
}
