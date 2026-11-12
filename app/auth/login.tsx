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

export default function LoginScreen() {
  const router = useRouter();
  const { t, l, language, setLanguage } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { refresh } = useAuth({ autoFetch: false });
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // P11: passwordless sign-in with a texted code
  const [mode, setMode] = useState<"password" | "sms">("password");
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsChallenge, setSmsChallenge] = useState<{ id: string; destination: string } | null>(null);

  // P8: real email + password sign-in (auth.login). Session cookie is set by
  // the server for web; native stores the returned token as a Bearer token.
  const login = trpc.auth.login.useMutation({
    onSuccess: async (res) => {
      // P9: accounts with emailed 2FA get a challenge instead of a session.
      if (res.requires2fa) {
        if (!res.delivered) toast.info(res.channel === "sms" ? l("短信服务未配置，验证码已记录在服务器日志", "SMS not configured — the code was written to the server log") : l("邮件服务未配置，验证码已记录在服务器日志", "Mail not configured — the code was written to the server log"));
        // P10: the code may have gone to the user's verified phone instead of email.
        router.push({ pathname: "/auth/two-factor", params: { challengeId: res.challengeId, email: res.email, channel: res.channel, destination: res.destination ?? "" } } as any);
        return;
      }
      const { sessionToken, user } = res;
      await Auth.setSessionToken(sessionToken);
      await Auth.setUserInfo({ id: user.id, openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: new Date() });
      await Promise.all([utils.invalidate(), refresh()]);
      toast.success(l(`欢迎回来，${user.name ?? ""}`, `Welcome back${user.name ? `, ${user.name}` : ""}`));
      router.replace("/(tabs)");
    },
    onError: (e) => toast.error(e.message),
  });
  const loading = login.isPending;

  const finishSession = async (sessionToken: string, user: { id: number; openId: string; name: string | null; email: string | null; loginMethod: string | null }) => {
    await Auth.setSessionToken(sessionToken);
    await Auth.setUserInfo({ id: user.id, openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: new Date() });
    await Promise.all([utils.invalidate(), refresh()]);
    toast.success(l(`欢迎回来，${user.name ?? ""}`, `Welcome back${user.name ? `, ${user.name}` : ""}`));
    router.replace("/(tabs)");
  };
  const requestSms = trpc.auth.requestSmsLogin.useMutation({
    onSuccess: (r) => {
      if (!r.challengeId) {
        toast.info(l("如果该手机号已绑定并验证，验证码会立即发送。", "If this number is linked and verified, a code is on its way."));
        setSmsChallenge({ id: "", destination: r.destination });
        return;
      }
      setSmsChallenge({ id: r.challengeId, destination: r.destination ?? "" });
      toast.success(r.delivered ? l(`验证码已发送到 ${r.destination}`, `Code sent to ${r.destination}`) : l("短信服务未配置，验证码已写入服务器日志", "SMS not configured — code written to server log"));
    },
    onError: (e) => toast.error(e.message),
  });
  const completeSms = trpc.auth.completeSmsLogin.useMutation({
    onSuccess: ({ sessionToken, user }) => finishSession(sessionToken, user),
    onError: (e) => toast.error(e.message),
  });
  const handleSmsLogin = () => {
    if (!smsChallenge) return requestSms.mutate({ phone, language: l("zh", "en") as "zh" | "en" });
    if (!smsChallenge.id) return toast.warning(l("该手机号未绑定账户，请先用密码登录并在设置中绑定。", "This number isn't linked — sign in with a password and link it in Settings."));
    if (!/^\d{6}$/.test(smsCode)) return toast.warning(l("请输入 6 位验证码", "Enter the 6-digit code"));
    completeSms.mutate({ challengeId: smsChallenge.id, phone, code: smsCode });
  };

  const handleLogin = () => {
    if (!email.trim() || !password) {
      toast.warning(t("login.pleaseEnterEmailAnd"));
      return;
    }
    login.mutate({ email: email.trim(), password });
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

            {/* P11: 登录方式 */}
            <View className="flex-row bg-surface rounded-full p-1 border border-border">
              {(["password", "sms"] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === m }}
                  className="flex-1 rounded-full min-h-[40px] items-center justify-center flex-row gap-1"
                  style={{ backgroundColor: mode === m ? colors.primary : "transparent" }}
                >
                  <MaterialIcons name={m === "password" ? "lock" : "sms"} size={16} color={mode === m ? colors.onPrimary : colors.muted} />
                  <Text className={mode === m ? "font-semibold text-onPrimary" : "font-semibold text-foreground"}>{m === "password" ? l("邮箱密码", "Email & password") : l("短信验证码", "SMS code")}</Text>
                </Pressable>
              ))}
            </View>

            {mode === "sms" ? (
              <View className="gap-4">
                <View className="gap-2">
                  <Text className="text-sm font-semibold text-foreground">{l("手机号", "Phone")}</Text>
                  <View className="flex-row items-center bg-surface rounded-2xl px-4 py-3 border border-border">
                    <MaterialIcons name="phone-iphone" size={20} color={colors.muted} />
                    <TextInput
                      value={phone}
                      onChangeText={(v) => {
                        setPhone(v);
                        if (smsChallenge) setSmsChallenge(null);
                      }}
                      keyboardType="phone-pad"
                      placeholder="+86 138 0013 8000"
                      placeholderTextColor={colors.muted}
                      className="flex-1 ml-3 text-foreground"
                      editable={!completeSms.isPending}
                    />
                  </View>
                </View>
                {smsChallenge?.id ? (
                  <View className="gap-2">
                    <Text className="text-sm font-semibold text-foreground">{l(`验证码（已发送到 ${smsChallenge.destination}）`, `Code (sent to ${smsChallenge.destination})`)}</Text>
                    <TextInput
                      value={smsCode}
                      onChangeText={(v) => setSmsCode(v.replace(/\D/g, "").slice(0, 6))}
                      onSubmitEditing={handleSmsLogin}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      placeholder="000000"
                      placeholderTextColor={colors.muted}
                      className="bg-surface rounded-2xl px-4 min-h-[56px] text-foreground text-center font-mono border border-border"
                      style={{ fontSize: 26, letterSpacing: 10 }}
                    />
                    <Pressable onPress={() => requestSms.mutate({ phone, language: l("zh", "en") as "zh" | "en" })} disabled={requestSms.isPending} className="items-end min-h-[40px] justify-center" accessibilityRole="button">
                      <Text className="text-sm text-primary font-semibold">{l("重新发送", "Resend")}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text className="text-xs text-muted">{l("仅限已在「设置 → 安全」验证过的手机号。", "Only phone numbers verified in Settings → Security can sign in this way.")}</Text>
                )}
                <Pressable onPress={handleSmsLogin} disabled={requestSms.isPending || completeSms.isPending || phone.trim().length < 8} className="bg-primary rounded-full py-4 items-center justify-center active:opacity-80" style={{ opacity: phone.trim().length < 8 ? 0.6 : 1 }} accessibilityRole="button">
                  <Text className="text-onPrimary font-bold text-lg">
                    {requestSms.isPending || completeSms.isPending ? t("loading") : smsChallenge?.id ? l("验证并登录", "Verify and sign in") : l("获取验证码", "Send code")}
                  </Text>
                </Pressable>
              </View>
            ) : (
            <>
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
              <Text className="text-onPrimary font-bold text-lg">
                {loading ? t("loading") : t("login")}
              </Text>
            </Pressable>
            </>
            )}

            {/* 分隔符 */}
            <View className="flex-row items-center gap-3">
              <View className="flex-1 h-px bg-border" />
              <Text className="text-sm text-muted">{t("or")}</Text>
              <View className="flex-1 h-px bg-border" />
            </View>

            {/* 快捷登录 */}
            <View className="gap-3">
              <Pressable onPress={() => toast.info(t("login.googleLoginComingSoon"))} className="flex-row items-center justify-center gap-3 bg-surface rounded-full py-3 border border-border active:opacity-80">
                <MaterialIcons name="language" size={20} color={colors.primary} />
                <Text className="text-foreground font-semibold">
                  {t("loginWithGoogle")}
                </Text>
              </Pressable>
              <Pressable onPress={() => toast.info(t("login.facebookLoginComingSoon"))} className="flex-row items-center justify-center gap-3 bg-surface rounded-full py-3 border border-border active:opacity-80">
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
