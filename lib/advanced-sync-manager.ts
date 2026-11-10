/**
 * 高级离线同步管理模块
 * 实现网络状态监听、自动同步触发、同步冲突解决、进度显示
 */

export type NetworkStatus = "online" | "offline" | "slow" | "unknown";
export type SyncConflictResolution = "local" | "remote" | "merge" | "manual";

export interface SyncItem {
  id: string;
  type: "create" | "update" | "delete";
  resourceType: string;
  resourceId: string;
  data: Record<string, any>;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  synced: boolean;
  conflictResolution?: SyncConflictResolution;
}

export interface SyncProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
  currentItem?: string;
  estimatedTime?: number;
}

export interface ConflictInfo {
  localVersion: SyncItem;
  remoteVersion: Record<string, any>;
  resolution: SyncConflictResolution;
}

class AdvancedSyncManager {
  private syncQueue: Map<string, SyncItem> = new Map();
  private networkStatus: NetworkStatus = "unknown";
  private isOnline = true;
  private isSyncing = false;
  private syncProgress: SyncProgress = {
    total: 0,
    completed: 0,
    failed: 0,
    percentage: 0,
  };
  private conflicts: Map<string, ConflictInfo> = new Map();
  private lastSyncTime = 0;
  private autoSyncEnabled = true;
  private syncInterval: ReturnType<typeof setTimeout> | null = null;

  /**
   * 初始化网络监听
   */
  initializeNetworkMonitoring(): void {
    // 模拟网络状态监听
    setInterval(() => {
      this.updateNetworkStatus();
    }, 5000);

    console.log("Network monitoring initialized");
  }

  /**
   * 更新网络状态
   */
  private updateNetworkStatus(): void {
    // 模拟网络状态检查
    const wasOnline = this.isOnline;
    this.isOnline = Math.random() > 0.1; // 90%在线

    if (wasOnline && !this.isOnline) {
      console.log("Network went offline");
      this.networkStatus = "offline";
    } else if (!wasOnline && this.isOnline) {
      console.log("Network came online");
      this.networkStatus = "online";
      // 自动同步
      if (this.autoSyncEnabled) {
        this.triggerAutoSync();
      }
    } else if (this.isOnline) {
      // 检查网络速度
      this.networkStatus = Math.random() > 0.8 ? "slow" : "online";
    }
  }

  /**
   * 获取网络状态
   */
  getNetworkStatus(): NetworkStatus {
    return this.networkStatus;
  }

  /**
   * 检查是否在线
   */
  isOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * 添加同步项
   */
  addSyncItem(
    resourceType: string,
    resourceId: string,
    type: "create" | "update" | "delete" = "update",
    data: Record<string, any> = {}
  ): SyncItem {
    const item: SyncItem = {
      id: `sync_${Date.now()}`,
      type,
      resourceType,
      resourceId,
      data,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: 3,
      synced: false,
    };

    this.syncQueue.set(item.id, item);
    console.log(`Sync item added: ${item.id}`);

    // 如果在线，立即触发同步
    if (this.isOnline && this.autoSyncEnabled) {
      this.triggerAutoSync();
    }

    return item;
  }

  /**
   * 获取待同步项
   */
  getPendingItems(): SyncItem[] {
    return Array.from(this.syncQueue.values())
      .filter(item => !item.synced && item.retryCount < item.maxRetries)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 执行同步
   */
  async sync(
    syncFunction: (items: SyncItem[]) => Promise<Map<string, any>>
  ): Promise<SyncProgress> {
    if (this.isSyncing || !this.isOnline) {
      return this.syncProgress;
    }

    this.isSyncing = true;

    try {
      const pending = this.getPendingItems();

      if (pending.length === 0) {
        console.log("No items to sync");
        return this.syncProgress;
      }

      this.syncProgress = {
        total: pending.length,
        completed: 0,
        failed: 0,
        percentage: 0,
      };

      console.log(`Starting sync of ${pending.length} items...`);

      // 执行同步
      const results = await syncFunction(pending);

      // 处理结果
      for (const item of pending) {
        if (results.has(item.id)) {
          const result = results.get(item.id);

          if (result.success) {
            item.synced = true;
            item.retryCount = 0;
            this.syncProgress.completed++;
          } else if (result.conflict) {
            // 处理冲突
            this.handleConflict(item, result.remoteVersion);
          } else {
            item.retryCount++;
            this.syncProgress.failed++;
          }
        }
      }

      this.syncProgress.percentage = Math.round(
        (this.syncProgress.completed / this.syncProgress.total) * 100
      );
      this.lastSyncTime = Date.now();

      console.log("Sync completed");
      return this.syncProgress;
    } catch (error) {
      console.error("Sync failed:", error);
      this.syncProgress.failed = this.syncProgress.total - this.syncProgress.completed;
      return this.syncProgress;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 处理同步冲突
   */
  private handleConflict(
    localItem: SyncItem,
    remoteVersion: Record<string, any>
  ): void {
    const conflictInfo: ConflictInfo = {
      localVersion: localItem,
      remoteVersion,
      resolution: "manual", // 默认需要手动解决
    };

    // 尝试自动解决
    if (this.canAutoResolveConflict(localItem, remoteVersion)) {
      conflictInfo.resolution = "merge";
      localItem.conflictResolution = "merge";
      localItem.synced = true;
    }

    this.conflicts.set(localItem.id, conflictInfo);
    console.log(`Conflict detected for item ${localItem.id}`);
  }

  /**
   * 检查是否可以自动解决冲突
   */
  private canAutoResolveConflict(
    localItem: SyncItem,
    remoteVersion: Record<string, any>
  ): boolean {
    // 简单的冲突解决策略：如果是删除操作，远程版本更新时间更晚，则使用远程版本
    if (localItem.type === "delete") {
      return true;
    }

    // 如果本地版本更新时间更晚，使用本地版本
    if (localItem.timestamp > (remoteVersion.timestamp || 0)) {
      return true;
    }

    return false;
  }

  /**
   * 手动解决冲突
   */
  resolveConflict(itemId: string, resolution: SyncConflictResolution): void {
    const conflict = this.conflicts.get(itemId);
    if (conflict) {
      conflict.resolution = resolution;
      conflict.localVersion.conflictResolution = resolution;

      if (resolution !== "manual") {
        conflict.localVersion.synced = true;
      }

      console.log(`Conflict resolved for item ${itemId}: ${resolution}`);
    }
  }

  /**
   * 获取冲突列表
   */
  getConflicts(): ConflictInfo[] {
    return Array.from(this.conflicts.values()).filter(
      c => c.resolution === "manual"
    );
  }

  /**
   * 触发自动同步
   */
  private triggerAutoSync(): void {
    if (this.syncInterval) {
      clearTimeout(this.syncInterval);
    }

    this.syncInterval = setTimeout(() => {
      console.log("Auto sync triggered");
      // 实际同步由外部调用
    }, 2000);
  }

  /**
   * 启用/禁用自动同步
   */
  setAutoSync(enabled: boolean): void {
    this.autoSyncEnabled = enabled;
    console.log(`Auto sync ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * 获取同步进度
   */
  getSyncProgress(): SyncProgress {
    return this.syncProgress;
  }

  /**
   * 获取最后同步时间
   */
  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  /**
   * 清空同步队列
   */
  clearQueue(): void {
    this.syncQueue.clear();
    this.conflicts.clear();
    console.log("Sync queue cleared");
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    networkStatus: NetworkStatus;
    isOnline: boolean;
    isSyncing: boolean;
    pendingItems: number;
    conflicts: number;
    lastSyncTime: number;
  } {
    return {
      networkStatus: this.networkStatus,
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingItems: this.getPendingItems().length,
      conflicts: this.getConflicts().length,
      lastSyncTime: this.lastSyncTime,
    };
  }
}

// 导出单例
export const advancedSyncManager = new AdvancedSyncManager();
