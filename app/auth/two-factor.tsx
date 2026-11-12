import { ScrollView, Text, View, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import * as Auth from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

/**
 * P9 — second step of a password login when the account has emailed 2FA on.
 * Reached from Login with `?challengeId=&email=`; auth.complete2fa finishes
 * the sign-in. "Resend" issues a fresh challenge (1/min server-side).
 */
export default function TwoFactorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ challengeId?: string; email?: string; channel?: string; destination?: string }>();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { refresh } = useAuth({ autoFetch: false });
  const utils = trpc.useUtils();

  const [challengeId, setChallengeId] = useState(params.challengeId ?? "");
  const email = (params.email ?? "").toLowerCase();
  // P10: where the code went — "sms" shows the masked phone, otherwise the email.
  const [channel, setChannel] = useState<"email" | "sms">(params.channel === "sms" ? "sms" : "email");
  const [destination, setDestination] = useState(params.destination || email);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const complete = trpc.auth.complete2fa.useMutation({
    onSuccess: async ({ sessionToken, user }) => {
      await Auth.setSessionToken(sessionToken);
      await Auth.setUserInfo({ id: user.id, openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: new Date() });
      await Promise.all([utils.invalidate(), refresh()]);
      toast.success(l(`欢迎回来，${user.name ?? ""}`, `Welcome back${user.name ? `, ${user.name}` : ""}`));
      router.replace("/(tabs)");
    },
    onError: (e) => toast.error(e.message),
  });

  const resend = trpc.auth.resend2fa.useMutation({
    onSuccess: (r) => {
      if (r.challengeId) setChallengeId(r.challengeId);
      if (r.channel) setChannel(r.channel);
      if (r.destination) setDestination(r.destination);
      setCooldown(60);
      setCode("");
      toast.success(r.delivered ? t("twoFactor.codeResent") : r.channel === "sms" ? l("验证码已重新生成（短信服务未配置，见服务器日志）", "New code generated (SMS not configured — see server log)") : l("验证码已重新生成（邮件服务未配置，见服务器日志）", "New code generated (mail not configured — see server log)"));
    },
    onError: (e) => toast.error(e.message),
  });

  const handleVerify = () => {
    if (!/^\d{6}$/.test(code)) return toast.warning(t("twoFactor.pleaseEnter6Digit"));
    if (!challengeId || !email) return toast.error(l("登录会话已失效，请重新登录", "Sign-in session expired — please sign in again"));
    complete.mutate({ challengeId, email, code });
  };

  if (!email) {
    return (
      <ScreenContainer className="bg-background p-0">
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <MaterialIcons name="error-outline" size={56} color={colors.muted} />
          <Text className="text-base text-muted text-center">{l("缺少登录信息，请从登录页重新开始。", "Missing sign-in context — please start from the login page.")}</Text>
          <Pressable onPress={() => router.replace("/auth/login" as any)} className="rounded-full px-6 min-h-[48px] items-center justify-center" style={{ backgroundColor: colors.primary }} accessibilityRole="button">
            <Text className="font-semibold text-onPrimary">{t("signIn")}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View className="flex-1 px-6 py-8 gap-6 justify-center">
          <Pressable onPress={() => router.replace("/auth/login" as any)} className="flex-row items-center gap-2 min-h-[48px]" accessibilityRole="button">
            <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            <Text className="text-base text-foreground">{t("back")}</Text>
          </Pressable>

          <View className="items-center gap-3">
            <View className="w-20 h-20 rounded-full items-center justify-center" style={{ backgroundColor: `${colors.primary}22` }}>
              <MaterialIcons name={channel === "sms" ? "sms" : "verified-user"} size={40} color={colors.primary} />
            </View>
            <Text className="text-2xl font-bold text-foreground text-center">{l("两步验证", "Two-step verification")}</Text>
            <Text className="text-sm text-muted text-center">
              {channel === "sms"
                ? l(`我们已向手机 ${destination} 发送 6 位短信验证码（10 分钟内有效）。`, `We texted a 6-digit code to ${destination} (valid for 10 minutes).`)
                : l(`我们已向 ${destination} 发送 6 位验证码（10 分钟内有效）。`, `We sent a 6-digit code to ${destination} (valid for 10 minutes).`)}
            </Text>
          </View>

          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            onSubmitEditing={handleVerify}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            placeholder="000000"
            placeholderTextColor={colors.muted}
            className="bg-surface rounded-2xl px-4 min-h-[64px] text-foreground text-center font-mono border border-border"
            style={{ fontSize: 30, letterSpacing: 14 }}
            accessibilityLabel={l("6 位验证码", "6-digit code")}
          />

          <Pressable
            onPress={handleVerify}
            disabled={complete.isPending || code.length !== 6}
            className="rounded-2xl min-h-[52px] items-center justify-center flex-row gap-2"
            style={{ backgroundColor: code.length === 6 ? colors.primary : colors.border, opacity: complete.isPending ? 0.7 : 1 }}
            accessibilityRole="button"
          >
            {complete.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <MaterialIcons name="check" size={20} color={colors.onPrimary} />}
            <Text className="text-base font-semibold text-onPrimary">{l("验证并登录", "Verify and sign in")}</Text>
          </Pressable>

          <Pressable
            onPress={() => resend.mutate({ email, language: l("zh", "en") as "zh" | "en" })}
            disabled={cooldown > 0 || resend.isPending}
            className="min-h-[44px] items-center justify-center"
            accessibilityRole="button"
          >
            <Text className={cooldown > 0 ? "text-sm text-muted" : "text-sm text-primary font-semibold"}>
              {resend.isPending ? l("发送中…", "Sending…") : cooldown > 0 ? l(`${cooldown} 秒后可重新发送`, `Resend in ${cooldown}s`) : l("重新发送验证码", "Resend code")}
            </Text>
          </Pressable>

          <Text className="text-xs text-muted text-center">
            {channel === "sms"
              ? l("收不到短信？请确认手机信号；如果是开发环境，验证码会打印在服务器日志里。", "No SMS? Check signal. In development the code is printed to the server log.")
              : l("收不到邮件？请检查垃圾箱；如果是开发环境，验证码会打印在服务器日志里。", "No email? Check spam. In development the code is printed to the server log.")}
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
