import { ScrollView, Text, View, Pressable, Image, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const MOCK_NOTIFICATION_DETAILS: Record<string, any> = {
  "1": {
    id: 1,
    type: "comment",
    user: "小明",
    userEn: "Xiaoming",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80",
    message: "太美了！这是在哪里拍的？",
    messageEn: "So beautiful! Where was this taken?",
    timestamp: "2026-07-12 14:30",
    thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=300&q=80",
    context: "在您的照片上评论",
    contextEn: "commented on your photo",
    replies: [
      {
        id: 1,
        user: "您",
        userEn: "You",
        avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80",
        message: "在杭州西湖拍的！",
        messageEn: "Taken at West Lake, Hangzhou!",
        timestamp: "2026-07-12 14:45",
      },
    ],
  },
  "2": {
    id: 2,
    type: "like",
    user: "陈建国",
    userEn: "Chen Jianguo",
    avatar: "https://images.unsplash.com/photo-1547559906-41b45c308f73?w=100&q=80",
    message: "赞了您的照片",
    messageEn: "liked your photo",
    timestamp: "2026-07-12 13:15",
    thumbnail: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=300&q=80",
    context: "在您的照片上点赞",
    contextEn: "liked your photo",
    replies: [],
  },
};

export default function NotificationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [replyText, setReplyText] = useState("");
  const [replies, setReplies] = useState(MOCK_NOTIFICATION_DETAILS[id as string]?.replies || []);

  const notification = MOCK_NOTIFICATION_DETAILS[id as string];

  if (!notification) {
    return (
      <ScreenContainer className="bg-background items-center justify-center">
        <Text className="text-lg font-semibold text-foreground">
          {language === "zh" ? "通知不存在" : "Notification not found"}
        </Text>
      </ScreenContainer>
    );
  }

  const handleSendReply = () => {
    if (!replyText.trim()) return;

    const newReply = {
      id: replies.length + 1,
      user: "您",
      userEn: "You",
      avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80",
      message: replyText,
      messageEn: replyText,
      timestamp: new Date().toLocaleString(),
    };

    setReplies([...replies, newReply]);
    setReplyText("");
  };

  return (
    <ScreenContainer className="bg-background p-0">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1">
            {/* 顶部导航 */}
            <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
              <Pressable onPress={() => router.back()} className="p-2">
                <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
              </Pressable>
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "通知详情" : "Notification Detail"}
              </Text>
              <Pressable className="p-2">
                <MaterialIcons name="more-vert" size={24} color={colors.foreground} />
              </Pressable>
            </View>

            {/* 主要内容 */}
            <View className="flex-1 px-6 py-4 gap-6">
              {/* 原始通知 */}
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center gap-3">
                  <Image
                    source={{ uri: notification.avatar }}
                    className="w-12 h-12 rounded-full"
                  />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? notification.user : notification.userEn}
                    </Text>
                    <Text className="text-xs text-muted">{notification.timestamp}</Text>
                  </View>
                </View>

                <Text className="text-sm text-muted">
                  {language === "zh" ? notification.context : notification.contextEn}
                </Text>

                <Text className="text-base text-foreground">
                  {language === "zh" ? notification.message : notification.messageEn}
                </Text>

                {notification.thumbnail && (
                  <Image
                    source={{ uri: notification.thumbnail }}
                    className="w-full h-48 rounded-lg"
                  />
                )}
              </View>

              {/* 回复列表 */}
              {replies.length > 0 && (
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">
                    {language === "zh" ? "回复" : "Replies"}
                  </Text>
                  {replies.map((reply: any) => (
                    <View key={reply.id} className="bg-surface rounded-2xl p-4 gap-2">
                      <View className="flex-row items-center gap-2">
                        <Image
                          source={{ uri: reply.avatar }}
                          className="w-8 h-8 rounded-full"
                        />
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-foreground">
                            {reply.user}
                          </Text>
                          <Text className="text-xs text-muted">{reply.timestamp}</Text>
                        </View>
                      </View>
                      <Text className="text-sm text-foreground ml-10">
                        {reply.message}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* 快速操作 */}
              <View className="flex-row gap-2">
                <Pressable className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-full py-3 active:opacity-80">
                  <MaterialIcons name="favorite-border" size={20} color={colors.primary} />
                  <Text className="text-sm font-semibold text-primary">
                    {language === "zh" ? "赞" : "Like"}
                  </Text>
                </Pressable>
                <Pressable className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-full py-3 active:opacity-80">
                  <MaterialIcons name="share" size={20} color={colors.primary} />
                  <Text className="text-sm font-semibold text-primary">
                    {language === "zh" ? "分享" : "Share"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* 回复输入框 */}
        <View className="px-6 py-4 bg-surface border-t border-border gap-2">
          <View className="flex-row items-center gap-2 bg-background rounded-full px-4 py-2">
            <TextInput
              placeholder={language === "zh" ? "输入回复..." : "Type a reply..."}
              value={replyText}
              onChangeText={setReplyText}
              placeholderTextColor={colors.muted}
              className="flex-1 text-foreground"
              multiline
            />
            <Pressable
              onPress={handleSendReply}
              disabled={!replyText.trim()}
              className={`p-2 ${replyText.trim() ? "opacity-100" : "opacity-50"}`}
            >
              <MaterialIcons
                name="send"
                size={20}
                color={replyText.trim() ? colors.primary : colors.muted}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
