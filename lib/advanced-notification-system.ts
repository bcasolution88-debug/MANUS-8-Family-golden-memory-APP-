/**
 * 高级通知系统
 * 实现通知分组聚合、智能去重、优先级显示、快速操作
 */

export type NotificationPriority = "high" | "medium" | "low";
export type NotificationType = "comment" | "like" | "share" | "mention" | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  actor: {
    id: string;
    name: string;
    avatar?: string;
  };
  resource: {
    type: string;
    id: string;
    title?: string;
    thumbnail?: string;
  };
  timestamp: number;
  read: boolean;
  actionUrl?: string;
  quickActions?: QuickAction[];
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  action: () => void | Promise<void>;
}

export interface NotificationGroup {
  id: string;
  type: NotificationType;
  count: number;
  priority: NotificationPriority;
  latestNotification: Notification;
  notifications: Notification[];
  aggregatedMessage: string;
}

export interface NotificationStats {
  total: number;
  unread: number;
  byType: Record<NotificationType, number>;
  byPriority: Record<NotificationPriority, number>;
  groups: number;
}

class AdvancedNotificationSystem {
  private notifications: Map<string, Notification> = new Map();
  private groups: Map<string, NotificationGroup> = new Map();
  private deduplicationCache: Map<string, string> = new Map(); // 用于去重
  private maxNotifications = 1000;

  /**
   * 添加通知
   */
  addNotification(notification: Notification): Notification {
    // 检查去重
    const deduplicationKey = this.getDeduplicationKey(notification);
    if (this.deduplicationCache.has(deduplicationKey)) {
      console.log(`Notification deduplicated: ${deduplicationKey}`);
      return notification;
    }

    this.notifications.set(notification.id, notification);
    this.deduplicationCache.set(deduplicationKey, notification.id);

    // 限制通知数量
    if (this.notifications.size > this.maxNotifications) {
      const oldestId = Array.from(this.notifications.values())
        .sort((a, b) => a.timestamp - b.timestamp)[0]?.id;
      if (oldestId) {
        this.notifications.delete(oldestId);
      }
    }

    // 更新分组
    this.updateGroups();

    console.log(`Notification added: ${notification.id}`);
    return notification;
  }

  /**
   * 获取去重键
   */
  private getDeduplicationKey(notification: Notification): string {
    return `${notification.type}_${notification.actor.id}_${notification.resource.id}_${Math.floor(
      notification.timestamp / 60000
    )}`;
  }

  /**
   * 更新分组
   */
  private updateGroups(): void {
    this.groups.clear();

    const notificationsByType = this.groupByType();

    for (const [type, notifications] of Object.entries(notificationsByType)) {
      // 按优先级排序
      const sorted = (notifications as Notification[]).sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      // 按相同资源分组
      const resourceGroups = new Map<string, Notification[]>();
      for (const notification of sorted) {
        const key = `${notification.resource.type}_${notification.resource.id}`;
        if (!resourceGroups.has(key)) {
          resourceGroups.set(key, []);
        }
        resourceGroups.get(key)!.push(notification);
      }

      // 创建分组
      for (const [resourceKey, groupNotifications] of resourceGroups) {
        const groupId = `group_${type}_${resourceKey}`;
        const latestNotification = groupNotifications[0];
        const priority = this.getGroupPriority(groupNotifications);

        const group: NotificationGroup = {
          id: groupId,
          type: type as NotificationType,
          count: groupNotifications.length,
          priority,
          latestNotification,
          notifications: groupNotifications,
          aggregatedMessage: this.generateAggregatedMessage(
            type as NotificationType,
            groupNotifications
          ),
        };

        this.groups.set(groupId, group);
      }
    }
  }

  /**
   * 按类型分组
   */
  private groupByType(): Record<string, Notification[]> {
    const grouped: Record<string, Notification[]> = {
      comment: [],
      like: [],
      share: [],
      mention: [],
      system: [],
    };

    for (const notification of this.notifications.values()) {
      grouped[notification.type].push(notification);
    }

    return grouped;
  }

  /**
   * 获取分组优先级
   */
  private getGroupPriority(notifications: Notification[]): NotificationPriority {
    if (notifications.some(n => n.priority === "high")) return "high";
    if (notifications.some(n => n.priority === "medium")) return "medium";
    return "low";
  }

  /**
   * 生成聚合消息
   */
  private generateAggregatedMessage(
    type: NotificationType,
    notifications: Notification[]
  ): string {
    if (notifications.length === 1) {
      return notifications[0].message;
    }

    const uniqueActors = new Set(notifications.map(n => n.actor.name));
    const actorList = Array.from(uniqueActors).join(", ");

    switch (type) {
      case "comment":
        return `${actorList} 评论了您的内容`;
      case "like":
        return `${actorList} 赞了您的内容`;
      case "share":
        return `${actorList} 分享了您的内容`;
      case "mention":
        return `${actorList} 提及了您`;
      case "system":
        return `${notifications.length} 条系统通知`;
      default:
        return `${notifications.length} 条新通知`;
    }
  }

  /**
   * 获取所有分组（按优先级排序）
   */
  getGroups(): NotificationGroup[] {
    const priorityOrder = { high: 0, medium: 1, low: 2 };

    return Array.from(this.groups.values()).sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      return b.latestNotification.timestamp - a.latestNotification.timestamp;
    });
  }

  /**
   * 获取未读分组
   */
  getUnreadGroups(): NotificationGroup[] {
    return this.getGroups().filter(g =>
      g.notifications.some(n => !n.read)
    );
  }

  /**
   * 标记通知为已读
   */
  markAsRead(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.read = true;
      console.log(`Notification marked as read: ${notificationId}`);
    }
  }

  /**
   * 标记分组为已读
   */
  markGroupAsRead(groupId: string): void {
    const group = this.groups.get(groupId);
    if (group) {
      group.notifications.forEach(n => {
        n.read = true;
      });
      console.log(`Group marked as read: ${groupId}`);
    }
  }

  /**
   * 删除通知
   */
  deleteNotification(notificationId: string): void {
    this.notifications.delete(notificationId);
    this.updateGroups();
    console.log(`Notification deleted: ${notificationId}`);
  }

  /**
   * 删除分组
   */
  deleteGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (group) {
      group.notifications.forEach(n => {
        this.notifications.delete(n.id);
      });
      this.groups.delete(groupId);
      console.log(`Group deleted: ${groupId}`);
    }
  }

  /**
   * 执行快速操作
   */
  async executeQuickAction(
    notificationId: string,
    actionId: string
  ): Promise<void> {
    const notification = this.notifications.get(notificationId);
    if (notification && notification.quickActions) {
      const action = notification.quickActions.find(a => a.id === actionId);
      if (action) {
        await action.action();
        console.log(`Quick action executed: ${actionId}`);
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): NotificationStats {
    const stats: NotificationStats = {
      total: this.notifications.size,
      unread: 0,
      byType: {
        comment: 0,
        like: 0,
        share: 0,
        mention: 0,
        system: 0,
      },
      byPriority: {
        high: 0,
        medium: 0,
        low: 0,
      },
      groups: this.groups.size,
    };

    for (const notification of this.notifications.values()) {
      if (!notification.read) {
        stats.unread++;
      }
      stats.byType[notification.type]++;
      stats.byPriority[notification.priority]++;
    }

    return stats;
  }

  /**
   * 清空通知
   */
  clear(): void {
    this.notifications.clear();
    this.groups.clear();
    this.deduplicationCache.clear();
    console.log("All notifications cleared");
  }

  /**
   * 获取所有通知
   */
  getAllNotifications(): Notification[] {
    return Array.from(this.notifications.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  /**
   * 搜索通知
   */
  searchNotifications(query: string): Notification[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllNotifications().filter(
      n =>
        n.title.toLowerCase().includes(lowerQuery) ||
        n.message.toLowerCase().includes(lowerQuery) ||
        n.actor.name.toLowerCase().includes(lowerQuery)
    );
  }
}

// 导出单例
export const advancedNotificationSystem = new AdvancedNotificationSystem();
