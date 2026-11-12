import { ScrollView, Text, View, Pressable, FlatList, TextInput, ActivityIndicator, RefreshControl, Modal, useWindowDimensions } from "react-native";
import { useMemo, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useFamilyId } from "@/hooks/use-family-id";
import { useAuth } from "@/hooks/use-auth";
import { useBackHandler } from "@/hooks/use-back-handler";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { SignedImage } from "@/components/signed-image";
import { UserAvatar } from "@/components/user-avatar";
import { trpc } from "@/lib/trpc";

const CATEGORIES = [
  { id: "all", name: "全部", nameEn: "All" },
  { id: "daily", name: "日常", nameEn: "Daily" },
  { id: "gathering", name: "聚会", nameEn: "Gathering" },
  { id: "travel", name: "旅游", nameEn: "Travel" },
  { id: "memorial", name: "纪念", nameEn: "Memorial" },
] as const;
type CategoryFilter = (typeof CATEGORIES)[number]["id"];

const SORT_OPTIONS = [
  { id: "newest", name: "最新", nameEn: "Newest" },
  { id: "oldest", name: "最旧", nameEn: "Oldest" },
  { id: "name", name: "名称", nameEn: "Name" },
] as const;
type Sort = (typeof SORT_OPTIONS)[number]["id"];

const categoryLabel = (id: string, l: <T,>(zh: T, en: T) => T) => {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? l(c.name, c.nameEn) : id;
};

/**
 * Album screen (P4 — real data).
 *   /album                 → album grid for the user's family (album.list)
 *   /album?albumId=123     → media grid for one album (media.getMediaList + SignedImage)
 * The same route serves both so deep links from notifications work.
 */
export default function AlbumScreen() {
  const params = useLocalSearchParams<{ albumId?: string }>();
  const albumId = params.albumId ? Number(params.albumId) : null;
  return albumId && Number.isFinite(albumId) ? <AlbumDetail albumId={albumId} /> : <AlbumList />;
}

/* ====================================================================== */
/* List                                                                   */
/* ====================================================================== */

function AlbumList() {
  const router = useRouter();
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { familyId, isAuthenticated, isLoading: familyLoading } = useFamilyId();

  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  useBackHandler(selected.length > 0 || showSortMenu, () => {
    setSelected([]);
    setShowSortMenu(false);
    return true;
  });

  const albums = trpc.album.list.useQuery(
    {
      familyId: familyId ?? 0,
      category: category === "all" ? undefined : category,
      search: searchText.trim() || undefined,
      sort,
      take: 100,
    },
    { enabled: isAuthenticated && !!familyId, placeholderData: (prev) => prev },
  );

  const deleteAlbum = trpc.album.delete.useMutation({
    onSuccess: () => utils.album.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const handleDeleteSelected = async () => {
    const ids = [...selected];
    setSelected([]);
    const results = await Promise.allSettled(ids.map((id) => deleteAlbum.mutateAsync({ id })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok) toast.success(l(`已删除 ${ok} 个相册`, `${ok} album(s) deleted`));
  };

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const data = albums.data ?? [];
  const locale = language === "zh" ? "zh-CN" : "en-US";

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={albums.isRefetching} onRefresh={() => albums.refetch()} tintColor={colors.primary} />
        }
      >
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Text className="text-lg font-bold text-foreground">{t("common.albums")}</Text>
            <Pressable
              onPress={() => router.push("/upload" as any)}
              accessibilityLabel={t("upload.uploadPhotosVideos")}
              className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
            >
              <MaterialIcons name="add-photo-alternate" size={24} color={colors.primary} />
            </Pressable>
          </View>

          <View className="flex-1 px-6 py-4 gap-4">
            {/* 搜索 */}
            <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2 min-h-[48px]">
              <MaterialIcons name="search" size={20} color={colors.muted} />
              <TextInput
                placeholder={t("album.searchAlbums")}
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

            {/* 分类 */}
            <FlatList
              data={CATEGORIES}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setCategory(item.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: category === item.id }}
                  className={`px-4 py-2 min-h-[44px] justify-center rounded-full ${category === item.id ? "bg-primary" : "bg-surface"}`}
                >
                  <Text className={`text-sm font-semibold ${category === item.id ? "text-onPrimary" : "text-foreground"}`}>
                    {l(item.name, item.nameEn)}
                  </Text>
                </Pressable>
              )}
            />

            {/* 排序 */}
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-foreground">
                {data.length} {t("album.albums")}
              </Text>
              <Pressable
                onPress={() => setShowSortMenu((v) => !v)}
                className="flex-row items-center gap-1 px-3 py-2 min-h-[44px] rounded-full bg-surface active:opacity-80"
              >
                <MaterialIcons name="sort" size={18} color={colors.foreground} />
                <Text className="text-sm font-semibold text-foreground">
                  {(() => { const o = SORT_OPTIONS.find((s) => s.id === sort); return o ? l(o.name, o.nameEn) : ""; })()}
                </Text>
              </Pressable>
            </View>
            {showSortMenu && (
              <View className="bg-surface rounded-2xl p-2 gap-1">
                {SORT_OPTIONS.map((o) => (
                  <Pressable
                    key={o.id}
                    onPress={() => { setSort(o.id); setShowSortMenu(false); }}
                    className={`px-4 py-3 min-h-[44px] rounded-lg ${sort === o.id ? "bg-primary/20" : ""}`}
                  >
                    <Text className={`text-sm font-semibold ${sort === o.id ? "text-primary" : "text-foreground"}`}>{l(o.name, o.nameEn)}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* 内容 */}
            {!isAuthenticated ? (
              <Empty icon="lock-outline" text={t("messages.signInToSee")} />
            ) : familyLoading || albums.isLoading ? (
              <ActivityIndicator color={colors.primary} className="py-12" />
            ) : albums.isError ? (
              <Empty icon="cloud-off" text={t("messages.loadFailed")} />
            ) : data.length === 0 ? (
              <Empty icon="image-not-supported" text={t("album.noAlbumsFound")} />
            ) : (
              <View className="flex-row flex-wrap gap-3">
                {data.map((album) => {
                  const isSel = selected.includes(album.id);
                  return (
                    <Pressable
                      key={album.id}
                      onPress={() =>
                        selected.length > 0
                          ? toggle(album.id)
                          : router.push({ pathname: "/album", params: { albumId: String(album.id) } } as any)
                      }
                      onLongPress={() => toggle(album.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSel }}
                      className="flex-1 min-w-[48%] max-w-[48%] active:opacity-80"
                    >
                      <View className="relative">
                        <AlbumCover albumId={album.id} />
                        {isSel && (
                          <View className="absolute inset-0 bg-black/40 rounded-2xl items-center justify-center">
                            <MaterialIcons name="check-circle" size={48} color="white" />
                          </View>
                        )}
                        {album.isPrivate && (
                          <View className="absolute top-2 left-2 bg-black/60 rounded-full p-1">
                            <MaterialIcons name="lock" size={14} color="white" />
                          </View>
                        )}
                        <View className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-1">
                          <Text className="text-xs text-white font-semibold">
                            {album.mediaCount} {t("album.text902acc")}
                          </Text>
                        </View>
                      </View>
                      <View className="mt-2 gap-1">
                        <Text className="text-sm font-bold text-foreground" numberOfLines={1}>{album.name}</Text>
                        <View className="flex-row items-center justify-between">
                          <Text className="text-xs text-muted">{categoryLabel(album.category ?? "other", l)}</Text>
                          <Text className="text-xs text-muted">{new Date(album.createdAt).toLocaleDateString(locale)}</Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* 批量操作 */}
            {selected.length > 0 && (
              <View className="flex-row gap-3 bg-surface rounded-2xl p-4">
                <Pressable
                  onPress={handleDeleteSelected}
                  disabled={deleteAlbum.isPending}
                  className="flex-1 py-2 min-h-[48px] items-center justify-center rounded-lg active:opacity-80"
                  style={{ backgroundColor: colors.error }}
                >
                  <Text className="text-white font-semibold">{t("deletePhoto")} ({selected.length})</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push("/share" as any)}
                  className="flex-1 py-2 min-h-[48px] items-center justify-center rounded-lg bg-primary active:opacity-80"
                >
                  <Text className="text-onPrimary font-semibold">{t("common.share")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setSelected([])}
                  className="flex-1 py-2 min-h-[48px] items-center justify-center rounded-lg bg-surface border border-border active:opacity-80"
                >
                  <Text className="text-foreground font-semibold">{t("cancel")}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

/** Cover = newest media item of the album, via signed URL. */
function AlbumCover({ albumId }: { albumId: number }) {
  const colors = useColors();
  const first = trpc.media.getMediaList.useQuery({ albumId, take: 1 }, { staleTime: 60_000 });
  const cover = first.data?.[0];
  if (!cover) {
    return (
      <View className="w-full h-40 rounded-2xl bg-surface items-center justify-center">
        <MaterialIcons name="photo-library" size={36} color={colors.muted} />
      </View>
    );
  }
  return <SignedImage mediaId={cover.id} className="w-full h-40 rounded-2xl" />;
}

/* ====================================================================== */
/* Detail                                                                 */
/* ====================================================================== */

function AlbumDetail({ albumId }: { albumId: number }) {
  const router = useRouter();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  // P9: "按人筛选" — tagged people from ai.peopleIndex; byPerson narrows the grid
  const [personId, setPersonId] = useState<number | null>(null);

  useBackHandler(selected.length > 0 || showMoveSheet, () => {
    if (showMoveSheet) setShowMoveSheet(false);
    else setSelected([]);
    return true;
  });

  const album = trpc.album.get.useQuery({ id: albumId });
  const stats = trpc.album.stats.useQuery({ id: albumId });
  const member = trpc.family.getMembers.useQuery(
    { familyId: album.data?.familyId ?? 0 },
    { enabled: !!album.data?.familyId, staleTime: 60_000 },
  );
  const myRole = member.data?.find((m) => m.userId === user?.id)?.role;
  const isAdmin = myRole === "owner" || myRole === "admin";

  // P5: keyset-paginated grid.
  const feed = trpc.media.listMedia.useInfiniteQuery(
    { albumId, type: filter === "all" ? undefined : filter, take: 30 },
    { getNextPageParam: (last) => last.nextCursor, placeholderData: (prev) => prev },
  );
  const allItems = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const people = trpc.ai.peopleIndex.useQuery({ familyId: album.data?.familyId ?? 0 }, { enabled: !!album.data?.familyId, staleTime: 60_000 });
  const byPerson = trpc.ai.byPerson.useQuery(
    { familyId: album.data?.familyId ?? 0, userId: personId ?? 0, take: 100 },
    { enabled: !!album.data?.familyId && !!personId, staleTime: 60_000 },
  );
  const items = useMemo(() => {
    if (!personId) return allItems;
    const inAlbum = (byPerson.data ?? []).filter((m) => m.albumId === albumId);
    return filter === "all" ? inAlbum : inAlbum.filter((m) => (filter === "image" ? m.type === "photo" : m.type === "video"));
  }, [allItems, byPerson.data, personId, albumId, filter]);

  // Albums in the same family (move targets).
  const siblings = trpc.album.list.useQuery(
    { familyId: album.data?.familyId ?? 0, take: 100 },
    { enabled: showMoveSheet && !!album.data?.familyId },
  );

  const invalidateAll = () =>
    Promise.all([
      utils.media.listMedia.invalidate({ albumId }),
      utils.media.getMediaList.invalidate(),
      utils.media.recent.invalidate(),
      utils.album.stats.invalidate(),
      utils.album.list.invalidate(),
    ]);

  const deleteMany = trpc.media.deleteMany.useMutation({
    onSuccess: async (r) => {
      await invalidateAll();
      setSelected([]);
      toast.success(l(`已删除 ${r.deleted} 项`, `${r.deleted} item(s) deleted`));
      if ("skipped" in r && r.skipped) toast.warning(l(`${r.skipped} 项无权限，已跳过`, `${r.skipped} skipped (no permission)`));
    },
    onError: (e) => toast.error(e.message),
  });
  const moveMedia = trpc.media.moveMedia.useMutation({
    onSuccess: async (r) => {
      await invalidateAll();
      setSelected([]);
      setShowMoveSheet(false);
      toast.success(l(`已移动 ${r.moved} 项`, `${r.moved} item(s) moved`));
    },
    onError: (e) => toast.error(e.message),
  });

  const tile = useMemo(() => Math.floor((width - 48 - 8) / 3), [width]);
  const toggle = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selecting = selected.length > 0;
  /** Can the current user act on every selected item? (uploader or admin) */
  const canActOnSelection = isAdmin || selected.every((id) => items.find((m) => m.id === id)?.uploadedBy === user?.id);

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400 && feed.hasNextPage && !feed.isFetchingNextPage) {
            void feed.fetchNextPage();
          }
        }}
        scrollEventThrottle={200}
        refreshControl={<RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => feed.refetch()} tintColor={colors.primary} />}
      >
        <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
          {selecting ? (
            <Pressable onPress={() => setSelected([])} accessibilityLabel={t("cancel")} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="close" size={24} color={colors.foreground} />
            </Pressable>
          ) : (
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/album" as any))} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
          )}
          <Text className="text-lg font-bold text-foreground flex-1 text-center" numberOfLines={1}>
            {selecting ? l(`已选 ${selected.length} 项`, `${selected.length} selected`) : album.data?.name ?? "…"}
          </Text>
          {selecting ? (
            <Pressable
              onPress={() => setSelected(items.map((m) => m.id))}
              accessibilityLabel={l("全选", "Select all")}
              className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
            >
              <MaterialIcons name="select-all" size={24} color={colors.primary} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push({ pathname: "/upload", params: { albumId: String(albumId) } } as any)}
              accessibilityLabel={t("upload.uploadPhotosVideos")}
              className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
            >
              <MaterialIcons name="add-photo-alternate" size={24} color={colors.primary} />
            </Pressable>
          )}
        </View>

        <View className="px-6 py-4 gap-4">
          {album.data?.description ? <Text className="text-sm text-muted">{album.data.description}</Text> : null}

          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">
              {stats.data ? `${stats.data.photoCount} ${t("photos")} · ${stats.data.videoCount} ${t("videos")}` : ""}
            </Text>
            <View className="flex-row gap-2">
              {(["all", "image", "video"] as const).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === f }}
                  className={`px-3 py-2 min-h-[40px] justify-center rounded-full ${filter === f ? "bg-primary" : "bg-surface"}`}
                >
                  <Text className={`text-xs font-semibold ${filter === f ? "text-onPrimary" : "text-foreground"}`}>
                    {f === "all" ? l("全部", "All") : f === "image" ? t("photos") : t("videos")}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* P9: 按人筛选（来自 AI 识别 + 家人标记） */}
          {(people.data?.people.length ?? 0) > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              <Pressable
                onPress={() => setPersonId(null)}
                accessibilityRole="tab"
                accessibilityState={{ selected: personId === null }}
                className={`flex-row items-center gap-1 px-3 min-h-[40px] rounded-full ${personId === null ? "bg-primary" : "bg-surface"}`}
              >
                <MaterialIcons name="groups" size={16} color={personId === null ? colors.onPrimary : colors.muted} />
                <Text className={`text-xs font-semibold ${personId === null ? "text-onPrimary" : "text-foreground"}`}>{l("所有人", "Everyone")}</Text>
              </Pressable>
              {people.data!.people.map((p) => {
                const active = personId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setPersonId(active ? null : p.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={l(`只看 ${p.name ?? ""} 的照片`, `Only photos with ${p.name ?? ""}`)}
                    className={`flex-row items-center gap-2 pl-1 pr-3 min-h-[40px] rounded-full ${active ? "bg-primary" : "bg-surface"}`}
                  >
                    <UserAvatar avatar={p.avatar} name={p.name} size={28} />
                    <Text className={`text-xs font-semibold ${active ? "text-onPrimary" : "text-foreground"}`} numberOfLines={1}>{p.name ?? "?"}</Text>
                    <Text className={`text-[10px] ${active ? "text-onPrimary/80" : "text-muted"}`}>{p.count}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {album.isError ? (
            <Empty icon="lock-outline" text={l("无权访问该相册", "You cannot access this album")} />
          ) : feed.isLoading ? (
            <ActivityIndicator color={colors.primary} className="py-12" />
          ) : personId && byPerson.isLoading ? (
            <ActivityIndicator color={colors.primary} className="py-12" />
          ) : items.length === 0 ? (
            personId ? (
              <Empty icon="person-search" text={l("这个相册里还没有标记到 TA 的照片", "No photos tagged with this person in this album yet")} />
            ) : (
              <Empty icon="add-photo-alternate" text={l("相册还是空的，上传第一张照片吧", "Album is empty — upload the first photo")} />
            )
          ) : (
            <View className="flex-row flex-wrap" style={{ gap: 4 }}>
              {items.map((m) => {
                const isSel = selected.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() =>
                      selecting ? toggle(m.id) : router.push(m.type === "video" ? (`/video/${m.id}` as any) : (`/photo/${m.id}` as any))
                    }
                    onLongPress={() => toggle(m.id)}
                    delayLongPress={250}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={m.title ?? ""}
                    accessibilityState={{ selected: isSel }}
                    className="active:opacity-80"
                    style={{ width: tile, height: tile }}
                  >
                    <SignedImage mediaId={m.id} style={{ width: tile, height: tile, borderRadius: 8 }} />
                    {m.type === "video" && !isSel && (
                      <View className="absolute inset-0 items-center justify-center">
                        <MaterialIcons name="play-circle" size={28} color="white" />
                      </View>
                    )}
                    {isSel && (
                      <View className="absolute inset-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${colors.primary}66`, borderWidth: 3, borderColor: colors.primary }}>
                        <MaterialIcons name="check-circle" size={32} color="white" />
                      </View>
                    )}
                    {m.likeCount > 0 && !isSel && (
                      <View className="absolute bottom-1 right-1 flex-row items-center gap-0.5 bg-black/50 rounded-full px-1.5 py-0.5">
                        <MaterialIcons name="favorite" size={10} color="white" />
                        <Text className="text-[10px] text-white font-semibold">{m.likeCount}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {feed.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} className="py-4" />
          ) : feed.hasNextPage ? (
            <Pressable onPress={() => void feed.fetchNextPage()} className="items-center py-3 min-h-[48px]">
              <Text className="text-sm font-semibold text-primary">{t("messages.loadMore")}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {/* 多选操作栏 */}
      {selecting && (
        <View className="flex-row gap-3 bg-surface px-6 py-3 border-t border-border">
          <Pressable
            onPress={() => setShowMoveSheet(true)}
            disabled={!canActOnSelection || moveMedia.isPending}
            className="flex-1 py-3 min-h-[48px] items-center justify-center rounded-full bg-primary active:opacity-80"
            style={!canActOnSelection ? { opacity: 0.5 } : undefined}
          >
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="drive-file-move" size={18} color={colors.onPrimary} />
              <Text className="text-onPrimary font-semibold">{l("移动到相册", "Move to album")}</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => deleteMany.mutate({ ids: selected })}
            disabled={!canActOnSelection || deleteMany.isPending}
            className="flex-1 py-3 min-h-[48px] items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: colors.error, opacity: canActOnSelection ? 1 : 0.5 }}
          >
            {deleteMany.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="delete" size={18} color="#fff" />
                <Text className="text-white font-semibold">{t("deletePhoto")}</Text>
              </View>
            )}
          </Pressable>
        </View>
      )}

      {/* 移动到相册 */}
      <Modal visible={showMoveSheet} transparent animationType="fade" onRequestClose={() => setShowMoveSheet(false)}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-background rounded-t-3xl p-6 gap-4 max-h-[70%]">
            <Text className="text-xl font-bold text-foreground">{l("移动到相册", "Move to album")}</Text>
            {siblings.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <ScrollView className="max-h-80">
                {(siblings.data ?? [])
                  .filter((a) => a.id !== albumId)
                  .map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => moveMedia.mutate({ ids: selected, targetAlbumId: a.id })}
                      disabled={moveMedia.isPending}
                      className="flex-row items-center justify-between py-3 min-h-[56px] border-b border-border active:opacity-80"
                    >
                      <View className="flex-row items-center gap-3">
                        <MaterialIcons name={a.isPrivate ? "lock" : "photo-album"} size={20} color={colors.muted} />
                        <Text className="text-base text-foreground">{a.name}</Text>
                      </View>
                      <Text className="text-xs text-muted">{a.mediaCount}</Text>
                    </Pressable>
                  ))}
                {(siblings.data ?? []).filter((a) => a.id !== albumId).length === 0 && (
                  <Text className="text-sm text-muted text-center py-6">{l("没有其他相册", "No other albums")}</Text>
                )}
              </ScrollView>
            )}
            <Pressable onPress={() => setShowMoveSheet(false)} className="bg-surface rounded-full py-3 min-h-[48px] items-center justify-center">
              <Text className="font-semibold text-foreground">{t("cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function Empty({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View className="flex-1 items-center justify-center gap-2 py-16">
      <MaterialIcons name={icon} size={48} color={colors.muted} />
      <Text className="text-base font-semibold text-foreground text-center">{text}</Text>
    </View>
  );
}
