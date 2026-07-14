import { ScrollView, Text, View, Pressable, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSendReset = async () => {
    if (!email.trim()) {
      alert(language === "zh" ? "请输入邮箱地址" : "Please enter email address");
      return;
    }

    setLoading(true);
    try {
      // 模拟发送重置邮件
      await new Promise(resolve => setTimeout(resolve, 1000));
      setSent(true);
    } catch (error) {
      alert(language === "zh" ? "发送失败，请重试" : "Failed to send, please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 px-6 py-8 gap-6 justify-center">
          {/* 返回按钮 */}
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center gap-2 mb-4"
          >
            <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            <Text className="text-lg font-semibold text-foreground">
              {language === "zh" ? "返回" : "Back"}
            </Text>
          </Pressable>

          {!sent ? (
            <>
              {/* 标题 */}
              <View className="gap-2 mb-4">
                <Text className="text-3xl font-bold text-foreground">
                  {language === "zh" ? "重置密码" : "Reset Password"}
                </Text>
                <Text className="text-base text-muted">
                  {language === "zh"
                    ? "输入您的邮箱地址，我们将发送密码重置链接"
                    : "Enter your email address and we'll send you a password reset link"}
                </Text>
              </View>

              {/* 邮箱输入 */}
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {language === "zh" ? "邮箱地址" : "Email Address"}
                </Text>
                <View className="flex-row items-center gap-3 bg-surface rounded-lg px-4 py-3">
                  <MaterialIcons name="email" size={20} color={colors.muted} />
                  <TextInput
                    placeholder={language === "zh" ? "输入您的邮箱" : "Enter your email"}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    editable={!loading}
                    placeholderTextColor={colors.muted}
                    className="flex-1 text-foreground"
                  />
                </View>
              </View>

              {/* 发送按钮 */}
              <Pressable
                onPress={handleSendReset}
                disabled={loading}
                className={`bg-primary rounded-lg py-4 items-center justify-center ${
                  loading ? "opacity-50" : ""
                }`}
              >
                <Text className="text-white font-bold text-lg">
                  {loading
                    ? language === "zh"
                      ? "发送中..."
                      : "Sending..."
                    : language === "zh"
                    ? "发送重置链接"
                    : "Send Reset Link"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              {/* 成功提示 */}
              <View className="items-center gap-4">
                <View className="w-20 h-20 rounded-full bg-success/20 items-center justify-center">
                  <MaterialIcons name="check-circle" size={48} color={colors.success} />
                </View>
                <View className="gap-2 items-center">
                  <Text className="text-2xl font-bold text-foreground">
                    {language === "zh" ? "邮件已发送" : "Email Sent"}
                  </Text>
                  <Text className="text-base text-muted text-center">
                    {language === "zh"
                      ? `我们已向 ${email} 发送了密码重置链接。请检查您的邮箱。`
                      : `We've sent a password reset link to ${email}. Please check your email.`}
                  </Text>
                </View>
              </View>

              {/* 返回登录按钮 */}
              <Pressable
                onPress={() => router.push("/auth/login")}
                className="bg-primary rounded-lg py-4 items-center justify-center"
              >
                <Text className="text-white font-bold text-lg">
                  {language === "zh" ? "返回登录" : "Back to Login"}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
