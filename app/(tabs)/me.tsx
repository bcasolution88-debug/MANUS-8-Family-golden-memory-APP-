import { ScrollView, Text, View, Pressable, Switch, Modal, TextInput, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useToast } from "@/components/toast";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeContext } from "@/lib/theme-provider";
import { useElderMode, FONT_SCALE_OPTIONS } from "@/lib/elder-mode-provider";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { GradientCard } from "@/components/gradient-card";
import { FamilySwitcher } from "@/components/family-switcher";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { useFamily } from "@/lib/family-provider";

export default function MeScreen() {
  const router = useRouter();
  const { t, language, setLanguage, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const colorScheme = useColorScheme();
  const { setColorScheme } = useThemeContext();
  const isDarkMode = colorScheme === "dark";
  const setIsDarkMode = (dark: boolean) => setColorScheme(dark ? "dark" : "light");
  const elder = useElderMode();
  const isElderMode = elder.enabled;
  const { user, isAuthenticated, refresh, logout } = useAuth();
  const utils = trpc.useUtils();
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editRelationship, setEditRelationship] = useState("");

  // P6: real profile + personal stats
  const me = trpc.auth.me.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const stats = trpc.profile.stats.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const userName = me.data?.name ?? user?.name ?? "";
  const userEmail = me.data?.email ?? user?.email ?? "";
  const userAvatar = me.data?.avatar ?? null;
  const relationship = me.data?.relationship ?? null;

  useEffect(() => {
    if (showEditModal) {
      setEditName(userName);
      setEditRelationship(relationship ?? "");
    }
  }, [showEditModal, userName, relationship]);

  const updateProfile = trpc.profile.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.auth.me.invalidate(), utils.family.getMembers.invalidate(), refresh()]);
      setShowEditModal(false);
      toast.success(l("资料已更新", "Profile updated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSaveProfile = () => {
    if (!editName.trim()) return toast.warning(t("me.name"));
    updateProfile.mutate({ name: editName.trim(), relationship: editRelationship.trim() || null });
  };

  // P7: avatar upload — pick → square crop/resize → presigned PUT → completeAvatarUpload
  const initAvatar = trpc.profile.initAvatarUpload.useMutation();
  const completeAvatar = trpc.profile.completeAvatarUpload.useMutation();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const handlePickAvatar = async () => {
    if (!isAuthenticated || avatarBusy) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return toast.warning(l("需要相册权限才能选择头像", "Photo library permission is required"));
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        exif: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      setAvatarBusy(true);
      const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
      const resized = await manipulateAsync(picked.assets[0].uri, [{ resize: { width: 512 } }], {
        compress: 0.85,
        format: SaveFormat.JPEG,
      });
      const blob = await (await fetch(resized.uri)).blob();
      const init = await initAvatar.mutateAsync({ contentType: "image/jpeg", fileSize: blob.size || undefined });
      if (!init.presignedUrl.startsWith("/")) {
        const put = await fetch(init.presignedUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      }
      await completeAvatar.mutateAsync({ storageKey: init.storageKey });
      await Promise.all([utils.auth.me.invalidate(), utils.family.getMembers.invalidate(), utils.profile.avatarUrl.invalidate(), refresh()]);
      toast.success(l("头像已更新", "Avatar updated"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : l("头像上传失败", "Avatar upload failed"));
    } finally {
      setAvatarBusy(false);
    }
  };

  const { push } = useFamily();
  const handleLogout = async () => {
    // P10: stop push to this device before the session goes away.
    await push.unregister().catch(() => undefined);
    await logout();
    toast.success(t("me.loggedOutSuccessfully"));
    router.replace("/auth/login");
  };

  const statItems = [
    { icon: "photo-library" as const, value: stats.data?.uploads ?? 0, label: l("上传", "Uploads") },
    { icon: "favorite" as const, value: stats.data?.likesReceived ?? 0, label: l("获赞", "Likes") },
    { icon: "chat-bubble" as const, value: stats.data?.commentsReceived ?? 0, label: l("评论", "Comments") },
    { icon: "auto-stories" as const, value: stats.data?.stories ?? 0, label: l("故事", "Stories") },
  ];

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
              {t("me.profile")}
            </Text>
            <Pressable className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="settings" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 用户卡片 */}
            <GradientCard variant="goldToInfo" direction="horizontal" className="rounded-3xl p-6 gap-4">
              <View className="flex-row items-center gap-4">
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={!isAuthenticated || avatarBusy}
                  accessibilityRole="button"
                  accessibilityLabel={l("更换头像", "Change avatar")}
                  className="active:opacity-80"
                  style={{ width: 72, height: 72 }}
                >
                  <View className="rounded-full border-4 border-white overflow-hidden" style={{ width: 72, height: 72 }}>
                    <UserAvatar avatar={userAvatar} name={userName} size={64} bgClassName="bg-white/30" textClassName="text-white" />
                  </View>
                  <View className="absolute -right-1 -bottom-1 w-7 h-7 rounded-full bg-white items-center justify-center" style={{ elevation: 2 }}>
                    {avatarBusy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <MaterialIcons name="photo-camera" size={16} color={colors.primary} />
                    )}
                  </View>
                </Pressable>
                <View className="flex-1">
                  <Text className="text-2xl font-bold text-white" numberOfLines={1}>{userName || l("未登录", "Not signed in")}</Text>
                  <Text className="text-white/80 text-sm" numberOfLines={1}>{relationship ? `${relationship} · ` : ""}{userEmail}</Text>
                </View>
              </View>

              {/* 统计（P6 · profile.stats） */}
              <View className="flex-row gap-2">
                {statItems.map((s) => (
                  <View key={s.label} className="flex-1 items-center bg-white/20 rounded-2xl py-2 gap-0.5">
                    <MaterialIcons name={s.icon} size={16} color="white" />
                    <Text className="text-lg font-bold text-white">{stats.isLoading ? "…" : s.value}</Text>
                    <Text className="text-[10px] text-white/80">{s.label}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                onPress={() => setShowEditModal(true)}
                disabled={!isAuthenticated}
                className="bg-white/20 rounded-full py-2 min-h-[44px] items-center justify-center active:opacity-80"
              >
                <Text className="text-white font-semibold">
                  {t("editProfile")}
                </Text>
              </Pressable>
            </GradientCard>

            {/* 家庭（P6） */}
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">{t("familyMembers")}</Text>
                <Pressable onPress={() => router.push("/members" as any)} className="px-2 min-h-[44px] justify-center">
                  <Text className="text-sm font-semibold text-primary">{t("manage")}</Text>
                </Pressable>
              </View>
              <FamilySwitcher variant="row" />
            </View>

            {/* 账户设置 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("me.accountSettings")}
              </Text>

              {/* 隐私设置 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="lock" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("me.privacySettings")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("me.managePrivacyOptions")}
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
                      {t("me.accountSecurity")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("me.changePasswordAnd2fa")}
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
                      {t("me.dataBackup")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("me.backupYourAlbumsAnd")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 显示设置 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("me.displaySettings")}
              </Text>

              {/* 昼夜模式 */}
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="brightness-4" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("me.darkMode")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {isDarkMode ? (t("me.enabled")) : (t("me.disabled"))}
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
                      {t("language")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("me.english")}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setLanguage(language === "zh" ? "en" : "zh")}
                  className="px-3 py-1 rounded-full bg-primary active:opacity-80"
                >
                  <Text className="text-onPrimary text-xs font-semibold">
                    {language === "zh" ? "EN" : "中文"}
                  </Text>
                </Pressable>
              </View>

              {/* 字体大小 — 三档分段选择，直接驱动 ElderModeProvider.fontScale */}
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="text-fields" size={24} color={colors.primary} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">
                      {t("fontSize")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("me.adjustGlobalTextAnd")}
                    </Text>
                  </View>
                </View>
                <View
                  className="flex-row rounded-full p-1"
                  style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                  accessibilityRole="radiogroup"
                >
                  {FONT_SCALE_OPTIONS.map((opt) => {
                    const active = elder.fontScale === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => elder.setFontScale(opt.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${l(opt.labelZh, opt.labelEn)} ${opt.px}px`}
                        className="flex-1 items-center justify-center rounded-full"
                        style={{ minHeight: 44, backgroundColor: active ? colors.primary : "transparent" }}
                      >
                        <Text
                          className="font-semibold"
                          style={{ color: active ? colors.onPrimary : colors.foreground, fontSize: 12 + (opt.value - 1) * 8 }}
                        >
                          {l(opt.labelZh, opt.labelEn)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* 特殊功能 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("me.specialFeatures")}
              </Text>

              {/* 长辈模式 */}
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="elderly" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("elderModeTitle")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {isElderMode
                        ? t("me.onLargerTextSimplified")
                        : t("me.simplifiedInterfaceLargerText")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isElderMode}
                  onValueChange={(on) => {
                    elder.setEnabled(on);
                    toast.success(
                      on
                        ? t("me.elderModeOnLarger")
                        : t("me.elderModeOff"),
                    );
                    if (on) router.push("/elder-home");
                  }}
                  accessibilityLabel={t("elderModeTitle")}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {/* 帮助与反馈 */}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="help" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("common.helpFeedback")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("me.getHelpOrReport")}
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
                      {t("common.aboutApp")}
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
                {t("logout")}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* 编辑资料模态框 */}
      <Modal
        visible={showEditModal}
        onRequestClose={() => setShowEditModal(false)}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">
              {t("editProfile")}
            </Text>

            <View className="gap-3">
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t("me.name")}
                </Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground"
                />
              </View>

              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">{l("家庭称谓（可选）", "Family role (optional)")}</Text>
                <TextInput
                  value={editRelationship}
                  onChangeText={setEditRelationship}
                  placeholder={l("如：爸爸 / 妈妈 / 女儿", "e.g. Dad / Mom / Daughter")}
                  maxLength={64}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground"
                />
              </View>
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t("email")}
                </Text>
                <View className="bg-surface/60 rounded-2xl px-4 py-3 flex-row items-center justify-between">
                  <Text className="text-muted">{userEmail}</Text>
                  <MaterialIcons name="lock" size={16} color={colors.muted} />
                </View>
                <Text className="text-xs text-muted">{l("邮箱由登录账号绑定，无法在此修改", "Email is bound to your sign-in account")}</Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setShowEditModal(false)}
                className="flex-1 bg-surface rounded-full py-3 items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-foreground">
                  {t("cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSaveProfile}
                disabled={updateProfile.isPending}
                className="flex-1 bg-primary rounded-full py-3 items-center justify-center active:opacity-80"
              >
                {updateProfile.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{t("save")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
