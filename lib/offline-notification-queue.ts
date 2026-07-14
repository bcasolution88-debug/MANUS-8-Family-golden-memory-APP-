/**
 * 离线通知队列管理模块
 * 实现本地通知存储、后台同步、通知去重、优先级排序
 */

export type NotificationPriority = "high" | "medium" | "low";

export interface QueuedNotification {
  id: string;
  notificationId: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  synced: boolean;
  syncedAt?: number;
  metadata?: Record<string, any>;
}

export interface SyncStats {
  totalQueued: number;
  totalSynced: number;
  totalFailed: number;
  lastSyncTime?: number;
  pendingSync: number;
}

class OfflineNotificationQueue {
  private queue: Map<string, QueuedNotification> = new Map();
  private syncedNotifications: Set<string> = new Set();
  private failedNotifications: Map<string, number> = new Map();
  private lastSyncTime: number = 0;
  private isSyncing = false;

  /**
   * 添加通知到队列
   */
  enqueue(
    notificationId: string,
    title: string,
    message: string,
    priority: NotificationPriority = "medium",
    metadata?: Record<string, any>
  ): QueuedNotification {
    // 检查去重
    const existingNotification = Array.from(this.queue.values()).find(
      n => n.notificationId === notificationId && !n.synced
    );

    if (existingNotification) {
      console.log(`Notification already in queue: ${notificationId}`);
      return existingNotification;
    }

    const queued: QueuedNotification = {
      id: `queued_${Date.now()}`,
      notificationId,
      title,
      message,
      priority,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: 3,
      synced: false,
      metadata,
    };

    this.queue.set(queued.id, queued);
    console.log(`Notification enqueued: ${queued.id}`);

    return queued;
  }

  /**
   * 从队列中移除通知
   */
  dequeue(queuedId: string): QueuedNotification | undefined {
    const notification = this.queue.get(queuedId);
    if (notification) {
      this.queue.delete(queuedId);
      console.log(`Notification dequeued: ${queuedId}`);
    }
    return notification;
  }

  /**
   * 获取待同步的通知（按优先级排序）
   */
  getPendingNotifications(): QueuedNotification[] {
    const pending = Array.from(this.queue.values())
      .filter(n => !n.synced && n.retryCount < n.maxRetries)
      .sort((a, b) => {
        // 按优先级排序
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;

        // 同优先级按时间排序
        return a.timestamp - b.timestamp;
      });

    return pending;
  }

  /**
   * 标记通知为已同步
   */
  markAsSynced(queuedId: string): void {
    const notification = this.queue.get(queuedId);
    if (notification) {
      notification.synced = true;
      notification.syncedAt = Date.now();
      this.syncedNotifications.add(queuedId);
      this.failedNotifications.delete(queuedId);
      console.log(`Notification marked as synced: ${queuedId}`);
    }
  }

  /**
   * 标记通知同步失败
   */
  markAsFailed(queuedId: string): void {
    const notification = this.queue.get(queuedId);
    if (notification) {
      notification.retryCount++;
      this.failedNotifications.set(queuedId, notification.retryCount);
      console.log(`Notification marked as failed: ${queuedId} (retry ${notification.retryCount})`);
    }
  }

  /**
   * 执行同步
   */
  async sync(syncFunction: (notifications: QueuedNotification[]) => Promise<void>): Promise<SyncStats> {
    if (this.isSyncing) {
      console.log("Sync already in progress");
      return this.getStats();
    }

    this.isSyncing = true;

    try {
      const pending = this.getPendingNotifications();

      if (pending.length === 0) {
        console.log("No pending notifications to sync");
        return this.getStats();
      }

      console.log(`Syncing ${pending.length} notifications...`);

      // 模拟同步
      await syncFunction(pending);

      // 标记为已同步
      pending.forEach(notification => {
        this.markAsSynced(notification.id);
      });

      this.lastSyncTime = Date.now();
      console.log("Sync completed successfully");

      return this.getStats();
    } catch (error) {
      console.error("Sync failed:", error);

      // 标记失败
      const pending = this.getPendingNotifications();
      pending.forEach(notification => {
        this.markAsFailed(notification.id);
      });

      return this.getStats();
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 获取所有队列中的通知
   */
  getAllNotifications(): QueuedNotification[] {
    return Array.from(this.queue.values());
  }

  /**
   * 获取待同步的通知数量
   */
  getPendingCount(): number {
    return this.getPendingNotifications().length;
  }

  /**
   * 获取已同步的通知数量
   */
  getSyncedCount(): number {
    return this.syncedNotifications.size;
  }

  /**
   * 获取失败的通知数量
   */
  getFailedCount(): number {
    return this.failedNotifications.size;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue.clear();
    this.syncedNotifications.clear();
    this.failedNotifications.clear();
    console.log("Notification queue cleared");
  }

  /**
   * 清空已同步的通知
   */
  clearSynced(): void {
    const syncedIds = Array.from(this.syncedNotifications);
    syncedIds.forEach(id => this.queue.delete(id));
    this.syncedNotifications.clear();
    console.log("Synced notifications cleared");
  }

  /**
   * 清空失败的通知
   */
  clearFailed(): void {
    const failedIds = Array.from(this.failedNotifications.keys());
    failedIds.forEach(id => {
      const notification = this.queue.get(id);
      if (notification && notification.retryCount >= notification.maxRetries) {
        this.queue.delete(id);
      }
    });
    this.failedNotifications.clear();
    console.log("Failed notifications cleared");
  }

  /**
   * 获取统计信息
   */
  getStats(): SyncStats {
    return {
      totalQueued: this.queue.size,
      totalSynced: this.syncedNotifications.size,
      totalFailed: this.failedNotifications.size,
      lastSyncTime: this.lastSyncTime,
      pendingSync: this.getPendingCount(),
    };
  }

  /**
   * 获取详细的队列信息
   */
  getQueueInfo(): {
    pending: QueuedNotification[];
    synced: QueuedNotification[];
    failed: QueuedNotification[];
  } {
    const all = Array.from(this.queue.values());

    return {
      pending: all.filter(n => !n.synced && n.retryCount < n.maxRetries),
      synced: all.filter(n => n.synced),
      failed: all.filter(n => n.retryCount >= n.maxRetries),
    };
  }

  /**
   * 重试失败的通知
   */
  retryFailed(): void {
    const failed = Array.from(this.queue.values()).filter(
      n => n.retryCount >= n.maxRetries
    );

    failed.forEach(notification => {
      notification.retryCount = 0;
      this.failedNotifications.delete(notification.id);
      console.log(`Retrying failed notification: ${notification.id}`);
    });
  }

  /**
   * 检查是否正在同步
   */
  isSyncInProgress(): boolean {
    return this.isSyncing;
  }

  /**
   * 获取最后同步时间
   */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }
}

// 导出单例
export const offlineNotificationQueue = new OfflineNotificationQueue();
