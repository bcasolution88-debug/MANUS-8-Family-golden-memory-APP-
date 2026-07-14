import { useCallback, useState, useEffect } from "react";
import { realtimeWebSocket, RealtimeMessage, ConnectionStatus } from "@/lib/realtime-websocket";

export function useRealtimeWebSocket() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    realtimeWebSocket.getConnectionStatus()
  );
  const [messageQueue, setMessageQueue] = useState<RealtimeMessage[]>(
    realtimeWebSocket.getMessageQueue()
  );

  useEffect(() => {
    // 订阅连接状态变化
    const unsubscribe = realtimeWebSocket.onConnectionChange(connected => {
      setConnectionStatus(realtimeWebSocket.getConnectionStatus());
    });

    // 定期更新状态
    const interval = setInterval(() => {
      setConnectionStatus(realtimeWebSocket.getConnectionStatus());
      setMessageQueue(realtimeWebSocket.getMessageQueue());
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const connect = useCallback(async (userId: string, familyId: string) => {
    await realtimeWebSocket.connect(userId, familyId);
    setConnectionStatus(realtimeWebSocket.getConnectionStatus());
  }, []);

  const disconnect = useCallback(() => {
    realtimeWebSocket.disconnect();
    setConnectionStatus(realtimeWebSocket.getConnectionStatus());
  }, []);

  const sendMessage = useCallback(
    async (message: Omit<RealtimeMessage, "id" | "timestamp">) => {
      await realtimeWebSocket.sendMessage(message);
      setMessageQueue(realtimeWebSocket.getMessageQueue());
    },
    []
  );

  const subscribe = useCallback(
    (messageType: string, handler: (message: RealtimeMessage) => void) => {
      return realtimeWebSocket.subscribe(messageType, handler);
    },
    []
  );

  const clearMessageQueue = useCallback(() => {
    realtimeWebSocket.clearMessageQueue();
    setMessageQueue([]);
  }, []);

  const getStats = useCallback(() => {
    return realtimeWebSocket.getStats();
  }, []);

  return {
    connectionStatus,
    messageQueue,
    connect,
    disconnect,
    sendMessage,
    subscribe,
    clearMessageQueue,
    getStats,
  };
}
