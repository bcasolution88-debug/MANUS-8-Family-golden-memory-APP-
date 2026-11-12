import { Text, View, Pressable, FlatList, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { UserAvatar } from "@/components/user-avatar";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import type { NotificationType } from "@/drizzle/schema";

type FilterKey = "all" | "unread" | "comment" | "like";

const MESSAGE_FILTERS: { id: FilterKey; name: string; nameEn: string }[] = [
  { id: "all", name: "全部", nameEn: "All" },
  { id: "unread", name: "未读", nameEn: "Unread" },
  { id: "comment", name: "评论", nameEn: "Comments" },
  { id: "like", name: "点赞", nameEn: "Likes" },
];

type FeedItem = {
  id: number;
  type: NotificationType;
  preview: string | null;
  readAt: Date | null;
  createdAt: Date;
  mediaId: number | null;
  albumId: number | null;
  commentId: number | null;
  actor: { id: number; name: string | null; avatar: string | null } | null;
};

const TYPE_ICON: Record<NotificationType, keyof typeof MaterialIcons.glyphMap> = {
  like: "favorite",
  comment: "chat-bubble",
  reply: "reply",
  upload: "add-photo-alternate",
  invite: "person-add",
  member_joined: "group-add",
  anniversary: "cake",
  share: "share",
  system: "info",
};

/** Relative time, i18n aware. Keeps the list scannable for elders (no raw timestamps). */
function useRelativeTime() {
  const { t } = useLanguage();
  return useCallback(
    (date: Date | string) => {
      const diff = Date.now() - new Date(date).getTime();
      const minutes = Math.floor(diff / 60_000);
      if (minutes < 1) return t("time.justNow");
      if (minutes < 60) return t("time.minutesAgo", { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t("time.hoursAgo", { n: hours });
      return t("time.daysAgo", { n: Math.floor(hours / 24) });
    },
    [t],
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const relativeTime = useRelativeTime();

  const [searchText, setSearchText] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>("all");

  /* ------------------------------ data ------------------------------ */

  const listInput = useMemo(
    () => ({
      unreadOnly: selectedFilter === "unread",
      type: selectedFilter === "comment" || selectedFilter === "like" ? selectedFilter : undefined,
      take: 30,
    }),
    [selectedFilter],
  );

  const feed = trpc.notification.list.useInfiniteQuery(listInput, {
    enabled: isAuthenticated,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30_000,
  });
  const unread = trpc.notification.unreadCount.useQuery(undefined, { enabled: isAuthenticated, staleTime: 10_000 });

  const invalidate = useCallback(async () => {
    await Promise.all([utils.notification.list.invalidate(), utils.notification.unreadCount.invalidate()]);
  }, [utils]);

  const markRead = trpc.notification.markRead.useMutation({ onSuccess: invalidate });
  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: async () => {
      await invalidate();
      toast.success(t("messages.allRead"));
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.notification.delete.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  const describe = useCallback(
    (n: FeedItem): string => {
      switch (n.type) {
        case "upload":
          return t("notif.upload", { album: n.preview ?? "" });
        case "anniversary":
          return t("notif.anniversary", { preview: n.preview ?? "" });
        default:
          return t(`notif.${n.type}` as any);
      }
    },
    [t],
  );

  const items = useMemo<FeedItem[]>(() => {
    const all = (feed.data?.pages.flatMap((p) => p.items) ?? []) as FeedItem[];
    if (!searchText.trim()) return all;
    const q = searchText.toLowerCase();
    return all.filter(
      (n) =>
        (n.actor?.name ?? "").toLowerCase().includes(q) ||
        (n.preview ?? "").toLowerCase().includes(q) ||
        describe(n).toLowerCase().includes(q),
    );
  }, [feed.data, searchText, describe]);

  /* ---------------------------- helpers ----------------------------- */

  const colorFor = (type: NotificationType) =>
    type === "like"
      ? colors.error
      : type === "comment" || type === "reply"
        ? "#3b82f6"
        : type === "upload" || type === "share"
          ? colors.success
          : type === "anniversary"
            ? colors.primary
            : colors.muted;

  /** Deep-link to the thing the notification is about. */
  const openTarget = (n: FeedItem) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    if (n.mediaId) return router.push(`/photo/${n.mediaId}` as any);
    if (n.albumId) return router.push({ pathname: "/album", params: { albumId: String(n.albumId) } } as any);
    if (n.type === "invite" || n.type === "member_joined") return router.push("/members" as any);
    if (n.type === "anniversary") return router.push("/anniversary" as any);
    router.push(`/notification/${n.id}` as any);
  };

  /* ----------------------------- render ----------------------------- */

  const totalUnread = unread.data?.total ?? 0;

  const renderItem = ({ item }: { item: FeedItem }) => {
    const isUnread = !item.readAt;
    const name = item.actor?.name ?? t("notif.someone");
    return (
      <Pressable
        onPress={() => openTarget(item)}
        accessibilityRole="button"
        accessibilityLabel={`${name} ${describe(item)}`}
        className={`mb-3 rounded-2xl p-4 flex-row gap-3 active:opacity-80 ${isUnread ? "bg-primary/10" : "bg-surface"}`}
      >
        {/* 头像 / 类型图标 */}
        <View className="relative">
          {item.actor?.avatar ? (
            <UserAvatar avatar={item.actor.avatar} name={item.actor.name} size={48} />
          ) : (
            <View className="w-12 h-12 rounded-full items-center justify-center" style={{ backgroundColor: `${colorFor(item.type)}22` }}>
              <MaterialIcons name={TYPE_ICON[item.type]} size={22} color={colorFor(item.type)} />
            </View>
          )}
          {isUnread && <View className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary" />}
        </View>

        {/* 内容 */}
        <View className="flex-1 gap-1">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1">
              <Text className="font-semibold text-foreground" numberOfLines={1}>
                {name}
              </Text>
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: colorFor(item.type) }} />
            </View>
            <Text className="text-xs text-muted">{relativeTime(item.createdAt)}</Text>
          </View>
          <Text className="text-sm text-foreground" numberOfLines={2}>
            {describe(item)}
          </Text>
          {item.type !== "upload" && item.type !== "anniversary" && item.preview ? (
            <Text className="text-xs text-muted" numberOfLines={2}>
              “{item.preview}”
            </Text>
          ) : null}
        </View>

        {/* 删除 */}
        <Pressable
          onPress={() => remove.mutate({ id: item.id })}
          accessibilityLabel={t("deletePhoto")}
          hitSlop={8}
          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
        >
          <MaterialIcons name="close" size={18} color={colors.muted} />
        </Pressable>
      </Pressable>
    );
  };

  const Header = (
    <View className="gap-4 pb-2">
      {/* 搜索 */}
      <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2 min-h-[48px]">
        <MaterialIcons name="search" size={20} color={colors.muted} />
        <TextInput
          placeholder={t("messages.searchMessages")}
          value={searchText}
          onChangeText={setSearchText}
          placeholderTextColor={colors.muted}
          className="flex-1 text-foreground"
        />
        {searchText ? (
          <Pressable onPress={() => setSearchText("")} hitSlop={8} accessibilityLabel={t("cancel")}>
            <MaterialIcons name="close" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* 筛选 */}
      <FlatList
        data={MESSAGE_FILTERS}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 8 }}
        renderItem={({ item }) => {
          const active = selectedFilter === item.id;
          const badge =
            item.id === "unread" ? totalUnread : item.id === "comment" ? unread.data?.comments : item.id === "like" ? unread.data?.likes : 0;
          return (
            <Pressable
              onPress={() => setSelectedFilter(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              className={`flex-row items-center gap-1 px-4 py-2 min-h-[44px] rounded-full ${active ? "bg-primary" : "bg-surface"}`}
            >
              <Text className={`text-sm font-semibold ${active ? "text-onPrimary" : "text-foreground"}`}>
                {l(item.name, item.nameEn)}
              </Text>
              {badge ? (
                <Text className={`text-xs font-bold ${active ? "text-onPrimary" : "text-primary"}`}>{badge}</Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );

  const Empty = (
    <View className="flex-1 items-center justify-center gap-2 py-16">
      {feed.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : feed.isError ? (
        <>
          <MaterialIcons name="cloud-off" size={48} color={colors.muted} />
          <Text className="text-sm text-muted text-center">{t("messages.loadFailed")}</Text>
        </>
      ) : (
        <>
          <MaterialIcons name="mail-outline" size={48} color={colors.muted} />
          <Text className="text-lg font-semibold text-foreground">{t("messages.noMessages")}</Text>
        </>
      )}
    </View>
  );

  return (
    <ScreenContainer className="bg-background p-0">
      {/* 顶部导航 */}
      <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-bold text-foreground">{t("messages")}</Text>
          {totalUnread > 0 && (
            <View className="bg-error rounded-full px-2 py-0.5">
              <Text className="text-xs text-white font-bold">{totalUnread > 99 ? "99+" : totalUnread}</Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={() => markAllRead.mutate()}
          disabled={!isAuthenticated || totalUnread === 0 || markAllRead.isPending}
          accessibilityLabel={t("messages.markAllRead")}
          className="flex-row items-center gap-1 p-2 min-w-[48px] min-h-[48px] items-center justify-center"
          style={totalUnread === 0 ? { opacity: 0.4 } : undefined}
        >
          {markAllRead.isPending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialIcons name="done-all" size={22} color={colors.primary} />
          )}
          <Text className="text-sm font-semibold text-primary">{t("messages.markAllRead")}</Text>
        </Pressable>
      </View>

      {!isAuthenticated ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <MaterialIcons name="lock-outline" size={48} color={colors.muted} />
          <Text className="text-lg font-semibold text-foreground">{t("messages.signInToSee")}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 16, flexGrow: 1 }}
          ListHeaderComponent={Header}
          ListEmptyComponent={Empty}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <ActivityIndicator className="py-4" color={colors.primary} />
            ) : feed.hasNextPage ? (
              <Pressable onPress={() => void feed.fetchNextPage()} className="items-center py-4 min-h-[48px]">
                <Text className="text-sm font-semibold text-primary">{t("messages.loadMore")}</Text>
              </Pressable>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching && !feed.isFetchingNextPage}
              onRefresh={() => void invalidate()}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </ScreenContainer>
  );
}
