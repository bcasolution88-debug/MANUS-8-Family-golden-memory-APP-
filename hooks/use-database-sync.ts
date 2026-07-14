import { useEffect, useState, useCallback } from "react";
import { databaseSync, SyncStatus, SyncConflict } from "@/lib/database-sync";

export function useDatabaseSync() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(databaseSync.getSyncStatus());
  const [conflicts, setConflicts] = useState<SyncConflict[]>(databaseSync.getConflicts());

  useEffect(() => {
    // 初始化同步
    databaseSync.initialize();

    // 订阅同步状态变化
    const unsubscribeSync = databaseSync.onSyncStatusChanged(status => {
      setSyncStatus(status);
    });

    // 订阅冲突检测
    const unsubscribeConflict = databaseSync.onConflictDetected(conflict => {
      setConflicts(prev => [...prev, conflict]);
    });

    return () => {
      unsubscribeSync();
      unsubscribeConflict();
    };
  }, []);

  const performSync = useCallback(async () => {
    await databaseSync.performSync();
  }, []);

  const addSyncEvent = useCallback(
    (
      type: "create" | "update" | "delete",
      entityType: string,
      entityId: string,
      data: Record<string, any>,
      userId: string,
      deviceId: string
    ) => {
      return databaseSync.addSyncEvent(type, entityType, entityId, data, userId, deviceId);
    },
    []
  );

  const resolveConflict = useCallback(
    (conflictId: string, resolution: "local" | "remote" | "merge", mergedData?: Record<string, any>) => {
      databaseSync.resolveConflict(conflictId, resolution, mergedData);
    },
    []
  );

  const getPendingEvents = useCallback(() => {
    return databaseSync.getPendingEvents();
  }, []);

  const setOnlineStatus = useCallback((isOnline: boolean) => {
    databaseSync.setOnlineStatus(isOnline);
  }, []);

  const getSyncStats = useCallback(() => {
    return databaseSync.getSyncStats();
  }, []);

  return {
    syncStatus,
    conflicts,
    performSync,
    addSyncEvent,
    resolveConflict,
    getPendingEvents,
    setOnlineStatus,
    getSyncStats,
  };
}
