import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "@/lib/language-provider";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform, View, Text } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useElderMode } from "@/lib/elder-mode-provider";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const unreadCount = useUnreadCount();
  const { simplified, scaled } = useElderMode();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  // Elder mode: taller bar + larger icons/labels so each tab stays >= 48dp tall.
  const tabBarHeight = scaled(56) + bottomPadding;
  const iconSize = scaled(28);

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
        tabBarLabelStyle: { fontSize: scaled(10), fontWeight: simplified ? "700" : "500" },
      }}
    >
      {/* 首页 */}
      <Tabs.Screen
        name="index"
        options={{
          title: t("home"),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="house.fill" color={color} />
          ),
        }}
      />

      {/* 相册 */}
      <Tabs.Screen
        name="album"
        options={{
          title: t("album"),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="photo.fill" color={color} />
          ),
        }}
      />

      {/* 时间线 */}
      {/* 长辈模式（simplified）下隐藏时间线，只保留 首页 / 相册 / 消息 / 我的 */}
      <Tabs.Screen
        name="timeline"
        options={{
          title: t("common.timeline"),
          href: simplified ? null : undefined,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="calendar" color={color} />
          ),
        }}
      />

      {/* 消息 */}
      <Tabs.Screen
        name="messages"
        options={{
          title: t("messages"),
          tabBarIcon: ({ color }) => (
            <View>
              <IconSymbol size={iconSize} name="envelope.fill" color={color} />
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
          title: t("me"),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={iconSize} name="person.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
