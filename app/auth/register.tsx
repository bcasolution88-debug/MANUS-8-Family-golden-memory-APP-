import { ScrollView, Text, View, Pressable, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useToast } from "@/components/toast";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import * as Auth from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

export default function RegisterScreen() {
  const router = useRouter();
  const { t, l, language, setLanguage } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { refresh } = useAuth({ autoFetch: false });
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // P8: real account creation (auth.register) — signs in immediately.
  const register = trpc.auth.register.useMutation({
    onSuccess: async ({ sessionToken, user }) => {
      await Auth.setSessionToken(sessionToken);
      await Auth.setUserInfo({ id: user.id, openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: new Date() });
      await Promise.all([utils.invalidate(), refresh()]);
      toast.success(l("注册成功，欢迎加入金色韶华", "Account created — welcome to Golden Memory"));
      router.replace("/(tabs)");
    },
    onError: (e) => toast.error(e.message),
  });
  const loading = register.isPending;

  const handleRegister = () => {
    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      toast.warning(t("register.pleaseFillInAll"));
      return;
    }
    if (password.length < 8) {
      toast.warning(l("密码至少 8 位", "Password must be at least 8 characters"));
      return;
    }
    if (password !== confirmPassword) {
      toast.warning(t("register.passwordsDoNotMatch"));
      return;
    }
    register.mutate({ name: name.trim(), email: email.trim(), password });
  };

  return (
    <ScreenContainer className="bg-background" edges={["top", "left", "right", "bottom"]}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 justify-between py-6 px-6">
          {/* 顶部语言切换 */}
          <View className="flex-row justify-between items-center mb-4">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setLanguage("zh")}
                className={`px-3 py-1 rounded-full ${
                  language === "en" ? "bg-primary" : "bg-surface"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    language === "en" ? "text-white" : "text-foreground"
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
                  {t("createAccount")}
                </Text>
              </View>
            </View>

            {/* 表单 */}
            <View className="gap-4">
              {/* 昵称（P8） */}
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">{t("me.name")}</Text>
                <View className="flex-row items-center bg-surface rounded-2xl px-4 py-3 border border-border">
                  <MaterialIcons name="person" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={l("家人怎么称呼你", "What your family calls you")}
                    value={name}
                    onChangeText={setName}
                    maxLength={100}
                    autoCapitalize="words"
                    placeholderTextColor={colors.muted}
                    className="flex-1 ml-3 text-foreground"
                  />
                </View>
              </View>

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

              {/* 确认密码输入框 */}
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t("confirmPassword")}
                </Text>
                <View className="flex-row items-center bg-surface rounded-2xl px-4 py-3 border border-border">
                  <MaterialIcons name="lock" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={t("confirmPassword")}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                    placeholderTextColor={colors.muted}
                    className="flex-1 ml-3 text-foreground"
                  />
                  <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                    <MaterialIcons
                      name={showConfirmPassword ? "visibility" : "visibility-off"}
                      size={20}
                      color={colors.muted}
                    />
                  </Pressable>
                </View>
              </View>
            </View>

            {/* 注册按钮 */}
            <Pressable
              onPress={handleRegister}
              disabled={loading}
              className="bg-primary rounded-full py-4 items-center justify-center active:opacity-80"
            >
              <Text className="text-onPrimary font-bold text-lg">
                {loading ? t("loading") : t("register")}
              </Text>
            </Pressable>

            {/* 分隔符 */}
            <View className="flex-row items-center gap-3">
              <View className="flex-1 h-px bg-border" />
              <Text className="text-sm text-muted">{t("or")}</Text>
              <View className="flex-1 h-px bg-border" />
            </View>

            {/* 快捷注册 */}
            <View className="gap-3">
              <Pressable className="flex-row items-center justify-center gap-3 bg-surface rounded-full py-3 border border-border active:opacity-80">
                <MaterialIcons name="language" size={20} color={colors.primary} />
                <Text className="text-foreground font-semibold">
                  {t("loginWithGoogle")}
                </Text>
              </Pressable>
              <Pressable className="flex-row items-center justify-center gap-3 bg-surface rounded-full py-3 border border-border active:opacity-80">
                <MaterialIcons name="people" size={20} color={colors.primary} />
                <Text className="text-foreground font-semibold">
                  {t("loginWithFacebook")}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 底部登录链接 */}
          <View className="flex-row items-center justify-center gap-1">
            <Text className="text-sm text-muted">{t("alreadyHaveAccount")}</Text>
            <Pressable onPress={() => router.push("/auth/login")}>
              <Text className="text-sm text-primary font-bold">
                {t("login")}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
