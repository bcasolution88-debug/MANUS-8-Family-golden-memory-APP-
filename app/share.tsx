import { ScrollView, Text, View, Pressable, TextInput, FlatList, Modal, ActivityIndicator } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useBackHandler } from "@/hooks/use-back-handler";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { EXPIRY_PRESETS, ShareLinkCard, type ShareLinkItem } from "@/components/share-link-card";
import { trpc } from "@/lib/trpc";

const SHARE_OPTIONS = [
  { id: 1, name: "微信", nameEn: "WeChat", icon: "wechat", color: "#09B981" },
  { id: 2, name: "QQ", nameEn: "QQ", icon: "qq", color: "#0084FF" },
  { id: 3, name: "微博", nameEn: "Weibo", icon: "weibo", color: "#E1306C" },
  { id: 4, name: "Instagram", nameEn: "Instagram", icon: "instagram", color: "#E1306C" },
  { id: 5, name: "Facebook", nameEn: "Facebook", icon: "facebook", color: "#1877F2" },
  { id: 6, name: "WhatsApp", nameEn: "WhatsApp", icon: "whatsapp", color: "#25D366" },
];

type ExpiryKey = (typeof EXPIRY_PRESETS)[number]["key"];

export default function ShareScreen() {
  const router = useRouter();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [newLinkExpiry, setNewLinkExpiry] = useState<ExpiryKey>("30d");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  /** Share currently targeted by the expiry / revoke sheets. */
  const [expiryTarget, setExpiryTarget] = useState<ShareLinkItem | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ShareLinkItem | null>(null);

  /* ------------------------------ data ------------------------------ */

  const families = trpc.family.getUserFamilies.useQuery(undefined, { enabled: isAuthenticated });
  const familyId = families.data?.[0]?.id;

  const albums = trpc.album.list.useQuery(
    { familyId: familyId ?? 0, take: 50 },
    { enabled: isAuthenticated && !!familyId },
  );

  useEffect(() => {
    if (selectedAlbumId === null && albums.data?.length) setSelectedAlbumId(albums.data[0].id);
  }, [albums.data, selectedAlbumId]);

  const shares = trpc.interaction.getShares.useQuery(
    { albumId: selectedAlbumId ?? 0, status: showInactive ? "all" : "active", take: 50 },
    { enabled: isAuthenticated && !!selectedAlbumId },
  );

  const shareList = useMemo<ShareLinkItem[]>(() => (shares.data ?? []) as ShareLinkItem[], [shares.data]);
  const activeShare = shareList.find((s) => s.status === "active") ?? null;
  const stats = useMemo(
    () => ({
      links: shareList.length,
      active: shareList.filter((s) => s.status === "active").length,
      clicks: shareList.reduce((sum, s) => sum + s.clicks, 0),
    }),
    [shareList],
  );

  const invalidateShares = () => utils.interaction.getShares.invalidate();

  const createShare = trpc.interaction.createShare.useMutation({
    onSuccess: async (share) => {
      await invalidateShares();
      await Clipboard.setStringAsync(share.shareUrl);
      toast.success(t("share.linkCreated"));
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeShare = trpc.interaction.revokeShare.useMutation({
    onSuccess: async () => {
      await invalidateShares();
      setRevokeTarget(null);
      toast.success(t("share.revoked"));
    },
    onError: (e) => toast.error(e.message),
  });
  const updateExpiry = trpc.interaction.updateShareExpiry.useMutation({
    onSuccess: async () => {
      await invalidateShares();
      setExpiryTarget(null);
      toast.success(t("share.expiryUpdated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const busy = createShare.isPending || revokeShare.isPending || updateExpiry.isPending;

  // Android back closes whichever sheet is open before leaving the screen.
  useBackHandler(!!expiryTarget || !!revokeTarget || showInviteModal, () => {
    setExpiryTarget(null);
    setRevokeTarget(null);
    setShowInviteModal(false);
    return true;
  });

  /* ----------------------------- actions ---------------------------- */

  const handleCreateLink = () => {
    if (!selectedAlbumId) return;
    const preset = EXPIRY_PRESETS.find((p) => p.key === newLinkExpiry);
    createShare.mutate({
      albumId: selectedAlbumId,
      platform: "link",
      caption: shareMessage.trim() || undefined,
      expiresInDays: preset?.days ?? undefined,
    });
  };

  const handleCopy = async (url: string) => {
    await Clipboard.setStringAsync(url);
    toast.success(t("share.shareLinkCopiedTo"));
  };

  const handleShare = (platform: string) => {
    if (activeShare) void Clipboard.setStringAsync(activeShare.shareUrl);
    toast.success(t("share.sharedToPlatform", { platform }));
  };

  const handleSendInvite = () => {
    if (!inviteEmail.trim()) {
      toast.warning(t("common.pleaseEnterEmailAddress"));
      return;
    }
    toast.success(t("common.invitationSentToInviteemail", { inviteEmail }));
    setInviteEmail("");
    setShowInviteModal(false);
  };

  /* ----------------------------- render ----------------------------- */

  const renderShareOption = ({ item }: { item: (typeof SHARE_OPTIONS)[number] }) => (
    <Pressable onPress={() => handleShare(l(item.name, item.nameEn))} className="flex-1 mx-2 mb-4 active:opacity-80">
      <View className="gap-2 items-center">
        <View className="w-16 h-16 rounded-full items-center justify-center" style={{ backgroundColor: item.color + "20" }}>
          <MaterialIcons name="share" size={28} color={item.color} />
        </View>
        <Text className="text-sm font-semibold text-foreground text-center">{l(item.name, item.nameEn)}</Text>
      </View>
    </Pressable>
  );

  const ExpiryChips = ({ value, onChange }: { value: ExpiryKey; onChange: (k: ExpiryKey) => void }) => (
    <View className="flex-row flex-wrap gap-2">
      {EXPIRY_PRESETS.map((p) => (
        <Pressable
          key={p.key}
          onPress={() => onChange(p.key)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === p.key }}
          className={`px-4 py-2 min-h-[44px] justify-center rounded-full ${value === p.key ? "bg-primary" : "bg-surface"}`}
        >
          <Text className={`text-sm font-semibold ${value === p.key ? "text-onPrimary" : "text-foreground"}`}>
            {t(`share.expiry.${p.key}` as any)}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{t("common.share")}</Text>
            <View className="w-10" />
          </View>

          <View className="flex-1 px-6 py-4 gap-6">
            {!isAuthenticated ? (
              <View className="items-center justify-center gap-3 py-16">
                <MaterialIcons name="lock-outline" size={48} color={colors.muted} />
                <Text className="text-lg font-semibold text-foreground">{t("messages.signInToSee")}</Text>
              </View>
            ) : (
              <>
                {/* 选择相册 */}
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">{t("common.selectAlbum")}</Text>
                  {albums.isLoading ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <FlatList
                      data={albums.data ?? []}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyExtractor={(item) => String(item.id)}
                      contentContainerStyle={{ gap: 8 }}
                      renderItem={({ item }) => (
                        <Pressable
                          onPress={() => setSelectedAlbumId(item.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: selectedAlbumId === item.id }}
                          className={`px-4 py-3 min-h-[48px] justify-center rounded-2xl ${
                            selectedAlbumId === item.id ? "bg-primary/20 border-2 border-primary" : "bg-surface"
                          }`}
                        >
                          <Text className="font-semibold text-foreground">{item.name}</Text>
                          <Text className="text-xs text-muted">{item.mediaCount} {t("photos")}</Text>
                        </Pressable>
                      )}
                    />
                  )}
                </View>

                {/* 生成新链接 */}
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">{t("share.createLink")}</Text>
                  <View className="bg-surface rounded-2xl p-4 gap-3">
                    <Text className="text-sm text-muted">{t("share.expiry")}</Text>
                    <ExpiryChips value={newLinkExpiry} onChange={setNewLinkExpiry} />
                    <TextInput
                      placeholder={t("share.enterShareMessageOptional")}
                      value={shareMessage}
                      onChangeText={setShareMessage}
                      placeholderTextColor={colors.muted}
                      className="bg-background rounded-2xl px-4 py-3 text-foreground"
                      multiline
                      maxLength={200}
                    />
                    <Pressable
                      onPress={handleCreateLink}
                      disabled={!selectedAlbumId || busy}
                      className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 min-h-[48px] active:opacity-80"
                      style={!selectedAlbumId || busy ? { opacity: 0.6 } : undefined}
                    >
                      {createShare.isPending ? (
                        <ActivityIndicator color={colors.onPrimary} />
                      ) : (
                        <MaterialIcons name="add-link" size={20} color={colors.onPrimary} />
                      )}
                      <Text className="text-onPrimary font-bold text-lg">{t("share.createLink")}</Text>
                    </Pressable>
                  </View>
                </View>

                {/* 我的分享链接 */}
                <View className="gap-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-lg font-bold text-foreground">{t("share.myLinks")}</Text>
                    <Pressable
                      onPress={() => setShowInactive((v) => !v)}
                      className="px-3 py-2 min-h-[44px] justify-center"
                    >
                      <Text className="text-sm font-semibold text-primary">
                        {showInactive ? t("share.hideInactive") : t("share.showAll")}
                      </Text>
                    </Pressable>
                  </View>
                  {shares.isLoading ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : shareList.length === 0 ? (
                    <View className="bg-surface rounded-2xl p-6 items-center gap-2">
                      <MaterialIcons name="link-off" size={32} color={colors.muted} />
                      <Text className="text-sm text-muted">{t("share.noLinks")}</Text>
                    </View>
                  ) : (
                    shareList.map((share) => (
                      <ShareLinkCard
                        key={share.id}
                        share={share}
                        busy={busy}
                        onCopy={() => void handleCopy(share.shareUrl)}
                        onChangeExpiry={() => setExpiryTarget(share)}
                        onRevoke={() => setRevokeTarget(share)}
                      />
                    ))
                  )}
                </View>

                {/* 社交分享 */}
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">{t("common.shareToSocialMedia")}</Text>
                  <FlatList
                    data={SHARE_OPTIONS}
                    renderItem={renderShareOption}
                    keyExtractor={(item) => item.id.toString()}
                    numColumns={3}
                    scrollEnabled={false}
                    columnWrapperStyle={{ gap: 0 }}
                  />
                </View>

                {/* 邀请成员 */}
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">{t("share.inviteMembers")}</Text>
                  <Pressable
                    onPress={() => setShowInviteModal(true)}
                    className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 min-h-[48px] active:opacity-80"
                  >
                    <MaterialIcons name="person-add" size={20} color={colors.onPrimary} />
                    <Text className="text-onPrimary font-bold text-lg">{t("share.inviteMembers")}</Text>
                  </Pressable>
                </View>

                {/* 分享统计 */}
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">{t("share.shareStatistics")}</Text>
                  <View className="flex-row gap-3">
                    <View className="flex-1 bg-surface rounded-2xl p-4 items-center gap-2">
                      <MaterialIcons name="visibility" size={28} color={colors.primary} />
                      <Text className="text-2xl font-bold text-foreground">{stats.clicks}</Text>
                      <Text className="text-xs text-muted">{t("share.views")}</Text>
                    </View>
                    <View className="flex-1 bg-surface rounded-2xl p-4 items-center gap-2">
                      <MaterialIcons name="link" size={28} color={colors.primary} />
                      <Text className="text-2xl font-bold text-foreground">
                        {stats.active}/{stats.links}
                      </Text>
                      <Text className="text-xs text-muted">{t("share.status.active")}</Text>
                    </View>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {/* 修改有效期 */}
      <Modal visible={!!expiryTarget} transparent animationType="fade" onRequestClose={() => setExpiryTarget(null)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">{t("share.expiry")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {EXPIRY_PRESETS.map((p) => (
                <Pressable
                  key={p.key}
                  disabled={updateExpiry.isPending}
                  onPress={() => expiryTarget && updateExpiry.mutate({ id: expiryTarget.id, expiresInDays: p.days })}
                  className="px-4 py-2 min-h-[48px] justify-center rounded-full bg-surface active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-foreground">{t(`share.expiry.${p.key}` as any)}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => setExpiryTarget(null)}
              className="bg-surface rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
            >
              <Text className="font-semibold text-foreground">{t("cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 撤销确认 */}
      <Modal visible={!!revokeTarget} transparent animationType="fade" onRequestClose={() => setRevokeTarget(null)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="link-off" size={24} color={colors.error} />
              <Text className="text-2xl font-bold text-foreground">{t("share.revoke")}</Text>
            </View>
            <Text className="text-sm text-muted">{t("share.revokeConfirm")}</Text>
            <Text className="text-xs text-foreground font-mono" numberOfLines={1}>
              {revokeTarget?.shareUrl}
            </Text>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setRevokeTarget(null)}
                className="flex-1 bg-surface rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                disabled={revokeShare.isPending}
                onPress={() => revokeTarget && revokeShare.mutate({ id: revokeTarget.id })}
                className="flex-1 rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
                style={{ backgroundColor: colors.error }}
              >
                {revokeShare.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="font-semibold text-white">{t("share.revoke")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 邀请成员模态框 */}
      <Modal visible={showInviteModal} transparent animationType="fade" onRequestClose={() => setShowInviteModal(false)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">{t("share.inviteMembers")}</Text>
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">{t("common.emailAddress")}</Text>
              <TextInput
                placeholder={t("common.enterEmailAddress")}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                placeholderTextColor={colors.muted}
                className="bg-surface rounded-2xl px-4 py-3 text-foreground"
              />
            </View>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setShowInviteModal(false)}
                className="flex-1 bg-surface rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={handleSendInvite}
                className="flex-1 bg-primary rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-onPrimary">{t("common.sendInvite")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
