import { useCallback, useState, useEffect } from "react";
import { advancedSyncManager, SyncItem, SyncProgress, NetworkStatus } from "@/lib/advanced-sync-manager";

export function useAdvancedSync() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(
    advancedSyncManager.getNetworkStatus()
  );
  const [syncProgress, setSyncProgress] = useState<SyncProgress>(
    advancedSyncManager.getSyncProgress()
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingItems, setPendingItems] = useState(advancedSyncManager.getPendingItems());

  useEffect(() => {
    advancedSyncManager.initializeNetworkMonitoring();

    // 定期更新状态
    const interval = setInterval(() => {
      setNetworkStatus(advancedSyncManager.getNetworkStatus());
      setSyncProgress(advancedSyncManager.getSyncProgress());
      setPendingItems(advancedSyncManager.getPendingItems());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const addSyncItem = useCallback(
    (
      resourceType: string,
      resourceId: string,
      type: "create" | "update" | "delete" = "update",
      data?: Record<string, any>
    ) => {
      return advancedSyncManager.addSyncItem(resourceType, resourceId, type, data);
    },
    []
  );

  const sync = useCallback(
    async (syncFunction: (items: SyncItem[]) => Promise<Map<string, any>>) => {
      setIsSyncing(true);
      try {
        const progress = await advancedSyncManager.sync(syncFunction);
        setSyncProgress(progress);
        setPendingItems(advancedSyncManager.getPendingItems());
        return progress;
      } finally {
        setIsSyncing(false);
      }
    },
    []
  );

  const setAutoSync = useCallback((enabled: boolean) => {
    advancedSyncManager.setAutoSync(enabled);
  }, []);

  const resolveConflict = useCallback((itemId: string, resolution: "local" | "remote" | "merge") => {
    advancedSyncManager.resolveConflict(itemId, resolution);
  }, []);

  const getConflicts = useCallback(() => {
    return advancedSyncManager.getConflicts();
  }, []);

  const getStats = useCallback(() => {
    return advancedSyncManager.getStats();
  }, []);

  return {
    networkStatus,
    syncProgress,
    isSyncing,
    pendingItems,
    addSyncItem,
    sync,
    setAutoSync,
    resolveConflict,
    getConflicts,
    getStats,
  };
}
