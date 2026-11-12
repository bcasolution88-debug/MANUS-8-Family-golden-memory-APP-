import { View, Text, ScrollView, Pressable, FlatList, TextInput } from "react-native";
import { useState, useCallback } from "react";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import { useNotificationCenter } from "@/hooks/use-notification-center";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Notification, NotificationType } from "@/lib/notification-center";
import type { ComponentProps } from "react";

type MaterialIconName = ComponentProps<typeof MaterialIcons>["name"];

export function NotificationCenterUI() {
  const colors = useColors();
  const { t } = useLanguage();
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAsArchived,
    getNotificationGroups,
    executeAction,
    deleteNotification,
  } = useNotificationCenter();

  const [activeTab, setActiveTab] = useState<"all" | "unread" | "comment" | "like" | "share">("all");
  const [replyText, setReplyText] = useState("");
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);

  const notificationGroups = getNotificationGroups();

  const getFilteredNotifications = useCallback(() => {
    switch (activeTab) {
      case "unread":
        return notifications.filter(n => n.status === "unread");
      case "comment":
      case "like":
      case "share":
        return notifications.filter(n => n.type === activeTab);
      default:
        return notifications;
    }
  }, [notifications, activeTab]);

  const getNotificationIcon = (type: NotificationType) => {
    const icons: Record<NotificationType, MaterialIconName> = {
      comment: "comment",
      like: "favorite",
      share: "share",
      mention: "tag",
      system: "notifications",
    };
    return icons[type];
  };

  const handleReply = () => {
    if (!selectedNotification || !replyText.trim()) return;

    // 模拟发送回复
    console.log(`Reply to ${selectedNotification.id}: ${replyText}`);
    setReplyText("");
    setSelectedNotification(null);
  };

  const filteredNotifications = getFilteredNotifications();

  if (selectedNotification) {
    return (
      <View className="flex-1 bg-background">
        {/* 通知详情头部 */}
        <View className="flex-row items-center justify-between px-4 py-4 border-b border-border bg-surface">
          <Pressable onPress={() => setSelectedNotification(null)}>
            <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">
            {t("notificationCenter.notification")}
          </Text>
          <Pressable onPress={() => deleteNotification(selectedNotification.id)}>
            <MaterialIcons name="delete" size={24} color={colors.error} />
          </Pressable>
        </View>

        {/* 通知详情内容 */}
        <ScrollView className="flex-1 px-4 py-6">
          <View className="gap-4">
            {/* 通知头 */}
            <View className="flex-row items-center gap-3">
              <View
                className="w-12 h-12 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.primary + "20" }}
              >
                <MaterialIcons
                  name={getNotificationIcon(selectedNotification.type)}
                  size={24}
                  color={colors.primary}
                />
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold text-foreground">
                  {selectedNotification.title}
                </Text>
                <Text className="text-xs text-muted">
                  {new Date(selectedNotification.timestamp).toLocaleString()}
                </Text>
              </View>
            </View>

            {/* 通知消息 */}
            <View className="p-4 rounded-lg bg-surface border border-border">
              <Text className="text-sm text-foreground leading-relaxed">
                {selectedNotification.message}
              </Text>
            </View>

            {/* 相关媒体预览 */}
            {selectedNotification.relatedMediaId && (
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t("notificationCenter.relatedContent")}
                </Text>
                <View className="w-full h-40 rounded-lg bg-muted items-center justify-center">
                  <MaterialIcons name="image" size={48} color={colors.foreground} />
                </View>
              </View>
            )}

            {/* 快速操作 */}
            {selectedNotification.actions && selectedNotification.actions.length > 0 && (
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t("common.quickActions")}
                </Text>
                <View className="gap-2">
                  {selectedNotification.actions.map(action => (
                    <Pressable
                      key={action.id}
                      onPress={() => executeAction(selectedNotification.id, action.id)}
                      className="flex-row items-center justify-center gap-2 p-3 rounded-lg bg-primary active:opacity-80"
                    >
                      <MaterialIcons name="check" size={20} color={colors.onPrimary} />
                      <Text className="text-onPrimary font-semibold">{action.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* 回复输入框 */}
        <View className="flex-row items-center gap-2 p-4 border-t border-border bg-surface">
          <TextInput
            value={replyText}
            onChangeText={setReplyText}
            placeholder={t("notificationCenter.reply")}
            className="flex-1 border border-border rounded-lg px-4 py-3 text-foreground"
            placeholderTextColor={colors.muted}
          />
          <Pressable
            onPress={handleReply}
            className="w-10 h-10 rounded-lg bg-primary items-center justify-center active:opacity-80"
          >
            <MaterialIcons name="send" size={20} color={colors.onPrimary} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* 标签页 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="border-b border-border bg-surface"
      >
        <View className="flex-row">
          {["all", "unread", "comment", "like", "share"].map(tab => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab as any)}
              className={`px-4 py-3 border-b-2 ${
                activeTab === tab ? "border-primary" : "border-transparent"
              }`}
            >
              <View className="flex-row items-center gap-2">
                <Text
                  className={`text-sm font-semibold ${
                    activeTab === tab ? "text-primary" : "text-muted"
                  }`}
                >
                  {tab === "all"
                    ? t("notificationCenter.all")
                    : tab === "unread"
                      ? t("notificationCenter.unread")
                      : tab === "comment"
                        ? t("common.comments")
                        : tab === "like"
                          ? t("notificationCenter.likes")
                          : t("notificationCenter.shares")}
                </Text>
                {tab !== "all" && (
                  <View className="bg-primary rounded-full px-2 py-0.5">
                    <Text className="text-xs text-onPrimary font-bold">
                      {notificationGroups.find(g => g.type === tab)?.count || 0}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* 通知列表 */}
      {filteredNotifications.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <MaterialIcons name="notifications-none" size={48} color={colors.muted} />
          <Text className="text-muted mt-4">
            {t("notificationCenter.noNotifications")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setSelectedNotification(item);
                if (item.status === "unread") {
                  markAsRead(item.id);
                }
              }}
              className={`flex-row items-center gap-3 px-4 py-3 border-b border-border ${
                item.status === "unread" ? "bg-primary/5" : "bg-background"
              }`}
            >
              <View
                className="w-12 h-12 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.primary + "20" }}
              >
                <MaterialIcons
                  name={getNotificationIcon(item.type)}
                  size={24}
                  color={colors.primary}
                />
              </View>

              <View className="flex-1">
                <View className="flex-row items-center justify-between">
                  <Text
                    className={`font-semibold ${
                      item.status === "unread" ? "text-foreground" : "text-muted"
                    }`}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {item.status === "unread" && (
                    <View className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </View>
                <Text className="text-xs text-muted mt-1" numberOfLines={1}>
                  {item.message}
                </Text>
                <Text className="text-xs text-muted mt-1">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </Text>
              </View>

              <Pressable
                onPress={() => markAsArchived(item.id)}
                className="p-2 active:opacity-80"
              >
                <MaterialIcons name="close" size={20} color={colors.muted} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      {/* 未读计数徽章 */}
      {unreadCount > 0 && (
        <View className="absolute top-4 right-4 bg-error rounded-full w-6 h-6 items-center justify-center">
          <Text className="text-white text-xs font-bold">{unreadCount}</Text>
        </View>
      )}
    </View>
  );
}
