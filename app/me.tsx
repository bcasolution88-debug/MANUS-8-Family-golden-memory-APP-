import { ScrollView, Text, View, Pressable, Image, Switch, Modal, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

export default function MeScreen() {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const [isDarkMode, setIsDarkMode] = useState(colorScheme === "dark");
  const [isElderMode, setIsElderMode] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [userName, setUserName] = useState("小雅");
  const [userEmail, setUserEmail] = useState("xiaoya@example.com");
  const [editName, setEditName] = useState(userName);
  const [editEmail, setEditEmail] = useState(userEmail);

  const handleSaveProfile = () => {
    setUserName(editName);
    setUserEmail(editEmail);
    setShowEditModal(false);
  };

  const handleLogout = () => {
    alert(language === "zh" ? "已退出登录" : "Logged out successfully");
    router.replace("/auth/login");
  };

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? "我的" : "Profile"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="settings" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 用户卡片 */}
            <View className="bg-gradient-to-r from-primary to-blue-500 rounded-3xl p-6 gap-4">
              <View className="flex-row items-center gap-4">
                <Image
                  source={{ uri: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80" }}
                  className="w-16 h-16 rounded-full border-4 border-white"
                />
                <View className="flex-1">
                  <Text className="text-2xl font-bold text-white">{userName}</Text>
                  <Text className="text-white/80 text-sm">{userEmail}</Text>
                </View>
              </View>

              <Pressable
                onPress={() => {
                  setEditName(userName);
                  setEditEmail(userEmail);
                  setShowEditModal(true);
                }}
                className="bg-white/20 rounded-full py-2 items-center justify-center active:opacity-80"
              >
                <Text className="text-white font-semibold">
                  {language === "zh" ? "编辑资料" : "Edit Profile"}
                </Text>
              </Pressable>
            </View>

            {/* 账户设置 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "账户设置" : "Account Settings"}
              </Text>

              {/* 隐私设置 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="lock" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "隐私设置" : "Privacy Settings"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "管理您的隐私选项" : "Manage privacy options"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              {/* 账户安全 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="security" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "账户安全" : "Account Security"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "修改密码和两步验证" : "Change password and 2FA"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              {/* 数据备份 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="backup" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "数据备份" : "Data Backup"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "备份您的相册和故事" : "Backup your albums and stories"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 显示设置 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "显示设置" : "Display Settings"}
              </Text>

              {/* 昼夜模式 */}
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="brightness-4" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "深色模式" : "Dark Mode"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {isDarkMode ? (language === "zh" ? "已启用" : "Enabled") : (language === "zh" ? "已禁用" : "Disabled")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isDarkMode}
                  onValueChange={setIsDarkMode}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {/* 语言设置 */}
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="language" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "语言" : "Language"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "中文" : "English"}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setLanguage(language === "zh" ? "en" : "zh")}
                  className="px-3 py-1 rounded-full bg-primary active:opacity-80"
                >
                  <Text className="text-white text-xs font-semibold">
                    {language === "zh" ? "EN" : "中文"}
                  </Text>
                </Pressable>
              </View>

              {/* 字体大小 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="text-fields" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "字体大小" : "Font Size"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "调整文字大小" : "Adjust text size"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 特殊功能 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "特殊功能" : "Special Features"}
              </Text>

              {/* 长辈模式 */}
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="elderly" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "长辈模式" : "Elder Mode"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "简化界面，放大字体"
                        : "Simplified interface, larger text"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isElderMode}
                  onValueChange={setIsElderMode}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {/* 帮助与反馈 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="help" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "帮助与反馈" : "Help & Feedback"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "获取帮助或反馈问题" : "Get help or report issues"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              {/* 关于应用 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="info" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "关于应用" : "About App"}
                    </Text>
                    <Text className="text-xs text-muted">v1.0.0</Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 退出登录按钮 */}
            <Pressable
              onPress={handleLogout}
              className="bg-error rounded-full py-4 items-center justify-center active:opacity-80"
            >
              <Text className="text-white font-bold text-lg">
                {language === "zh" ? "退出登录" : "Logout"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* 编辑资料模态框 */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">
              {language === "zh" ? "编辑资料" : "Edit Profile"}
            </Text>

            <View className="gap-3">
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {language === "zh" ? "名字" : "Name"}
                </Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground"
                />
              </View>

              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {language === "zh" ? "邮箱" : "Email"}
                </Text>
                <TextInput
                  value={editEmail}
                  onChangeText={setEditEmail}
                  keyboardType="email-address"
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground"
                />
              </View>
            </View>

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setShowEditModal(false)}
                className="flex-1 bg-surface rounded-full py-3 items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-foreground">
                  {language === "zh" ? "取消" : "Cancel"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSaveProfile}
                className="flex-1 bg-primary rounded-full py-3 items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-white">
                  {language === "zh" ? "保存" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
