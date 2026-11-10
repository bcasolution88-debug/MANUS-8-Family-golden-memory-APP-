/**
 * 实时消息和通知中心管理模块
 * 支持WebSocket消息推送、消息分类、已读状态、快速操作
 */

export type NotificationType = "comment" | "like" | "share" | "mention" | "system";
export type NotificationStatus = "unread" | "read" | "archived";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  avatar?: string;
  relatedMediaId?: string;
  relatedUserId?: string;
  status: NotificationStatus;
  timestamp: number;
  actions?: NotificationAction[];
  metadata?: Record<string, any>;
}

export interface NotificationAction {
  id: string;
  label: string;
  action: "reply" | "like" | "share" | "view" | "dismiss";
  data?: Record<string, any>;
}

export interface NotificationGroup {
  type: NotificationType;
  count: number;
  unreadCount: number;
  lastNotification?: Notification;
}

class NotificationCenter {
  private notifications: Map<string, Notification> = new Map();
  private notificationListeners: Set<(notification: Notification) => void> = new Set();
  private statusListeners: Set<(status: NotificationStatus, id: string) => void> = new Set();
  private unreadCount = 0;

  /**
   * 添加通知
   */
  addNotification(notification: Omit<Notification, "id" | "timestamp" | "status">): Notification {
    const fullNotification: Notification = {
      ...notification,
      id: `notif_${Date.now()}`,
      timestamp: Date.now(),
      status: "unread",
    };

    this.notifications.set(fullNotification.id, fullNotification);
    this.unreadCount++;

    console.log(`Notification added: ${fullNotification.type} - ${fullNotification.title}`);
    this.notifyListeners(fullNotification);

    return fullNotification;
  }

  /**
   * 标记为已读
   */
  markAsRead(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (!notification || notification.status === "read") return;

    notification.status = "read";
    this.unreadCount--;

    console.log(`Notification marked as read: ${notificationId}`);
    this.notifyStatusListeners("read", notificationId);
  }

  /**
   * 批量标记为已读
   */
  markMultipleAsRead(notificationIds: string[]): void {
    notificationIds.forEach(id => this.markAsRead(id));
  }

  /**
   * 标记为已存档
   */
  markAsArchived(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (!notification) return;

    const wasUnread = notification.status === "unread";
    notification.status = "archived";
    if (wasUnread) {
      this.unreadCount--;
    }

    console.log(`Notification archived: ${notificationId}`);
    this.notifyStatusListeners("archived", notificationId);
  }

  /**
   * 获取所有通知
   */
  getAllNotifications(): Notification[] {
    return Array.from(this.notifications.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取未读通知
   */
  getUnreadNotifications(): Notification[] {
    return this.getAllNotifications().filter(n => n.status === "unread");
  }

  /**
   * 按类型获取通知
   */
  getNotificationsByType(type: NotificationType): Notification[] {
    return this.getAllNotifications().filter(n => n.type === type && n.status !== "archived");
  }

  /**
   * 获取通知分组
   */
  getNotificationGroups(): NotificationGroup[] {
    const types: NotificationType[] = ["comment", "like", "share", "mention", "system"];
    return types.map(type => {
      const notifications = this.getNotificationsByType(type);
      return {
        type,
        count: notifications.length,
        unreadCount: notifications.filter(n => n.status === "unread").length,
        lastNotification: notifications[0],
      };
    });
  }

  /**
   * 获取未读计数
   */
  getUnreadCount(): number {
    return this.unreadCount;
  }

  /**
   * 按类型获取未读计数
   */
  getUnreadCountByType(type: NotificationType): number {
    return this.getNotificationsByType(type).filter(n => n.status === "unread").length;
  }

  /**
   * 执行通知操作
   */
  executeAction(notificationId: string, actionId: string): void {
    const notification = this.notifications.get(notificationId);
    if (!notification) return;

    const action = notification.actions?.find(a => a.id === actionId);
    if (!action) return;

    console.log(`Executing action: ${actionId} on notification ${notificationId}`);

    switch (action.action) {
      case "reply":
        console.log("Reply action triggered");
        break;
      case "like":
        console.log("Like action triggered");
        break;
      case "share":
        console.log("Share action triggered");
        break;
      case "view":
        console.log("View action triggered");
        break;
      case "dismiss":
        this.markAsArchived(notificationId);
        break;
    }
  }

  /**
   * 删除通知
   */
  deleteNotification(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (!notification) return;

    if (notification.status === "unread") {
      this.unreadCount--;
    }

    this.notifications.delete(notificationId);
    console.log(`Notification deleted: ${notificationId}`);
  }

  /**
   * 清空所有通知
   */
  clearAllNotifications(): void {
    this.notifications.clear();
    this.unreadCount = 0;
    console.log("All notifications cleared");
  }

  /**
   * 清空已读通知
   */
  clearReadNotifications(): void {
    Array.from(this.notifications.entries()).forEach(([id, notification]) => {
      if (notification.status === "read") {
        this.notifications.delete(id);
      }
    });
    console.log("Read notifications cleared");
  }

  /**
   * 订阅新通知
   */
  onNotification(listener: (notification: Notification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  /**
   * 订阅状态变化
   */
  onStatusChanged(listener: (status: NotificationStatus, id: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(notification: Notification): void {
    this.notificationListeners.forEach(listener => listener(notification));
  }

  /**
   * 通知状态变化监听器
   */
  private notifyStatusListeners(status: NotificationStatus, id: string): void {
    this.statusListeners.forEach(listener => listener(status, id));
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalNotifications: number;
    unreadCount: number;
    byType: Record<NotificationType, number>;
    unreadByType: Record<NotificationType, number>;
  } {
    const byType: Record<NotificationType, number> = {
      comment: 0,
      like: 0,
      share: 0,
      mention: 0,
      system: 0,
    };

    const unreadByType: Record<NotificationType, number> = {
      comment: 0,
      like: 0,
      share: 0,
      mention: 0,
      system: 0,
    };

    this.notifications.forEach(notification => {
      byType[notification.type]++;
      if (notification.status === "unread") {
        unreadByType[notification.type]++;
      }
    });

    return {
      totalNotifications: this.notifications.size,
      unreadCount: this.unreadCount,
      byType,
      unreadByType,
    };
  }
}

// 导出单例
export const notificationCenter = new NotificationCenter();
