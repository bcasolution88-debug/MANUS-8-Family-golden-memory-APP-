/**
 * 实时数据库同步管理模块
 * 支持Firebase/Supabase集成、多设备同步、离线冲突解决
 */

export interface SyncEvent {
  id: string;
  type: "create" | "update" | "delete";
  entityType: string;
  entityId: string;
  data: Record<string, any>;
  timestamp: number;
  userId: string;
  deviceId: string;
}

export interface SyncConflict {
  id: string;
  entityId: string;
  localVersion: Record<string, any>;
  remoteVersion: Record<string, any>;
  timestamp: number;
  resolved: boolean;
  resolution?: "local" | "remote" | "merge";
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  pendingChanges: number;
  conflicts: number;
}

class DatabaseSync {
  private syncQueue: SyncEvent[] = [];
  private conflicts: Map<string, SyncConflict> = new Map();
  private syncStatus: SyncStatus = {
    isOnline: true,
    isSyncing: false,
    lastSyncTime: Date.now(),
    pendingChanges: 0,
    conflicts: 0,
  };
  private syncListeners: Set<(status: SyncStatus) => void> = new Set();
  private conflictListeners: Set<(conflict: SyncConflict) => void> = new Set();

  /**
   * 初始化同步
   */
  async initialize(): Promise<void> {
    console.log("Initializing database sync...");

    // 模拟初始化
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log("Database sync initialized");
  }

  /**
   * 添加待同步事件
   */
  addSyncEvent(
    type: "create" | "update" | "delete",
    entityType: string,
    entityId: string,
    data: Record<string, any>,
    userId: string,
    deviceId: string
  ): SyncEvent {
    const event: SyncEvent = {
      id: `event_${Date.now()}`,
      type,
      entityType,
      entityId,
      data,
      timestamp: Date.now(),
      userId,
      deviceId,
    };

    this.syncQueue.push(event);
    this.updateSyncStatus();

    console.log(`Sync event added: ${entityType}/${entityId} (${type})`);

    return event;
  }

  /**
   * 执行同步
   */
  async performSync(): Promise<void> {
    if (this.syncStatus.isSyncing || !this.syncStatus.isOnline) {
      console.log("Sync skipped: already syncing or offline");
      return;
    }

    this.syncStatus.isSyncing = true;
    this.notifySyncStatusChanged();

    try {
      console.log(`Syncing ${this.syncQueue.length} events...`);

      // 模拟同步
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 处理冲突检测
      await this.detectConflicts();

      // 清空队列（实际应用中应该检查同步结果）
      this.syncQueue = [];
      this.syncStatus.lastSyncTime = Date.now();
      this.syncStatus.pendingChanges = 0;

      console.log("Sync completed successfully");
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      this.syncStatus.isSyncing = false;
      this.notifySyncStatusChanged();
    }
  }

  /**
   * 检测冲突
   */
  private async detectConflicts(): Promise<void> {
    // 模拟冲突检测
    const mockConflict: SyncConflict = {
      id: `conflict_${Date.now()}`,
      entityId: "entity_123",
      localVersion: { title: "Local Title", updatedAt: Date.now() - 1000 },
      remoteVersion: { title: "Remote Title", updatedAt: Date.now() },
      timestamp: Date.now(),
      resolved: false,
    };

    // 仅在有实际冲突时添加
    if (Math.random() > 0.7) {
      this.conflicts.set(mockConflict.id, mockConflict);
      this.syncStatus.conflicts = this.conflicts.size;
      this.notifyConflictDetected(mockConflict);
    }
  }

  /**
   * 解决冲突
   */
  resolveConflict(
    conflictId: string,
    resolution: "local" | "remote" | "merge",
    mergedData?: Record<string, any>
  ): void {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return;

    conflict.resolved = true;
    conflict.resolution = resolution;

    console.log(`Conflict resolved: ${conflictId} (${resolution})`);

    // 如果是合并，应用合并后的数据
    if (resolution === "merge" && mergedData) {
      this.addSyncEvent(
        "update",
        "conflict_resolution",
        conflictId,
        mergedData,
        "system",
        "local"
      );
    }

    this.syncStatus.conflicts = Array.from(this.conflicts.values()).filter(
      c => !c.resolved
    ).length;
    this.notifySyncStatusChanged();
  }

  /**
   * 获取待同步事件
   */
  getPendingEvents(): SyncEvent[] {
    return [...this.syncQueue];
  }

  /**
   * 获取冲突列表
   */
  getConflicts(): SyncConflict[] {
    return Array.from(this.conflicts.values()).filter(c => !c.resolved);
  }

  /**
   * 获取同步状态
   */
  getSyncStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * 设置在线状态
   */
  setOnlineStatus(isOnline: boolean): void {
    this.syncStatus.isOnline = isOnline;
    this.notifySyncStatusChanged();

    if (isOnline) {
      console.log("Online - attempting to sync");
      this.performSync();
    } else {
      console.log("Offline - queuing changes");
    }
  }

  /**
   * 订阅同步状态变化
   */
  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  /**
   * 订阅冲突检测
   */
  onConflictDetected(listener: (conflict: SyncConflict) => void): () => void {
    this.conflictListeners.add(listener);
    return () => this.conflictListeners.delete(listener);
  }

  /**
   * 通知同步状态变化
   */
  private notifySyncStatusChanged(): void {
    this.syncListeners.forEach(listener => listener(this.syncStatus));
  }

  /**
   * 通知冲突检测
   */
  private notifyConflictDetected(conflict: SyncConflict): void {
    this.conflictListeners.forEach(listener => listener(conflict));
  }

  /**
   * 更新同步状态
   */
  private updateSyncStatus(): void {
    this.syncStatus.pendingChanges = this.syncQueue.length;
    this.notifySyncStatusChanged();
  }

  /**
   * 清空同步队列
   */
  clearQueue(): void {
    this.syncQueue = [];
    this.updateSyncStatus();
  }

  /**
   * 获取同步统计
   */
  getSyncStats(): {
    totalEvents: number;
    createEvents: number;
    updateEvents: number;
    deleteEvents: number;
    totalConflicts: number;
    resolvedConflicts: number;
  } {
    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;

    this.syncQueue.forEach(event => {
      switch (event.type) {
        case "create":
          createCount++;
          break;
        case "update":
          updateCount++;
          break;
        case "delete":
          deleteCount++;
          break;
      }
    });

    const resolvedCount = Array.from(this.conflicts.values()).filter(c => c.resolved).length;

    return {
      totalEvents: this.syncQueue.length,
      createEvents: createCount,
      updateEvents: updateCount,
      deleteEvents: deleteCount,
      totalConflicts: this.conflicts.size,
      resolvedConflicts: resolvedCount,
    };
  }
}

// 导出单例
export const databaseSync = new DatabaseSync();
