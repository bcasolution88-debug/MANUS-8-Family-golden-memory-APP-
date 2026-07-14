import { useCallback, useState, useEffect } from "react";
import { advancedNotificationSystem, Notification, NotificationGroup, NotificationStats } from "@/lib/advanced-notification-system";

export function useAdvancedNotifications() {
  const [groups, setGroups] = useState<NotificationGroup[]>(
    advancedNotificationSystem.getGroups()
  );
  const [unreadGroups, setUnreadGroups] = useState<NotificationGroup[]>(
    advancedNotificationSystem.getUnreadGroups()
  );
  const [stats, setStats] = useState<NotificationStats>(
    advancedNotificationSystem.getStats()
  );

  useEffect(() => {
    // 定期更新状态
    const interval = setInterval(() => {
      setGroups(advancedNotificationSystem.getGroups());
      setUnreadGroups(advancedNotificationSystem.getUnreadGroups());
      setStats(advancedNotificationSystem.getStats());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const addNotification = useCallback((notification: Notification) => {
    const added = advancedNotificationSystem.addNotification(notification);
    setGroups(advancedNotificationSystem.getGroups());
    setUnreadGroups(advancedNotificationSystem.getUnreadGroups());
    setStats(advancedNotificationSystem.getStats());
    return added;
  }, []);

  const markAsRead = useCallback((notificationId: string) => {
    advancedNotificationSystem.markAsRead(notificationId);
    setGroups(advancedNotificationSystem.getGroups());
    setUnreadGroups(advancedNotificationSystem.getUnreadGroups());
    setStats(advancedNotificationSystem.getStats());
  }, []);

  const markGroupAsRead = useCallback((groupId: string) => {
    advancedNotificationSystem.markGroupAsRead(groupId);
    setGroups(advancedNotificationSystem.getGroups());
    setUnreadGroups(advancedNotificationSystem.getUnreadGroups());
    setStats(advancedNotificationSystem.getStats());
  }, []);

  const deleteNotification = useCallback((notificationId: string) => {
    advancedNotificationSystem.deleteNotification(notificationId);
    setGroups(advancedNotificationSystem.getGroups());
    setUnreadGroups(advancedNotificationSystem.getUnreadGroups());
    setStats(advancedNotificationSystem.getStats());
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    advancedNotificationSystem.deleteGroup(groupId);
    setGroups(advancedNotificationSystem.getGroups());
    setUnreadGroups(advancedNotificationSystem.getUnreadGroups());
    setStats(advancedNotificationSystem.getStats());
  }, []);

  const executeQuickAction = useCallback(
    async (notificationId: string, actionId: string) => {
      await advancedNotificationSystem.executeQuickAction(notificationId, actionId);
    },
    []
  );

  const searchNotifications = useCallback((query: string) => {
    return advancedNotificationSystem.searchNotifications(query);
  }, []);

  const clear = useCallback(() => {
    advancedNotificationSystem.clear();
    setGroups([]);
    setUnreadGroups([]);
    setStats(advancedNotificationSystem.getStats());
  }, []);

  return {
    groups,
    unreadGroups,
    stats,
    addNotification,
    markAsRead,
    markGroupAsRead,
    deleteNotification,
    deleteGroup,
    executeQuickAction,
    searchNotifications,
    clear,
  };
}
