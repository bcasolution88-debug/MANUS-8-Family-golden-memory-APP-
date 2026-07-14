import { useEffect, useState, useCallback } from "react";
import {
  getSyncQueue,
  syncPendingItems,
  getPendingSyncCount,
  SyncItem,
} from "@/lib/sync-manager";

export function useSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // 检查网络连接状态（简化实现）
  const checkNetworkStatus = useCallback(async () => {
    try {
      // 简单的网络检查：尝试获取一个小资源
      const response = await fetch("https://www.google.com/favicon.ico", {
        method: "HEAD",
        mode: "no-cors",
      });
      setIsOnline(true);
    } catch (error) {
      setIsOnline(false);
    }
  }, []);

  // 获取待同步项数量
  const updatePendingCount = useCallback(async () => {
    try {
      const count = await getPendingSyncCount();
      setPendingCount(count);
    } catch (error) {
      console.error("Failed to update pending count:", error);
    }
  }, []);

  // 同步待处理项
  const performSync = useCallback(
    async (syncFunction: (item: SyncItem) => Promise<void>) => {
      if (isSyncing) return;

      setIsSyncing(true);
      try {
        await syncPendingItems(syncFunction);
        await updatePendingCount();
      } catch (error) {
        console.error("Sync failed:", error);
      } finally {
        setIsSyncing(false);
      }
    },
    [isSyncing, updatePendingCount]
  );

  // 初始化网络监听
  useEffect(() => {
    checkNetworkStatus();
    updatePendingCount();

    // 定期检查网络状态
    const interval = setInterval(checkNetworkStatus, 5000);

    return () => clearInterval(interval);
  }, [checkNetworkStatus, updatePendingCount]);

  // 当网络恢复时自动同步
  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      // 这里应该调用实际的同步函数
      // performSync(actualSyncFunction);
    }
  }, [isOnline, pendingCount]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    checkNetworkStatus,
    updatePendingCount,
    performSync,
  };
}
