import { Text, View, Pressable, FlatList, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { UserAvatar } from "@/components/user-avatar";
import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useFamilyId } from "@/hooks/use-family-id";
import { ScreenContainer } from "@/components/screen-container";
import { SignedImage } from "@/components/signed-image";
import { FamilySwitcher } from "@/components/family-switcher";
import { trpc } from "@/lib/trpc";

type Range = "today" | "week" | "month" | "all";
type EventType = "upload" | "comment" | "like" | "story" | "anniversary";

const TIME_FILTERS: { id: Range; name: string; nameEn: string }[] = [
  { id: "today", name: "今天", nameEn: "Today" },
  { id: "week", name: "本周", nameEn: "This Week" },
  { id: "month", name: "本月", nameEn: "This Month" },
  { id: "all", name: "全部", nameEn: "All" },
];

const EVENT_TYPES: { id: EventType | "all"; name: string; nameEn: string }[] = [
  { id: "all", name: "全部", nameEn: "All" },
  { id: "upload", name: "上传", nameEn: "Upload" },
  { id: "comment", name: "评论", nameEn: "Comment" },
  { id: "like", name: "点赞", nameEn: "Like" },
  { id: "story", name: "故事", nameEn: "Story" },
  { id: "anniversary", name: "纪念日", nameEn: "Anniversary" },
];

type Event = {
  id: string;
  type: EventType;
  at: Date;
  actor: { id: number; name: string | null; avatar: string | null } | null;
  mediaId: number | null;
  albumId: number | null;
  albumName: string | null;
  preview: string | null;
  count: number;
};

const ICON: Record<EventType, keyof typeof MaterialIcons.glyphMap> = {
  upload: "cloud-upload",
  comment: "chat-bubble",
  like: "favorite",
  story: "auto-stories",
  anniversary: "cake",
};

/**
 * Timeline tab (P6 — real data). timeline.list aggregates uploads (grouped
 * per 10-min burst), comments, likes, stories and anniversaries for the active
 * family; range / type filters and search are applied server-side. Items are
 * grouped by day; each deep-links to the photo / album / stories / anniversary.
 */
export default function TimelineScreen() {
  const router = useRouter();
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const { familyId, isAuthenticated } = useFamilyId();

  const [searchText, setSearchText] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [type, setType] = useState<EventType | "all">("all");

  const feed = trpc.timeline.list.useQuery(
    { familyId: familyId ?? 0, range, type: type === "all" ? undefined : type, search: searchText.trim() || undefined, take: 100 },
    { enabled: isAuthenticated && !!familyId, placeholderData: (prev) => prev, refetchInterval: 60_000 },
  );

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const todayKey = new Date().toDateString();
  const yesterdayKey = new Date(Date.now() - 86_400_000).toDateString();
  const dayLabel = (d: Date) => {
    const k = d.toDateString();
    if (k === todayKey) return l("今天", "Today");
    if (k === yesterdayKey) return l("昨天", "Yesterday");
    return d.toLocaleDateString(locale, { month: "long", day: "numeric", weekday: "short" });
  };
  const timeLabel = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  /** Flatten into [header, event, event, header, …] for FlatList. */
  const rows = useMemo(() => {
    const out: ({ kind: "header"; key: string; label: string } | { kind: "event"; key: string; event: Event })[] = [];
    let lastDay = "";
    for (const e of (feed.data ?? []) as Event[]) {
      const at = new Date(e.at);
      const day = at.toDateString();
      if (day !== lastDay) {
        out.push({ kind: "header", key: `h:${day}`, label: dayLabel(at) });
        lastDay = day;
      }
      out.push({ kind: "event", key: e.id, event: { ...e, at } });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.data, language]);

  const colorFor = (ty: EventType) =>
    ty === "upload" ? colors.success : ty === "comment" ? "#3b82f6" : ty === "like" ? colors.error : ty === "story" ? "#a855f7" : colors.primary;

  const describe = (e: Event) => {
    const who = e.actor?.name ?? t("notif.someone");
    switch (e.type) {
      case "upload":
        return l(`${who} 上传了 ${e.count} ${e.count > 1 ? "项" : "项"}到「${e.albumName ?? ""}」`, `${who} uploaded ${e.count} item${e.count > 1 ? "s" : ""} to “${e.albumName ?? ""}”`);
      case "comment":
        return l(`${who} 评论了「${e.albumName ?? ""}」中的照片`, `${who} commented on a photo in “${e.albumName ?? ""}”`);
      case "like":
        return l(`${who} 赞了「${e.albumName ?? ""}」中的照片`, `${who} liked a photo in “${e.albumName ?? ""}”`);
      case "story":
        return l(`${who} 新增了故事章节`, `${who} added a story chapter`);
      case "anniversary":
        return l(`${who} 添加了纪念日`, `${who} added an anniversary`);
    }
  };

  const open = (e: Event) => {
    if (e.mediaId) return router.push(`/photo/${e.mediaId}` as any);
    if (e.albumId) return router.push({ pathname: "/album", params: { albumId: String(e.albumId) } } as any);
    if (e.type === "story") return router.push("/stories" as any);
    if (e.type === "anniversary") return router.push("/anniversary" as any);
  };

  const Header = (
    <View className="gap-4 pb-2">
      <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2 min-h-[48px]">
        <MaterialIcons name="search" size={20} color={colors.muted} />
        <TextInput
          placeholder={t("timeline.searchEvents")}
          value={searchText}
          onChangeText={setSearchText}
          placeholderTextColor={colors.muted}
          className="flex-1 text-foreground"
        />
        {searchText ? (
          <Pressable onPress={() => setSearchText("")} hitSlop={8}>
            <MaterialIcons name="close" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={TIME_FILTERS}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: 8 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setRange(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: range === item.id }}
            className={`px-4 py-2 min-h-[44px] justify-center rounded-full ${range === item.id ? "bg-primary" : "bg-surface"}`}
          >
            <Text className={`text-sm font-semibold ${range === item.id ? "text-onPrimary" : "text-foreground"}`}>{l(item.name, item.nameEn)}</Text>
          </Pressable>
        )}
      />
      <FlatList
        data={EVENT_TYPES}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: 8 }}
        renderItem={({ item }) => {
          const on = type === item.id;
          return (
            <Pressable
              onPress={() => setType(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              className={`flex-row items-center gap-1 px-4 py-2 min-h-[44px] rounded-full ${on ? "bg-accent" : "bg-surface"}`}
              style={on ? { backgroundColor: colors.info } : undefined}
            >
              {item.id !== "all" && <MaterialIcons name={ICON[item.id]} size={14} color={on ? "white" : colorFor(item.id)} />}
              <Text className={`text-sm font-semibold ${on ? "text-white" : "text-foreground"}`}>{l(item.name, item.nameEn)}</Text>
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
          <Text className="text-sm text-muted">{t("messages.loadFailed")}</Text>
        </>
      ) : (
        <>
          <MaterialIcons name="event-note" size={48} color={colors.muted} />
          <Text className="text-lg font-semibold text-foreground">{t("timeline.noEvents")}</Text>
        </>
      )}
    </View>
  );

  return (
    <ScreenContainer className="bg-background p-0">
      <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
        <Text className="text-lg font-bold text-foreground">{t("common.timeline")}</Text>
        <FamilySwitcher variant="chip" />
      </View>

      {!isAuthenticated ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <MaterialIcons name="lock-outline" size={48} color={colors.muted} />
          <Text className="text-lg font-semibold text-foreground">{t("messages.signInToSee")}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 16, flexGrow: 1 }}
          ListHeaderComponent={Header}
          ListEmptyComponent={Empty}
          refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => feed.refetch()} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            if (item.kind === "header") {
              return (
                <Text className="text-sm font-bold text-muted mt-2 mb-2" accessibilityRole="header">
                  {item.label}
                </Text>
              );
            }
            const e = item.event;
            const isLast = index === rows.length - 1 || rows[index + 1]?.kind === "header";
            return (
              <View className="flex-row gap-3" style={{ alignItems: "stretch" }}>
                {/* 时间轴 */}
                <View className="items-center" style={{ width: 20 }}>
                  <View className="w-3 h-3 rounded-full mt-5" style={{ backgroundColor: colorFor(e.type) }} />
                  {!isLast && <View className="flex-1 w-0.5" style={{ backgroundColor: colors.border }} />}
                </View>
                <Pressable
                  onPress={() => open(e)}
                  accessibilityRole="button"
                  accessibilityLabel={describe(e)}
                  className="flex-1 bg-surface rounded-2xl p-3 mb-3 flex-row gap-3 active:opacity-80"
                >
                  <View className="flex-1 gap-1">
                    <View className="flex-row items-center justify-between gap-2">
                      <View className="flex-row items-center gap-2 flex-1">
                        {e.actor?.avatar ? (
                          <UserAvatar avatar={e.actor.avatar} name={e.actor.name} size={32} />
                        ) : (
                          <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: `${colorFor(e.type)}22` }}>
                            <MaterialIcons name={ICON[e.type]} size={16} color={colorFor(e.type)} />
                          </View>
                        )}
                        <Text className="text-sm font-semibold text-foreground flex-1" numberOfLines={1}>
                          {e.actor?.name ?? t("notif.someone")}
                        </Text>
                      </View>
                      <Text className="text-xs text-muted">{timeLabel(e.at)}</Text>
                    </View>
                    <Text className="text-xs text-muted" numberOfLines={2}>
                      {describe(e)}
                    </Text>
                    {e.preview && e.type !== "upload" && (
                      <Text className="text-sm text-foreground" numberOfLines={2}>
                        “{e.preview}”
                      </Text>
                    )}
                    {e.type === "upload" && e.preview && e.count === 1 && (
                      <Text className="text-sm text-foreground" numberOfLines={1}>{e.preview}</Text>
                    )}
                  </View>
                  {e.mediaId ? (
                    <View className="relative">
                      <SignedImage mediaId={e.mediaId} className="w-14 h-14 rounded-lg" />
                      {e.type === "upload" && e.count > 1 && (
                        <View className="absolute inset-0 rounded-lg items-center justify-center bg-black/45">
                          <Text className="text-white text-xs font-bold">+{e.count - 1}</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}
