import { ScrollView, Text, View, Pressable, Image, FlatList, TextInput } from "react-native";
import { useState, useEffect } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useNotificationCenter } from "@/hooks/use-notification-center";
import { useOfflineNotificationQueue } from "@/hooks/use-offline-notification-queue";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const MOCK_MESSAGES = [
  {
    id: 1,
    type: "comment",
    typeEn: "Comment",
    user: "小明",
    userEn: "Xiaoming",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&q=80",
    message: "太美了！这是在哪里拍的？",
    messageEn: "So beautiful! Where was this taken?",
    timestamp: "2026-07-12 14:30",
    read: false,
    thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=100&q=80",
    context: "在您的照片上评论",
    contextEn: "commented on your photo",
  },
  {
    id: 2,
    type: "like",
    typeEn: "Like",
    user: "陈建国",
    userEn: "Chen Jianguo",
    avatar: "https://images.unsplash.com/photo-1547559906-41b45c308f73?w=80&q=80",
    message: "赞了您的照片",
    messageEn: "liked your photo",
    timestamp: "2026-07-12 13:15",
    read: false,
    thumbnail: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=100&q=80",
    context: "在您的照片上点赞",
    contextEn: "liked your photo",
  },
  {
    id: 3,
    type: "system",
    typeEn: "System",
    user: "系统",
    userEn: "System",
    avatar: "https://images.unsplash.com/photo-1579546069876-e67f89e7e269?w=80&q=80",
    message: "李秀英加入了家庭相册",
    messageEn: "Li Xiuying joined the family album",
    timestamp: "2026-07-12 10:00",
    read: true,
    context: "系统通知",
    contextEn: "System notification",
  },
  {
    id: 4,
    type: "comment",
    typeEn: "Comment",
    user: "小雅",
    userEn: "Xiaoya",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&q=80",
    message: "我也很喜欢这个时刻！",
    messageEn: "I love this moment too!",
    timestamp: "2026-07-11 16:45",
    read: true,
    thumbnail: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=100&q=80",
    context: "回复了您的评论",
    contextEn: "replied to your comment",
  },
  {
    id: 5,
    type: "share",
    typeEn: "Share",
    user: "李秀英",
    userEn: "Li Xiuying",
    avatar: "https://images.unsplash.com/photo-1566616213894-2d4e1baee5d8?w=80&q=80",
    message: "分享了相册到微信",
    messageEn: "shared album to WeChat",
    timestamp: "2026-07-11 15:20",
    read: true,
    context: "分享通知",
    contextEn: "Share notification",
  },
];

const MESSAGE_FILTERS = [
  { id: 1, name: "全部", nameEn: "All" },
  { id: 2, name: "未读", nameEn: "Unread" },
  { id: 3, name: "评论", nameEn: "Comments" },
  { id: 4, name: "点赞", nameEn: "Likes" },
];

export default function MessagesScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const { unreadCount: notificationUnreadCount } = useNotificationCenter();
  const { stats: queueStats } = useOfflineNotificationQueue();
  const [searchText, setSearchText] = useState("");
  const [selectedFilter, setSelectedFilter] = useState(1);
  const [messages, setMessages] = useState(MOCK_MESSAGES);

  useEffect(() => {
    // 定期同步离线队列
    const syncInterval = setInterval(() => {
      // 模拟后台同步
      console.log("Background sync check...");
    }, 30000); // 每30秒检查一次

    return () => clearInterval(syncInterval);
  }, []);

  const getMessageIcon = (type: string) => {
    switch (type) {
      case "comment":
        return "message";
      case "like":
        return "favorite";
      case "system":
        return "info";
      case "share":
        return "share";
      default:
        return "mail";
    }
  };

  const getMessageColor = (type: string) => {
    switch (type) {
      case "comment":
        return "#3b82f6";
      case "like":
        return "#ef4444";
      case "system":
        return colors.muted;
      case "share":
        return "#10b981";
      default:
        return colors.primary;
    }
  };

  const filteredMessages = messages.filter(msg => {
    const matchesSearch =
      (language === "zh" ? msg.user : msg.userEn)
        .toLowerCase()
        .includes(searchText.toLowerCase()) ||
      (language === "zh" ? msg.message : msg.messageEn)
        .toLowerCase()
        .includes(searchText.toLowerCase());
    const matchesFilter =
      selectedFilter === 1 ||
      (selectedFilter === 2 && !msg.read) ||
      (selectedFilter === 3 && msg.type === "comment") ||
      (selectedFilter === 4 && msg.type === "like");
    return matchesSearch && matchesFilter;
  });

  const unreadCount = messages.filter(m => !m.read).length;
  const totalUnread = unreadCount + notificationUnreadCount + queueStats.pendingSync;

  const handleMarkAsRead = (messageId: number) => {
    setMessages(
      messages.map(m =>
        m.id === messageId ? { ...m, read: true } : m
      )
    );
  };

  const handleDeleteMessage = (messageId: number) => {
    setMessages(messages.filter(m => m.id !== messageId));
  };

  const renderMessageItem = ({ item }: any) => (
    <Pressable
      onPress={() => {
        handleMarkAsRead(item.id);
        router.push(`/notification/${item.id}`);
      }}
      className={`mb-3 rounded-2xl p-4 flex-row gap-3 active:opacity-80 ${
        item.read ? "bg-surface" : "bg-primary/10"
      }`}
    >
      {/* 头像和状态指示 */}
      <View className="relative">
        <Image
          source={{ uri: item.avatar }}
          className="w-12 h-12 rounded-full"
        />
        {!item.read && (
          <View className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary" />
        )}
      </View>

      {/* 消息内容 */}
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2 flex-1">
            <Text className="font-semibold text-foreground">
              {language === "zh" ? item.user : item.userEn}
            </Text>
            <View
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getMessageColor(item.type) }}
            />
          </View>
          <Text className="text-xs text-muted">{item.timestamp.split(" ")[1]}</Text>
        </View>

        <Text className="text-sm text-muted" numberOfLines={2}>
          {language === "zh" ? item.message : item.messageEn}
        </Text>

        <Text className="text-xs text-muted">
          {language === "zh" ? item.context : item.contextEn}
        </Text>
      </View>

      {/* 操作按钮 */}
      <View className="flex-row items-center gap-1">
        {item.thumbnail && (
          <Image
            source={{ uri: item.thumbnail }}
            className="w-10 h-10 rounded-lg"
          />
        )}
        <Pressable
          onPress={() => handleDeleteMessage(item.id)}
          className="p-2"
        >
          <MaterialIcons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <View className="flex-row items-center gap-2">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "消息" : "Messages"}
              </Text>
              {totalUnread > 0 && (
                <View className="bg-error rounded-full px-2 py-0.5">
                  <Text className="text-xs text-white font-bold">{totalUnread}</Text>
                </View>
              )}
            </View>
            <Pressable className="p-2">
              <MaterialIcons name="more-vert" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-4">
            {/* 搜索框 */}
            <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2">
              <MaterialIcons name="search" size={20} color={colors.muted} />
              <TextInput
                placeholder={language === "zh" ? "搜索消息..." : "Search messages..."}
                value={searchText}
                onChangeText={setSearchText}
                placeholderTextColor={colors.muted}
                className="flex-1 text-foreground"
              />
              {searchText && (
                <Pressable onPress={() => setSearchText("")}>
                  <MaterialIcons name="close" size={20} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {/* 消息筛选 */}
            <FlatList
              data={MESSAGE_FILTERS}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedFilter(item.id)}
                  className={`px-4 py-2 rounded-full ${
                    selectedFilter === item.id
                      ? "bg-primary"
                      : "bg-surface"
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      selectedFilter === item.id
                        ? "text-white"
                        : "text-foreground"
                    }`}
                  >
                    {language === "zh" ? item.name : item.nameEn}
                  </Text>
                </Pressable>
              )}
              keyExtractor={(item) => item.id.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={true}
            />

            {/* 消息列表 */}
            {filteredMessages.length > 0 ? (
              <FlatList
                data={filteredMessages}
                renderItem={renderMessageItem}
                keyExtractor={(item) => item.id.toString()}
                scrollEnabled={false}
              />
            ) : (
              <View className="flex-1 items-center justify-center gap-2">
                <MaterialIcons name="mail-outline" size={48} color={colors.muted} />
                <Text className="text-lg font-semibold text-foreground">
                  {language === "zh" ? "没有消息" : "No messages"}
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
