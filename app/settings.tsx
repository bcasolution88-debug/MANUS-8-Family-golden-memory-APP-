import { ScrollView, Text, View, Pressable, Switch, Modal, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

export default function SettingsScreen() {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const colors = useColors();
  const [notifications, setNotifications] = useState(true);
  const [comments, setComments] = useState(true);
  const [likes, setLikes] = useState(true);
  const [shares, setShares] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [storageUsed, setStorageUsed] = useState(2.5);
  const [storageTotal] = useState(10);

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? "设置" : "Settings"}
            </Text>
            <View className="w-10" />
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 通知设置 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "通知偏好" : "Notification Preferences"}
              </Text>

              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="notifications" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "启用通知" : "Enable Notifications"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "接收所有通知"
                        : "Receive all notifications"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={notifications}
                  onValueChange={setNotifications}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {notifications && (
                <>
                  <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name="message" size={24} color={colors.primary} />
                      <View>
                        <Text className="font-semibold text-foreground">
                          {language === "zh" ? "评论通知" : "Comment Notifications"}
                        </Text>
                      </View>
                    </View>
                    <Switch
                      value={comments}
                      onValueChange={setComments}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>

                  <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name="favorite" size={24} color={colors.primary} />
                      <View>
                        <Text className="font-semibold text-foreground">
                          {language === "zh" ? "点赞通知" : "Like Notifications"}
                        </Text>
                      </View>
                    </View>
                    <Switch
                      value={likes}
                      onValueChange={setLikes}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>

                  <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name="share" size={24} color={colors.primary} />
                      <View>
                        <Text className="font-semibold text-foreground">
                          {language === "zh" ? "分享通知" : "Share Notifications"}
                        </Text>
                      </View>
                    </View>
                    <Switch
                      value={shares}
                      onValueChange={setShares}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>
                </>
              )}
            </View>

            {/* 隐私控制 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "隐私控制" : "Privacy Control"}
              </Text>

              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="lock" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "私密相册" : "Private Album"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "仅自己可见"
                        : "Only visible to you"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isPrivate}
                  onValueChange={setIsPrivate}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="visibility" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "隐藏我的活动" : "Hide My Activity"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "不显示我的点赞和评论"
                        : "Don't show my likes and comments"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="block" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "屏蔽用户" : "Block Users"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "管理屏蔽的用户"
                        : "Manage blocked users"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 存储管理 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "存储管理" : "Storage Management"}
              </Text>

              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">
                    {language === "zh" ? "已使用" : "Used"}
                  </Text>
                  <Text className="font-semibold text-foreground">
                    {storageUsed} GB / {storageTotal} GB
                  </Text>
                </View>

                <View className="w-full h-2 rounded-full overflow-hidden bg-border">
                  <View
                    className="h-full bg-primary"
                    style={{ width: `${(storageUsed / storageTotal) * 100}%` }}
                  />
                </View>

                <Text className="text-xs text-muted">
                  {language === "zh"
                    ? `还有 ${(storageTotal - storageUsed).toFixed(1)} GB 可用空间`
                    : `${(storageTotal - storageUsed).toFixed(1)} GB available`}
                </Text>
              </View>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="delete" size={24} color={colors.error} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "清除缓存" : "Clear Cache"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "释放存储空间"
                        : "Free up storage space"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 账户绑定 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "账户绑定" : "Account Binding"}
              </Text>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="email" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "邮箱" : "Email"}
                    </Text>
                    <Text className="text-xs text-muted">xiaoya@example.com</Text>
                  </View>
                </View>
                <MaterialIcons name="check-circle" size={24} color={colors.success} />
              </Pressable>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="phone" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "手机号" : "Phone Number"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "未绑定" : "Not bound"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="account-circle" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "社交账户" : "Social Accounts"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "连接社交媒体" : "Connect social media"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 数据导出 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "数据导出" : "Data Export"}
              </Text>

              <Pressable
                onPress={() => setShowExportModal(true)}
                className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80"
              >
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="download" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "导出数据" : "Export Data"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "下载您的所有数据"
                        : "Download all your data"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="backup" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "自动备份" : "Auto Backup"}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh"
                        ? "每周自动备份"
                        : "Auto backup weekly"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={true}
                  onValueChange={() => {}}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </Pressable>
            </View>

            {/* 关于和帮助 */}
            <View className="gap-3">
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="help" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "帮助与反馈" : "Help & Feedback"}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

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
          </View>
        </View>
      </ScrollView>

      {/* 导出数据模态框 */}
      <Modal
        visible={showExportModal}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">
              {language === "zh" ? "导出数据" : "Export Data"}
            </Text>

            <View className="gap-3">
              <Pressable className="bg-surface rounded-2xl p-4 active:opacity-80">
                <Text className="font-semibold text-foreground">
                  {language === "zh" ? "导出为 ZIP" : "Export as ZIP"}
                </Text>
                <Text className="text-xs text-muted mt-1">
                  {language === "zh"
                    ? "包含所有照片、视频和数据"
                    : "Include all photos, videos and data"}
                </Text>
              </Pressable>

              <Pressable className="bg-surface rounded-2xl p-4 active:opacity-80">
                <Text className="font-semibold text-foreground">
                  {language === "zh" ? "导出为 CSV" : "Export as CSV"}
                </Text>
                <Text className="text-xs text-muted mt-1">
                  {language === "zh"
                    ? "仅导出元数据"
                    : "Export metadata only"}
                </Text>
              </Pressable>

              <Pressable className="bg-surface rounded-2xl p-4 active:opacity-80">
                <Text className="font-semibold text-foreground">
                  {language === "zh" ? "导出为 PDF" : "Export as PDF"}
                </Text>
                <Text className="text-xs text-muted mt-1">
                  {language === "zh"
                    ? "生成可打印的报告"
                    : "Generate printable report"}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => setShowExportModal(false)}
              className="bg-surface rounded-full py-3 items-center justify-center active:opacity-80"
            >
              <Text className="font-semibold text-foreground">
                {language === "zh" ? "关闭" : "Close"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
