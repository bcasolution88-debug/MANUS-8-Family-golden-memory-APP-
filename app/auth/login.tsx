import { ScrollView, Text, View, Pressable, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

export default function LoginScreen() {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      alert(t("error"));
      return;
    }
    setLoading(true);
    try {
      // TODO: 调用登录API
      setTimeout(() => {
        setLoading(false);
        router.replace("/(tabs)");
      }, 1000);
    } catch (error) {
      setLoading(false);
      alert(t("error"));
    }
  };

  return (
    <ScreenContainer className="bg-background" edges={["top", "left", "right", "bottom"]}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 justify-between py-6 px-6">
          {/* 顶部语言切换 */}
          <View className="flex-row justify-end gap-2 mb-4">
            <Pressable
              onPress={() => setLanguage("zh")}
              className={`px-3 py-1 rounded-full ${
                language === "zh" ? "bg-primary" : "bg-surface"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  language === "zh" ? "text-white" : "text-foreground"
                }`}
              >
                中文
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setLanguage("en")}
              className={`px-3 py-1 rounded-full ${
                language === "en" ? "bg-primary" : "bg-surface"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  language === "en" ? "text-white" : "text-foreground"
                }`}
              >
                EN
              </Text>
            </Pressable>
          </View>

          {/* 中间内容 */}
          <View className="gap-8">
            {/* Logo和欢迎文字 */}
            <View className="items-center gap-4">
              <View
                className="w-24 h-24 rounded-3xl items-center justify-center"
                style={{ backgroundColor: colors.primary }}
              >
                <MaterialIcons name="favorite" size={48} color="white" />
              </View>
              <View className="items-center gap-2">
                <Text className="text-2xl font-bold text-foreground">
                  {t("appName")}
                </Text>
                <Text className="text-sm text-muted">
                  {t("continueRecording")}
                </Text>
              </View>
            </View>

            {/* 表单 */}
            <View className="gap-4">
              {/* 邮箱输入框 */}
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t("email")}
                </Text>
                <View className="flex-row items-center bg-surface rounded-2xl px-4 py-3 border border-border">
                  <MaterialIcons name="email" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={t("email")}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    placeholderTextColor={colors.muted}
                    className="flex-1 ml-3 text-foreground"
                  />
                </View>
              </View>

              {/* 密码输入框 */}
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t("password")}
                </Text>
                <View className="flex-row items-center bg-surface rounded-2xl px-4 py-3 border border-border">
                  <MaterialIcons name="lock" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={t("password")}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    placeholderTextColor={colors.muted}
                    className="flex-1 ml-3 text-foreground"
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)}>
                    <MaterialIcons
                      name={showPassword ? "visibility" : "visibility-off"}
                      size={20}
                      color={colors.muted}
                    />
                  </Pressable>
                </View>
              </View>

              {/* 忘记密码 */}
              <Pressable onPress={() => router.push("/auth/forgot-password")} className="items-end">
                <Text className="text-sm text-primary font-semibold">
                  {t("forgotPassword")}
                </Text>
              </Pressable>
            </View>

            {/* 登录按钮 */}
            <Pressable
              onPress={handleLogin}
              disabled={loading}
              className="bg-primary rounded-full py-4 items-center justify-center active:opacity-80"
            >
              <Text className="text-white font-bold text-lg">
                {loading ? t("loading") : t("login")}
              </Text>
            </Pressable>

            {/* 分隔符 */}
            <View className="flex-row items-center gap-3">
              <View className="flex-1 h-px bg-border" />
              <Text className="text-sm text-muted">{t("or")}</Text>
              <View className="flex-1 h-px bg-border" />
            </View>

            {/* 快捷登录 */}
            <View className="gap-3">
              <Pressable onPress={() => alert(language === "zh" ? "Google登录" : "Google Login")} className="flex-row items-center justify-center gap-3 bg-surface rounded-full py-3 border border-border active:opacity-80">
                <MaterialIcons name="language" size={20} color={colors.primary} />
                <Text className="text-foreground font-semibold">
                  {t("loginWithGoogle")}
                </Text>
              </Pressable>
              <Pressable onPress={() => alert(language === "zh" ? "Facebook登录" : "Facebook Login")} className="flex-row items-center justify-center gap-3 bg-surface rounded-full py-3 border border-border active:opacity-80">
                <MaterialIcons name="people" size={20} color={colors.primary} />
                <Text className="text-foreground font-semibold">
                  {t("loginWithFacebook")}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 底部注册链接 */}
          <View className="flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">{t("noAccount")}</Text>
            <Pressable onPress={() => router.push("/auth/register")}>
              <Text className="text-sm text-primary font-bold">
                {t("createAccount")}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
