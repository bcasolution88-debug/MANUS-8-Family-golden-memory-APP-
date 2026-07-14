import { ScrollView, Text, View, Pressable, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

export default function TwoFactorScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = async () => {
    if (!code.trim() || code.length !== 6) {
      setError(language === "zh" ? "请输入6位验证码" : "Please enter 6-digit code");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 模拟验证
      await new Promise(resolve => setTimeout(resolve, 1000));
      router.replace("/(tabs)");
    } catch (err) {
      setError(language === "zh" ? "验证码错误" : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    try {
      // 模拟重新发送
      await new Promise(resolve => setTimeout(resolve, 500));
      alert(language === "zh" ? "验证码已重新发送" : "Code resent");
    } catch (error) {
      alert(language === "zh" ? "重新发送失败" : "Failed to resend");
    }
  };

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 px-6 py-8 gap-6 justify-center">
          {/* 标题 */}
          <View className="gap-2 mb-4">
            <Text className="text-3xl font-bold text-foreground">
              {language === "zh" ? "验证身份" : "Verify Identity"}
            </Text>
            <Text className="text-base text-muted">
              {language === "zh"
                ? "我们已向您的邮箱发送了验证码"
                : "We've sent a verification code to your email"}
            </Text>
          </View>

          {/* 错误提示 */}
          {error && (
            <View className="bg-error/20 rounded-lg px-4 py-3 flex-row gap-2">
              <MaterialIcons name="error" size={20} color={colors.error} />
              <Text className="flex-1 text-error font-semibold">{error}</Text>
            </View>
          )}

          {/* 验证码输入 */}
          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">
              {language === "zh" ? "验证码" : "Verification Code"}
            </Text>
            <TextInput
              placeholder={language === "zh" ? "输入6位验证码" : "Enter 6-digit code"}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              editable={!loading}
              placeholderTextColor={colors.muted}
              className="bg-surface rounded-lg px-4 py-4 text-center text-2xl font-bold text-foreground tracking-widest border border-border"
            />
          </View>

          {/* 验证按钮 */}
          <Pressable
            onPress={handleVerify}
            disabled={loading}
            className={`bg-primary rounded-lg py-4 items-center justify-center ${
              loading ? "opacity-50" : ""
            }`}
          >
            <Text className="text-white font-bold text-lg">
              {loading
                ? language === "zh"
                  ? "验证中..."
                  : "Verifying..."
                : language === "zh"
                ? "验证"
                : "Verify"}
            </Text>
          </Pressable>

          {/* 重新发送 */}
          <View className="flex-row items-center justify-center gap-2">
            <Text className="text-sm text-muted">
              {language === "zh" ? "没有收到验证码？" : "Didn't receive code?"}
            </Text>
            <Pressable onPress={handleResendCode} disabled={loading}>
              <Text className="text-sm text-primary font-bold">
                {language === "zh" ? "重新发送" : "Resend"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
