import { ScrollView, Text, View, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import * as Auth from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

/**
 * P9 — real password reset.
 *
 *   step "email": auth.requestPasswordReset (never reveals whether the account exists)
 *   step "code" : auth.resetPassword {email, code, newPassword} → signed in → Home
 *
 * When the server has no mail transport the response says so and the code is
 * written to the server log (dev); the UI tells the user plainly.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { refresh } = useAuth({ autoFetch: false });
  const utils = trpc.useUtils();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mailDelivered, setMailDelivered] = useState<boolean | null>(null);
  const [ttl, setTtl] = useState(10);
  // P10: codes may be routed to a verified phone when the user chose SMS.
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [destination, setDestination] = useState<string | null>(null);

  const request = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: (r) => {
      setMailDelivered(r.delivered);
      setTtl(r.ttlMinutes);
      setChannel(r.channel);
      setDestination(r.destination);
      setStep("code");
      if (r.channel === "sms" ? !r.smsConfigured : !r.mailConfigured) {
        toast.info(r.channel === "sms" ? l("短信服务未配置：验证码已写入服务器日志", "SMS isn't configured — the code was written to the server log") : l("邮件服务未配置：验证码已写入服务器日志", "Mail isn't configured — the code was written to the server log"));
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const reset = trpc.auth.resetPassword.useMutation({
    onSuccess: async ({ sessionToken, user }) => {
      await Auth.setSessionToken(sessionToken);
      await Auth.setUserInfo({ id: user.id, openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: new Date() });
      await Promise.all([utils.invalidate(), refresh()]);
      toast.success(l("密码已重置，已为您登录", "Password reset — you're signed in"));
      router.replace("/(tabs)");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleRequest = () => {
    if (!email.trim()) return toast.warning(t("common.pleaseEnterEmailAddress"));
    request.mutate({ email: email.trim(), language: l("zh", "en") as "zh" | "en" });
  };

  const handleReset = () => {
    if (!/^\d{6}$/.test(code)) return toast.warning(l("请输入 6 位验证码", "Enter the 6-digit code"));
    if (password.length < 8) return toast.warning(l("新密码至少 8 位", "Password must be at least 8 characters"));
    if (password !== confirm) return toast.warning(t("register.passwordsDoNotMatch"));
    reset.mutate({ email: email.trim(), code, newPassword: password });
  };

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View className="flex-1 px-6 py-8 gap-6 justify-center">
          <Pressable
            onPress={() => (step === "code" ? setStep("email") : router.back())}
            className="flex-row items-center gap-2 min-h-[48px]"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            <Text className="text-base text-foreground">{t("back")}</Text>
          </Pressable>

          {step === "email" ? (
            <>
              <View className="gap-2">
                <Text className="text-3xl font-bold text-foreground">{t("forgotPassword.resetPassword")}</Text>
                <Text className="text-base text-muted">{l("输入账户邮箱，我们会发送 6 位验证码。", "Enter your account email and we'll send a 6-digit code.")}</Text>
              </View>

              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">{t("common.emailAddress")}</Text>
                <View className="flex-row items-center bg-surface rounded-2xl px-4 border border-border min-h-[52px]">
                  <MaterialIcons name="email" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={t("forgotPassword.enterYourEmail")}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    placeholderTextColor={colors.muted}
                    className="flex-1 ml-3 text-foreground"
                    style={{ fontSize: 16 }}
                  />
                </View>
              </View>

              <Pressable
                onPress={handleRequest}
                disabled={request.isPending}
                className="rounded-2xl min-h-[52px] items-center justify-center flex-row gap-2"
                style={{ backgroundColor: colors.primary, opacity: request.isPending ? 0.7 : 1 }}
                accessibilityRole="button"
              >
                {request.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <MaterialIcons name="send" size={20} color={colors.onPrimary} />}
                <Text className="text-base font-semibold text-onPrimary">{l("发送验证码", "Send code")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View className="items-center gap-3">
                <View className="w-20 h-20 rounded-full items-center justify-center" style={{ backgroundColor: `${colors.primary}22` }}>
                  <MaterialIcons name={mailDelivered ? (channel === "sms" ? "sms" : "mark-email-read") : "terminal"} size={40} color={colors.primary} />
                </View>
                <Text className="text-2xl font-bold text-foreground text-center">{l("输入验证码", "Enter the code")}</Text>
                <Text className="text-sm text-muted text-center">
                  {mailDelivered
                    ? channel === "sms"
                      ? l(`验证码已通过短信发送至 ${destination ?? "已绑定手机"}，${ttl} 分钟内有效。`, `A code was texted to ${destination ?? "your phone"} (valid ${ttl} min).`)
                      : l(`验证码已发送至 ${email}，${ttl} 分钟内有效。如果账户存在，请查收邮箱（含垃圾箱）。`, `If an account exists for ${email}, a code is on its way (valid ${ttl} min). Check spam too.`)
                    : l(`${channel === "sms" ? "短信" : "邮件"}服务未配置。验证码已记录在服务器日志中（开发环境），${ttl} 分钟内有效。`, `${channel === "sms" ? "SMS" : "Mail"} is not configured. The code was logged on the server (dev), valid ${ttl} min.`)}
                </Text>
              </View>

              <View className="gap-3">
                <TextInput
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 min-h-[60px] text-foreground text-center font-mono border border-border"
                  style={{ fontSize: 28, letterSpacing: 12 }}
                  accessibilityLabel={l("6 位验证码", "6-digit code")}
                />
                <View className="flex-row items-center bg-surface rounded-2xl px-4 border border-border min-h-[52px]">
                  <MaterialIcons name="lock" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={l("新密码（至少 8 位）", "New password (min 8 chars)")}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    placeholderTextColor={colors.muted}
                    className="flex-1 ml-3 text-foreground"
                    style={{ fontSize: 16 }}
                  />
                  <Pressable onPress={() => setShowPassword((v) => !v)} className="min-w-[44px] min-h-[44px] items-center justify-center" accessibilityRole="button">
                    <MaterialIcons name={showPassword ? "visibility" : "visibility-off"} size={20} color={colors.muted} />
                  </Pressable>
                </View>
                <View className="flex-row items-center bg-surface rounded-2xl px-4 border border-border min-h-[52px]">
                  <MaterialIcons name="lock-outline" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={l("再次输入新密码", "Confirm new password")}
                    value={confirm}
                    onChangeText={setConfirm}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    placeholderTextColor={colors.muted}
                    className="flex-1 ml-3 text-foreground"
                    style={{ fontSize: 16 }}
                  />
                </View>
              </View>

              <Pressable
                onPress={handleReset}
                disabled={reset.isPending}
                className="rounded-2xl min-h-[52px] items-center justify-center flex-row gap-2"
                style={{ backgroundColor: colors.primary, opacity: reset.isPending ? 0.7 : 1 }}
                accessibilityRole="button"
              >
                {reset.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <MaterialIcons name="check" size={20} color={colors.onPrimary} />}
                <Text className="text-base font-semibold text-onPrimary">{l("重置并登录", "Reset and sign in")}</Text>
              </Pressable>

              <Pressable onPress={handleRequest} disabled={request.isPending} className="min-h-[44px] items-center justify-center" accessibilityRole="button">
                <Text className="text-sm text-primary font-semibold">{request.isPending ? l("发送中…", "Sending…") : l("重新发送验证码", "Resend code")}</Text>
              </Pressable>
            </>
          )}

          <Pressable onPress={() => router.replace("/auth/login" as any)} className="min-h-[44px] items-center justify-center" accessibilityRole="button">
            <Text className="text-sm text-muted">{t("forgotPassword.backToLogin")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
