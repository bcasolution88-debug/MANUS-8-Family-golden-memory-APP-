import { ScrollView, Text, View, Pressable, Image } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { GradientCard } from "@/components/gradient-card";

export default function SplashScreen() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const colors = useColors();
  const [isAnimating, setIsAnimating] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnimating(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        router.replace("/(tabs)");
      }
    }
  }, [loading, isAuthenticated]);

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <View className="items-center gap-4">
          <View
            className={`w-24 h-24 rounded-3xl items-center justify-center ${
              isAnimating ? "animate-bounce" : ""
            }`}
            style={{
              backgroundColor: colors.primary,
              opacity: isAnimating ? 0.8 : 1,
            }}
          >
            <MaterialIcons name="favorite" size={48} color="white" />
          </View>
          <Text className="text-xl font-bold text-foreground">
            {t("appName")}
          </Text>
          <Text className="text-sm text-muted">
            {t("loadingMessage")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <GradientCard colors={[colors.background, colors.surface]} className="flex-1">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 justify-between py-8 px-6">
          {/* 顶部语言切换 */}
          <View className="flex-row justify-between items-center">
            <Text className="text-sm font-semibold text-foreground">
              {t("language")}
            </Text>
            <View className="flex-row gap-2 bg-surface rounded-full p-1">
              <Pressable
                onPress={() => setLanguage("zh")}
                className={`px-4 py-2 rounded-full ${
                  language === "en" ? "bg-primary" : ""
                }`}
              >
                <Text
                  className={`font-semibold ${
                    language === "en" ? "text-white" : "text-foreground"
                  }`}
                >
                  中文
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setLanguage("en")}
                className={`px-4 py-2 rounded-full ${
                  language === "en" ? "bg-primary" : ""
                }`}
              >
                <Text
                  className={`font-semibold ${
                    language === "en"
                      ? "text-white"
                      : "text-foreground"
                  }`}
                >
                  EN
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 中间内容 */}
          <View className="items-center gap-8">
            {/* Logo */}
            <View className="items-center gap-4">
              <View
                className="w-32 h-32 rounded-3xl items-center justify-center shadow-lg"
                style={{ backgroundColor: colors.primary }}
              >
                <MaterialIcons name="favorite" size={64} color="white" />
              </View>
              <View className="items-center gap-2">
                <Text className="text-4xl font-bold text-foreground">
                  {t("appName")}
                </Text>
                <Text className="text-base text-muted uppercase tracking-widest">
                  GOLDEN MEMORY
                </Text>
              </View>
            </View>

            {/* 描述文字 */}
            <View className="items-center gap-4">
              <Text className="text-lg text-foreground text-center font-semibold">
                {t("splashTitle")}
              </Text>
              <Text className="text-sm text-muted text-center leading-relaxed">
                {t("splashSubtitle")}
              </Text>
            </View>

            {/* 特性列表 */}
            <View className="w-full gap-3">
              {[
                {
                  icon: "calendar-today",
                  title: t("anniversaryThemes"),
                  subtitle: t("anniversaryThemesDesc"),
                },
                {
                  icon: "cloud-upload",
                  title: t("cloudStorage"),
                  subtitle: t("cloudStorageDesc"),
                },
                {
                  icon: "people",
                  title: t("familyMemories"),
                  subtitle: t("familyMemoriesDesc"),
                },
              ].map((feature, index) => (
                <View
                  key={index}
                  className="flex-row items-center gap-3 bg-surface rounded-2xl p-4"
                >
                  <View
                    className="w-12 h-12 rounded-full items-center justify-center"
                    style={{ backgroundColor: colors.primary + "20" }}
                  >
                    <MaterialIcons
                      name={feature.icon as any}
                      size={24}
                      color={colors.primary}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground text-sm">
                      {feature.title}
                    </Text>
                    <Text className="text-xs text-muted">
                      {feature.subtitle}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* 底部按钮 */}
          <View className="gap-3">
            <Pressable
              onPress={() => router.push("/auth/login")}
              className="bg-primary rounded-full py-4 items-center justify-center active:opacity-80"
            >
              <Text className="text-onPrimary font-bold text-lg">
                {t("beginJourney")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/auth/login")}
              className="bg-surface rounded-full py-4 items-center justify-center active:opacity-80"
            >
              <Text className="text-foreground font-semibold text-base">
                {t("hasAccount")}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </GradientCard>
  );
}
