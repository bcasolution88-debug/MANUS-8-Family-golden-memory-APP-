import { useCallback, useState, useEffect } from "react";
import { offlineNotificationQueue, QueuedNotification, SyncStats, NotificationPriority } from "@/lib/offline-notification-queue";

export function useOfflineNotificationQueue() {
  const [stats, setStats] = useState<SyncStats>(offlineNotificationQueue.getStats());
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // 定期更新统计信息
    const interval = setInterval(() => {
      setStats(offlineNotificationQueue.getStats());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const enqueue = useCallback(
    (
      notificationId: string,
      title: string,
      message: string,
      priority?: NotificationPriority,
      metadata?: Record<string, any>
    ) => {
      const queued = offlineNotificationQueue.enqueue(notificationId, title, message, priority, metadata);
      setStats(offlineNotificationQueue.getStats());
      return queued;
    },
    []
  );

  const dequeue = useCallback((queuedId: string) => {
    const notification = offlineNotificationQueue.dequeue(queuedId);
    setStats(offlineNotificationQueue.getStats());
    return notification;
  }, []);

  const getPendingNotifications = useCallback(() => {
    return offlineNotificationQueue.getPendingNotifications();
  }, []);

  const markAsSynced = useCallback((queuedId: string) => {
    offlineNotificationQueue.markAsSynced(queuedId);
    setStats(offlineNotificationQueue.getStats());
  }, []);

  const markAsFailed = useCallback((queuedId: string) => {
    offlineNotificationQueue.markAsFailed(queuedId);
    setStats(offlineNotificationQueue.getStats());
  }, []);

  const sync = useCallback(
    async (syncFunction: (notifications: QueuedNotification[]) => Promise<void>) => {
      setIsSyncing(true);
      try {
        const result = await offlineNotificationQueue.sync(syncFunction);
        setStats(result);
        return result;
      } finally {
        setIsSyncing(false);
      }
    },
    []
  );

  const getAllNotifications = useCallback(() => {
    return offlineNotificationQueue.getAllNotifications();
  }, []);

  const getPendingCount = useCallback(() => {
    return offlineNotificationQueue.getPendingCount();
  }, []);

  const getSyncedCount = useCallback(() => {
    return offlineNotificationQueue.getSyncedCount();
  }, []);

  const getFailedCount = useCallback(() => {
    return offlineNotificationQueue.getFailedCount();
  }, []);

  const clear = useCallback(() => {
    offlineNotificationQueue.clear();
    setStats(offlineNotificationQueue.getStats());
  }, []);

  const clearSynced = useCallback(() => {
    offlineNotificationQueue.clearSynced();
    setStats(offlineNotificationQueue.getStats());
  }, []);

  const clearFailed = useCallback(() => {
    offlineNotificationQueue.clearFailed();
    setStats(offlineNotificationQueue.getStats());
  }, []);

  const getQueueInfo = useCallback(() => {
    return offlineNotificationQueue.getQueueInfo();
  }, []);

  const retryFailed = useCallback(() => {
    offlineNotificationQueue.retryFailed();
    setStats(offlineNotificationQueue.getStats());
  }, []);

  const getLastSyncTime = useCallback(() => {
    return offlineNotificationQueue.getLastSyncTime();
  }, []);

  return {
    stats,
    isSyncing,
    enqueue,
    dequeue,
    getPendingNotifications,
    markAsSynced,
    markAsFailed,
    sync,
    getAllNotifications,
    getPendingCount,
    getSyncedCount,
    getFailedCount,
    clear,
    clearSynced,
    clearFailed,
    getQueueInfo,
    retryFailed,
    getLastSyncTime,
  };
}
