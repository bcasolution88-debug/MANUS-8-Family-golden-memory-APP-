import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "@/lib/language-provider";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform, View, Text } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useUnreadCount } from "@/hooks/use-unread-count";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();
  const unreadCount = useUnreadCount();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
      }}
    >
      {/* 首页 */}
      <Tabs.Screen
        name="index"
        options={{
          title: language === "zh" ? "首页" : "Home",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="house.fill" color={color} />
          ),
        }}
      />

      {/* 相册 */}
      <Tabs.Screen
        name="album"
        options={{
          title: language === "zh" ? "相册" : "Album",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="photo.fill" color={color} />
          ),
        }}
      />

      {/* 时间线 */}
      <Tabs.Screen
        name="timeline"
        options={{
          title: language === "zh" ? "时间线" : "Timeline",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="calendar" color={color} />
          ),
        }}
      />

      {/* 消息 */}
      <Tabs.Screen
        name="messages"
        options={{
          title: language === "zh" ? "消息" : "Messages",
          tabBarIcon: ({ color }) => (
            <View>
              <IconSymbol size={28} name="envelope.fill" color={color} />
              {unreadCount.total > 0 && (
                <View className="absolute -top-1 -right-1 bg-error rounded-full w-5 h-5 items-center justify-center">
                  <Text className="text-white text-xs font-bold">
                    {unreadCount.total > 99 ? "99+" : unreadCount.total}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />

      {/* 我的 */}
      <Tabs.Screen
        name="me"
        options={{
          title: language === "zh" ? "我的" : "Me",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="person.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
