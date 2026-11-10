import { useEffect, useState, useCallback } from "react";
import { wsManager, RealtimeListener } from "@/lib/websocket-manager";
import { useAuth } from "./use-auth";

export function useWebSocket() {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    // 连接WebSocket
    const connectWebSocket = async () => {
      try {
        const wsUrl = process.env.EXPO_PUBLIC_WS_URL || "ws://localhost:3001";
        await wsManager.connect(wsUrl, String(user.id));
        setIsConnected(true);
      } catch (error) {
        console.error("Failed to connect WebSocket:", error);
      }
    };

    connectWebSocket();

    return () => {
      wsManager.disconnect();
    };
  }, [user?.id]);

  const subscribe = useCallback((listener: RealtimeListener) => {
    return wsManager.subscribe(listener);
  }, []);

  const sendMessage = useCallback((content: string, mentions: string[] = []) => {
    wsManager.emitMessage(content, mentions);
  }, []);

  const sendComment = useCallback(
    (mediaId: string, content: string, mentions: string[] = []) => {
      wsManager.emitComment(mediaId, content, mentions);
    },
    []
  );

  const sendReaction = useCallback((messageId: string, emoji: string) => {
    wsManager.emitReaction(messageId, emoji);
  }, []);

  const setTyping = useCallback((isTyping: boolean) => {
    wsManager.emitTyping(isTyping);
  }, []);

  return {
    isConnected,
    subscribe,
    sendMessage,
    sendComment,
    sendReaction,
    setTyping,
  };
}
