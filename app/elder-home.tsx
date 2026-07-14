import { ScrollView, Text, View, Pressable, Image, FlatList } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const QUICK_ACTIONS = [
  {
    id: 1,
    name: "查看相册",
    nameEn: "View Albums",
    icon: "image",
    color: "#f59e0b",
    route: "/album",
  },
  {
    id: 2,
    name: "我的故事",
    nameEn: "My Stories",
    icon: "edit",
    color: "#8b5cf6",
    route: "/stories",
  },
  {
    id: 3,
    name: "家庭成员",
    nameEn: "Family",
    icon: "people",
    color: "#10b981",
    route: "/members",
  },
  {
    id: 4,
    name: "消息",
    nameEn: "Messages",
    icon: "mail",
    color: "#3b82f6",
    route: "/messages",
  },
];

const EMERGENCY_CONTACTS = [
  {
    id: 1,
    name: "小雅",
    nameEn: "Xiaoya",
    phone: "138-1234-5678",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80",
  },
  {
    id: 2,
    name: "小明",
    nameEn: "Xiaoming",
    phone: "139-8765-4321",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80",
  },
];

const RECENT_PHOTOS = [
  {
    id: 1,
    uri: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=150&q=80",
    date: "2026-07-12",
  },
  {
    id: 2,
    uri: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=150&q=80",
    date: "2026-07-11",
  },
  {
    id: 3,
    uri: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=150&q=80",
    date: "2026-07-10",
  },
  {
    id: 4,
    uri: "https://images.unsplash.com/photo-1516589091380-5d8e87df6999?w=150&q=80",
    date: "2026-07-09",
  },
];

export default function ElderHomeScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [isSOS, setIsSOS] = useState(false);

  const handleQuickAction = (route: string) => {
    router.push(route as any);
  };

  const handleEmergencyCall = (phone: string) => {
    alert(language === "zh" ? `拨打 ${phone}` : `Call ${phone}`);
  };

  const renderActionButton = ({ item }: any) => (
    <Pressable
      onPress={() => handleQuickAction(item.route)}
      className="flex-1 mx-2 mb-4 active:opacity-80"
    >
      <View
        className="rounded-3xl p-6 items-center justify-center gap-3"
        style={{ backgroundColor: item.color + "20" }}
      >
        <View
          className="w-16 h-16 rounded-full items-center justify-center"
          style={{ backgroundColor: item.color }}
        >
          <MaterialIcons name={item.icon as any} size={32} color="white" />
        </View>
        <Text className="text-lg font-bold text-foreground text-center">
          {language === "zh" ? item.name : item.nameEn}
        </Text>
      </View>
    </Pressable>
  );

  const renderEmergencyContact = ({ item }: any) => (
    <Pressable
      onPress={() => handleEmergencyCall(item.phone)}
      className="flex-1 mx-2 mb-3 active:opacity-80"
    >
      <View className="bg-surface rounded-2xl p-4 items-center gap-2">
        <Image
          source={{ uri: item.avatar }}
          className="w-12 h-12 rounded-full"
        />
        <Text className="text-sm font-bold text-foreground">
          {language === "zh" ? item.name : item.nameEn}
        </Text>
        <Text className="text-xs text-muted">{item.phone}</Text>
        <Pressable
          onPress={() => handleEmergencyCall(item.phone)}
          className="mt-2 bg-error rounded-full px-4 py-2 active:opacity-80"
        >
          <Text className="text-white text-xs font-bold">
            {language === "zh" ? "拨打" : "Call"}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );

  const renderRecentPhoto = ({ item }: any) => (
    <Pressable
      onPress={() => router.push(`/photo/${item.id}`)}
      className="mr-3 mb-3 active:opacity-80"
    >
      <Image
        source={{ uri: item.uri }}
        className="w-24 h-24 rounded-2xl"
      />
      <Text className="text-xs text-muted mt-1">{item.date}</Text>
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
            <Text className="text-2xl font-bold text-foreground">
              {language === "zh" ? "长辈模式" : "Elder Mode"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="settings" size={28} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-4 py-6 gap-8">
            {/* 问候语 */}
            <View className="gap-2">
              <Text className="text-3xl font-bold text-foreground">
                {language === "zh" ? "早上好！" : "Good Morning!"}
              </Text>
              <Text className="text-lg text-muted">
                {language === "zh"
                  ? "今天是个美好的一天"
                  : "It's a beautiful day"}
              </Text>
            </View>

            {/* SOS紧急按钮 */}
            <Pressable
              onPress={() => setIsSOS(!isSOS)}
              className={`rounded-3xl py-6 items-center justify-center active:opacity-80 ${
                isSOS ? "bg-error" : "bg-red-500"
              }`}
            >
              <MaterialIcons name="sos" size={48} color="white" />
              <Text className="text-white text-xl font-bold mt-2">
                {language === "zh" ? "紧急求助" : "Emergency Help"}
              </Text>
              <Text className="text-white/80 text-sm mt-1">
                {language === "zh"
                  ? "长按3秒拨打紧急电话"
                  : "Long press for 3 seconds to call"}
              </Text>
            </Pressable>

            {/* 快速操作 */}
            <View className="gap-3">
              <Text className="text-2xl font-bold text-foreground px-2">
                {language === "zh" ? "快速操作" : "Quick Actions"}
              </Text>
              <FlatList
                data={QUICK_ACTIONS}
                renderItem={renderActionButton}
                keyExtractor={(item) => item.id.toString()}
                numColumns={2}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 0 }}
              />
            </View>

            {/* 紧急联系 */}
            <View className="gap-3">
              <Text className="text-2xl font-bold text-foreground px-2">
                {language === "zh" ? "紧急联系" : "Emergency Contacts"}
              </Text>
              <FlatList
                data={EMERGENCY_CONTACTS}
                renderItem={renderEmergencyContact}
                keyExtractor={(item) => item.id.toString()}
                numColumns={2}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 0 }}
              />
            </View>

            {/* 最近照片 */}
            <View className="gap-3">
              <Text className="text-2xl font-bold text-foreground px-2">
                {language === "zh" ? "最近照片" : "Recent Photos"}
              </Text>
              <FlatList
                data={RECENT_PHOTOS}
                renderItem={renderRecentPhoto}
                keyExtractor={(item) => item.id.toString()}
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEnabled={true}
                contentContainerStyle={{ paddingHorizontal: 8 }}
              />
            </View>

            {/* 退出长辈模式 */}
            <Pressable
              onPress={() => router.back()}
              className="bg-surface rounded-full py-4 items-center justify-center active:opacity-80 mb-4"
            >
              <Text className="text-foreground font-bold text-lg">
                {language === "zh" ? "退出长辈模式" : "Exit Elder Mode"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
