import { useEffect, useState, useCallback } from "react";
import { notificationCenter, Notification, NotificationType, NotificationStatus } from "@/lib/notification-center";

export function useNotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // 初始化
    setNotifications(notificationCenter.getAllNotifications());
    setUnreadCount(notificationCenter.getUnreadCount());

    // 订阅新通知
    const unsubscribeNotification = notificationCenter.onNotification(notification => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(notificationCenter.getUnreadCount());
    });

    // 订阅状态变化
    const unsubscribeStatus = notificationCenter.onStatusChanged(() => {
      setUnreadCount(notificationCenter.getUnreadCount());
    });

    return () => {
      unsubscribeNotification();
      unsubscribeStatus();
    };
  }, []);

  const addNotification = useCallback(
    (notification: Omit<Notification, "id" | "timestamp" | "status">) => {
      return notificationCenter.addNotification(notification);
    },
    []
  );

  const markAsRead = useCallback((notificationId: string) => {
    notificationCenter.markAsRead(notificationId);
  }, []);

  const markMultipleAsRead = useCallback((notificationIds: string[]) => {
    notificationCenter.markMultipleAsRead(notificationIds);
  }, []);

  const markAsArchived = useCallback((notificationId: string) => {
    notificationCenter.markAsArchived(notificationId);
  }, []);

  const getUnreadNotifications = useCallback(() => {
    return notificationCenter.getUnreadNotifications();
  }, []);

  const getNotificationsByType = useCallback((type: NotificationType) => {
    return notificationCenter.getNotificationsByType(type);
  }, []);

  const getNotificationGroups = useCallback(() => {
    return notificationCenter.getNotificationGroups();
  }, []);

  const executeAction = useCallback((notificationId: string, actionId: string) => {
    notificationCenter.executeAction(notificationId, actionId);
  }, []);

  const deleteNotification = useCallback((notificationId: string) => {
    notificationCenter.deleteNotification(notificationId);
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  const clearAllNotifications = useCallback(() => {
    notificationCenter.clearAllNotifications();
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  const clearReadNotifications = useCallback(() => {
    notificationCenter.clearReadNotifications();
    setNotifications(notificationCenter.getAllNotifications());
  }, []);

  const getStats = useCallback(() => {
    return notificationCenter.getStats();
  }, []);

  return {
    notifications,
    unreadCount,
    addNotification,
    markAsRead,
    markMultipleAsRead,
    markAsArchived,
    getUnreadNotifications,
    getNotificationsByType,
    getNotificationGroups,
    executeAction,
    deleteNotification,
    clearAllNotifications,
    clearReadNotifications,
    getStats,
  };
}
