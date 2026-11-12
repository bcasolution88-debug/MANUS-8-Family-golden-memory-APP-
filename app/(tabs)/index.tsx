import { ScrollView, Text, View, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { UserAvatar } from "@/components/user-avatar";
import { useEffect, useMemo } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useFamilyId } from "@/hooks/use-family-id";
import { useUnreadCount } from "@/hooks/use-unread-count";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { GradientCard } from "@/components/gradient-card";
import { SignedImage } from "@/components/signed-image";
import { FamilySwitcher } from "@/components/family-switcher";
import { AIInsightsCard } from "@/components/ai-insights-card";
import { trpc } from "@/lib/trpc";
import { consumePendingInviteCode } from "@/lib/invite-link";

// Mock data - 将来从API获取
const MOCK_FAMILY = {
  name: "陈爸爸 & 陈妈妈",
  nameEn: "Dad & Mom",
  yearsTogetherCn: "幸福 50 年",
  yearsTogetherEn: "Together for 50 wonderful years",
  memberCount: 11,
  members: [
    { id: 1, name: "陈爸爸", role: "长辈", image: "https://images.unsplash.com/photo-1547559906-41b45c308f73?w=100&q=80" },
    { id: 2, name: "陈妈妈", role: "主角", image: "https://images.unsplash.com/photo-1566616213894-2d4e1baee5d8?w=100&q=80" },
    { id: 3, name: "小雅", role: "管理", image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80" },
    { id: 4, name: "小明", role: "", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80" },
    { id: 5, name: "晶晶", role: "", image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=100&q=80" },
  ],
};

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ANNIVERSARY_LABEL: Record<string, [string, string]> = {
  silver: ["银婚", "Silver"],
  golden: ["金婚", "Golden"],
  diamond: ["钻石婚", "Diamond"],
  platinum: ["白金婚", "Platinum"],
};

type RecentItem = {
  id: number;
  type: "photo" | "video";
  title: string | null;
  description: string | null;
  uploadedBy: number;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  albumName: string;
};

/**
 * Home (P5 — real data). Family card ← family.getUserFamilies + getMembers;
 * countdown ← family.getAnniversaries (nearest upcoming); featured memories ←
 * media.recent (family-wide, newest first, SignedImage thumbnails); badge ←
 * notification.unreadCount. Signed-out visitors see the static showcase.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const { familyId, family, isAuthenticated } = useFamilyId();
  const unread = useUnreadCount();

  // P7: a `/join?code=` link opened while signed out parks its code; replay it now.
  useEffect(() => {
    if (!isAuthenticated) return;
    void consumePendingInviteCode().then((code) => {
      if (code) router.push({ pathname: "/join", params: { code } });
    });
  }, [isAuthenticated, router]);

  const members = trpc.family.getMembers.useQuery({ familyId: familyId ?? 0 }, { enabled: !!familyId, staleTime: 60_000 });
  const anniversaries = trpc.family.getAnniversaries.useQuery({ familyId: familyId ?? 0 }, { enabled: !!familyId, staleTime: 60_000 });
  const recent = trpc.media.recent.useQuery({ familyId: familyId ?? 0, take: 6 }, { enabled: !!familyId });

  const memberList = useMemo(
    () =>
      members.data?.map((m) => ({
        id: m.userId,
        name: m.user.name ?? t("notif.someone"),
        avatar: m.user.avatar,
        role: m.role === "owner" ? l("创建者", "Owner") : m.role === "admin" ? l("管理", "Admin") : m.role === "viewer" ? l("观看者", "Viewer") : "",
      })) ?? [],
    [members.data, l, t],
  );

  /** Nearest upcoming anniversary (recurring yearly from its date). */
  const nextAnniversary = useMemo(() => {
    const list = anniversaries.data ?? [];
    if (list.length === 0) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return list
      .map((a) => {
        const base = new Date(a.date);
        const next = new Date(today.getFullYear(), base.getMonth(), base.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        const years = next.getFullYear() - base.getFullYear();
        const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
        return { ...a, next, years, days };
      })
      .sort((x, y) => x.days - y.days)[0];
  }, [anniversaries.data]);

  const nameOf = (userId: number) => memberList.find((m) => m.id === userId)?.name ?? t("notif.someone");
  const fmtDate = (d: Date | string) => {
    const dt = new Date(d);
    return { md: `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`, wd: (language === "zh" ? WEEKDAYS_ZH : WEEKDAYS_EN)[dt.getDay()] };
  };

  const renderRecentItem = (item: RecentItem) => {
    const { md, wd } = fmtDate(item.createdAt);
    return (
      <Pressable
        key={item.id}
        onPress={() => router.push((item.type === "video" ? `/video/${item.id}` : `/photo/${item.id}`) as any)}
        accessibilityRole="button"
        accessibilityLabel={item.title ?? item.albumName}
        className="mb-4 bg-surface rounded-2xl overflow-hidden active:opacity-80"
      >
        <View className="flex-row">
          <View className="w-16 bg-primary/10 items-center justify-center py-4">
            <Text className="text-lg font-bold text-primary">{md}</Text>
            <Text className="text-xs text-muted">{wd}</Text>
          </View>
          <View className="flex-1 p-3 gap-2">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name={item.type === "video" ? "videocam" : "image"} size={16} color={colors.muted} />
              <Text className="text-xs text-muted" numberOfLines={1}>{item.albumName}</Text>
            </View>
            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{item.title ?? item.albumName}</Text>
            {item.description ? <Text className="text-xs text-muted" numberOfLines={2}>{item.description}</Text> : null}
            <View className="flex-row items-center justify-between mt-1">
              <Text className="text-xs text-muted">{nameOf(item.uploadedBy)}</Text>
              <View className="flex-row items-center gap-3">
                <View className="flex-row items-center gap-1">
                  <MaterialIcons name="favorite" size={14} color={colors.muted} />
                  <Text className="text-xs text-muted">{item.likeCount}</Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <MaterialIcons name="comment" size={14} color={colors.muted} />
                  <Text className="text-xs text-muted">{item.commentCount}</Text>
                </View>
              </View>
            </View>
          </View>
          <View className="w-20 h-24">
            <SignedImage mediaId={item.id} className="w-20 h-24" />
            {item.type === "video" && (
              <View className="absolute inset-0 items-center justify-center">
                <MaterialIcons name="play-circle" size={24} color="white" />
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  const familyName = family?.name ?? MOCK_FAMILY.name;
  const memberCount = isAuthenticated ? memberList.length : MOCK_FAMILY.memberCount;
  const avatars = isAuthenticated ? memberList : MOCK_FAMILY.members.map((m) => ({ id: m.id, name: m.name, avatar: m.image, role: m.role }));

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={recent.isRefetching}
            onRefresh={() => { void recent.refetch(); void anniversaries.refetch(); void members.refetch(); }}
            tintColor={colors.primary}
          />
        }
      >
        <View className="flex-1">
          {/* 顶部导航栏 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <View className="flex-1 gap-1">
              <Text className="text-lg font-bold text-foreground">
                {t("ourFamilyAlbum")}
              </Text>
              <View className="flex-row">
                <FamilySwitcher variant="chip" />
              </View>
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/messages" as any)}
              accessibilityRole="button"
              accessibilityLabel={t("messages")}
              className="relative p-2 min-w-[48px] min-h-[48px] items-center justify-center"
            >
              <MaterialIcons name="notifications" size={24} color={colors.foreground} />
              {unread.total > 0 && (
                <View
                  className="absolute top-1 right-1 min-w-[20px] h-5 px-1 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.error }}
                >
                  <Text className="text-xs font-bold text-white">{unread.total > 99 ? "99+" : unread.total}</Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 我们的幸福卡片 */}
            <GradientCard variant="primarySoft" className="rounded-3xl p-6 gap-4">
              <View className="flex-row items-center gap-3">
                <View
                  className="w-16 h-16 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <MaterialIcons name="favorite" size={32} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground">
                    {t("ourFamily")} 💍
                  </Text>
                  <Text className="text-sm text-muted">
                    {t("home.ourFamilyAlbumMembercount", { memberCount })}
                  </Text>
                </View>
              </View>

              {/* 家庭成员头像圈 */}
              <View className="flex-row items-center gap-2">
                {avatars.slice(0, 5).map((member, index) => (
                  <View
                    key={member.id}
                    className="rounded-full border-2 overflow-hidden"
                    style={{ borderColor: colors.background, marginLeft: index > 0 ? -8 : 0 }}
                  >
                    <UserAvatar avatar={member.avatar} name={member.name} size={36} bgClassName="bg-primary" textClassName="text-onPrimary" />
                  </View>
                ))}
                {memberCount > 5 && (
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center border-2"
                    style={{ borderColor: colors.background, backgroundColor: colors.surface }}
                  >
                    <Text className="text-xs font-bold text-foreground">
                      +{memberCount - 5}
                    </Text>
                  </View>
                )}
              </View>

              {/* 长辈信息 */}
              <View className="gap-1">
                <Text className="text-sm font-semibold text-foreground">
                  {familyName}
                </Text>
                <Text className="text-xs text-muted">
                  {family?.description ?? l(MOCK_FAMILY.yearsTogetherCn, MOCK_FAMILY.yearsTogetherEn)}
                </Text>
              </View>
            </GradientCard>

            {/* 纪念日倒计时卡片 */}
            <Pressable
              onPress={() => router.push("/anniversary")}
              accessibilityRole="button"
              accessibilityLabel={t("home.viewGoldenAnniversary")}
              className="active:opacity-80"
            >
              <GradientCard variant="gold" direction="horizontal" className="rounded-3xl p-6 gap-3">
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-sm font-semibold text-onPrimary opacity-80">
                      🏆 {nextAnniversary ? `${l(...ANNIVERSARY_LABEL[nextAnniversary.type])} · ${nextAnniversary.years}${l("年", "y")} · ${nextAnniversary.couple}` : t("goldenAnniversary")}
                    </Text>
                    <Text className="text-lg font-bold text-onPrimary">
                      {nextAnniversary ? `${nextAnniversary.days} ${t("daysUntil")}` : l("添加纪念日", "Add an anniversary")}
                    </Text>
                  </View>
                  <MaterialIcons name="arrow-forward" size={24} color={colors.onPrimary} />
                </View>
              </GradientCard>
            </Pressable>

            {/* 快速操作按钮 */}
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => router.push("/album/new" as any)}
                accessibilityRole="button"
                className="flex-1 bg-primary rounded-2xl py-4 items-center justify-center active:opacity-80 gap-2"
              >
                <MaterialIcons name="add-photo-alternate" size={24} color={colors.onPrimary} />
                <Text className="text-sm font-semibold text-onPrimary text-center">
                  {t("createAlbum")}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/studio")}
                accessibilityRole="button"
                className="flex-1 bg-info rounded-2xl py-4 items-center justify-center active:opacity-80 gap-2"
              >
                <MaterialIcons name="video-library" size={24} color="white" />
                <Text className="text-sm font-semibold text-white text-center">
                  {t("makeVideoBtn")}
                </Text>
              </Pressable>
            </View>

            {/* P8: 智能推荐（真实活动，无 LLM） */}
            {isAuthenticated && familyId ? <AIInsightsCard familyId={familyId} /> : null}

            {/* 回忆时光标题 */}
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-foreground">
                {t("timeline")}
              </Text>
              <Pressable onPress={() => router.push("/(tabs)/timeline" as any)} className="px-2 min-h-[44px] justify-center">
                <Text className="text-sm text-primary font-semibold">
                  {t("more")}
                </Text>
              </Pressable>
            </View>

            {/* 精选回忆（真实数据） */}
            {!isAuthenticated ? (
              <View className="bg-surface rounded-2xl p-6 items-center gap-2">
                <MaterialIcons name="lock-outline" size={32} color={colors.muted} />
                <Text className="text-sm text-muted">{t("messages.signInToSee")}</Text>
              </View>
            ) : recent.isLoading ? (
              <ActivityIndicator color={colors.primary} className="py-6" />
            ) : (recent.data?.length ?? 0) === 0 ? (
              <Pressable onPress={() => router.push("/upload" as any)} className="bg-surface rounded-2xl p-6 items-center gap-2 active:opacity-80">
                <MaterialIcons name="add-photo-alternate" size={32} color={colors.primary} />
                <Text className="text-sm text-muted">{l("还没有回忆，上传第一张照片吧", "No memories yet — upload the first photo")}</Text>
              </Pressable>
            ) : (
              <View>{(recent.data as RecentItem[]).map(renderRecentItem)}</View>
            )}

            {/* 家庭成员区域 */}
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">
                  {t("familyMembers")}
                </Text>
                <Pressable               onPress={() => router.push("/members")}>
                  <Text className="text-sm text-primary font-semibold">
                    {t("manage")}
                  </Text>
                </Pressable>
              </View>

              {/* 成员卡片网格 */}
              <View className="flex-row flex-wrap gap-2">
                {avatars.map((member) => (
                  <Pressable
                    key={member.id}
                    onPress={() => router.push("/members" as any)}
                    className="flex-1 min-w-[45%] bg-surface rounded-2xl p-3 items-center gap-2 active:opacity-80"
                  >
                    <UserAvatar avatar={member.avatar} name={member.name} size={48} bgClassName="bg-primary" textClassName="text-onPrimary" />
                    <Text className="text-xs font-semibold text-foreground text-center">
                      {member.name}
                    </Text>
                    {member.role && (
                      <Text className="text-xs text-muted">{member.role}</Text>
                    )}
                  </Pressable>
                ))}
              </View>

              {/* 邀请按钮 */}
              <Pressable onPress={() => router.push("/members" as any)} className="bg-surface rounded-2xl py-3 min-h-[48px] items-center justify-center active:opacity-80 flex-row gap-2">
                <MaterialIcons name="person-add" size={18} color={colors.primary} />
                <Text className="text-sm font-semibold text-primary">
                  {t("invite")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
