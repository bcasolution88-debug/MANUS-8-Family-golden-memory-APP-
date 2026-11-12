import { ScrollView, Text, View, Pressable, Image, TextInput, FlatList, ActivityIndicator } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { useBackHandler } from "@/hooks/use-back-handler";
import { ScreenContainer } from "@/components/screen-container";
import { completeUploadManager, type UploadSource } from "@/lib/complete-upload-manager";
import { trpc } from "@/lib/trpc";

const CATEGORIES = [
  { id: "daily", name: "日常", nameEn: "Daily", icon: "image" },
  { id: "gathering", name: "聚会", nameEn: "Gathering", icon: "people" },
  { id: "travel", name: "旅游", nameEn: "Travel", icon: "flight-takeoff" },
  { id: "memorial", name: "纪念", nameEn: "Memorial", icon: "favorite" },
  { id: "other", name: "其他", nameEn: "Other", icon: "more" },
] as const;

type Category = (typeof CATEGORIES)[number]["id"];

type PickedMedia = UploadSource & {
  id: string;
  type: "image" | "video";
  /** Local preview URI. */
  uri: string;
  progress: number;
  status: "pending" | "uploading" | "processing" | "completed" | "failed";
};

export default function UploadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ albumId?: string }>();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const [selectedCategory, setSelectedCategory] = useState<Category>("daily");
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(
    params.albumId ? Number(params.albumId) : null,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<PickedMedia[]>([]);
  const [uploading, setUploading] = useState(false);

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

  const createAlbum = trpc.album.create.useMutation({
    onSuccess: async (album) => {
      await utils.album.list.invalidate();
      setSelectedAlbumId(album.id);
      toast.success(l("相册已创建", "Album created"));
    },
    onError: (e) => toast.error(e.message),
  });

  // Block Android back while uploads are in flight.
  useBackHandler(uploading, () => {
    toast.warning(t("upload.uploading"));
    return true;
  });

  /* ----------------------------- picker ----------------------------- */

  const handleSelectMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.warning(l("需要相册权限才能选择照片", "Photo library permission is required"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 0.9,
      exif: false,
    });
    if (result.canceled) return;
    const picked: PickedMedia[] = result.assets.map((a, i) => ({
      id: a.assetId ?? `${Date.now()}_${i}`,
      type: a.type === "video" ? "video" : "image",
      uri: a.uri,
      fileName: a.fileName ?? `${a.type === "video" ? "video" : "photo"}_${Date.now()}_${i}.${a.type === "video" ? "mp4" : "jpg"}`,
      mimeType: a.mimeType ?? undefined,
      fileSize: a.fileSize ?? undefined,
      duration: a.duration ? a.duration / 1000 : undefined,
      progress: 0,
      status: "pending",
    }));
    setSelectedMedia((prev) => {
      const seen = new Set(prev.map((m) => m.uri));
      return [...prev, ...picked.filter((m) => !seen.has(m.uri))];
    });
  };

  /* ----------------------------- upload ----------------------------- */

  const overallProgress = useMemo(() => {
    if (selectedMedia.length === 0) return 0;
    return Math.round(selectedMedia.reduce((s, m) => s + m.progress, 0) / selectedMedia.length);
  }, [selectedMedia]);

  const patchMedia = (id: string, patch: Partial<PickedMedia>) =>
    setSelectedMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const handleUpload = async () => {
    if (!title || selectedMedia.length === 0) {
      toast.warning(t("upload.pleaseEnterTitleAnd"));
      return;
    }
    if (!familyId || !selectedAlbumId) {
      toast.warning(l("请先选择相册", "Please select an album first"));
      return;
    }
    setUploading(true);
    let ok = 0;
    let failed = 0;
    const pending = selectedMedia.filter((m) => m.status !== "completed");
    await Promise.all(
      pending.map(async (item) => {
        patchMedia(item.id, { status: "uploading", progress: 0 });
        try {
          await completeUploadManager.upload(
            { uri: item.uri, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize, duration: item.duration },
            { albumId: selectedAlbumId, familyId, title: pending.length === 1 ? title : `${title} ${ok + failed + 1}`, description: description || undefined },
            (p) => patchMedia(item.id, { progress: p.progress, status: p.status === "completed" ? "completed" : p.status === "processing" ? "processing" : "uploading" }),
          );
          patchMedia(item.id, { status: "completed", progress: 100 });
          ok += 1;
        } catch (error) {
          patchMedia(item.id, { status: "failed" });
          failed += 1;
          console.error("[upload] failed", item.fileName, error);
        }
      }),
    );
    setUploading(false);
    await Promise.all([utils.album.list.invalidate(), utils.media.getMediaList.invalidate(), utils.album.stats.invalidate()]);
    if (failed === 0) {
      toast.success(l(`已上传 ${ok} 个文件`, `${ok} file(s) uploaded`));
      router.replace({ pathname: "/album", params: { albumId: String(selectedAlbumId) } } as any);
    } else {
      toast.error(l(`${failed} 个文件上传失败，可重试`, `${failed} file(s) failed, tap upload to retry`));
    }
  };

  /* ----------------------------- render ----------------------------- */

  const renderMediaItem = ({ item }: { item: PickedMedia }) => (
    <View className="relative">
      <Image source={{ uri: item.uri }} className="w-20 h-20 rounded-lg" />
      {item.type === "video" && item.status === "pending" && (
        <View className="absolute inset-0 items-center justify-center rounded-lg bg-black/30">
          <MaterialIcons name="play-circle" size={32} color="white" />
        </View>
      )}
      {item.status !== "pending" && (
        <View className="absolute inset-0 items-center justify-center rounded-lg bg-black/40">
          {item.status === "completed" ? (
            <MaterialIcons name="check-circle" size={28} color={colors.success} />
          ) : item.status === "failed" ? (
            <MaterialIcons name="error" size={28} color={colors.error} />
          ) : (
            <Text className="text-white font-bold text-sm">{item.progress}%</Text>
          )}
        </View>
      )}
      {!uploading && item.status !== "completed" && (
        <Pressable
          onPress={() => setSelectedMedia((prev) => prev.filter((m) => m.id !== item.id))}
          hitSlop={8}
          accessibilityLabel={t("deletePhoto")}
          className="absolute -top-2 -right-2 bg-error rounded-full p-1"
        >
          <MaterialIcons name="close" size={16} color="white" />
        </Pressable>
      )}
    </View>
  );

  const canUpload = !uploading && selectedMedia.length > 0 && !!title && !!selectedAlbumId;

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} disabled={uploading} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={uploading ? colors.muted : colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{t("upload.uploadPhotosVideos")}</Text>
            <View className="w-10" />
          </View>

          <View className="flex-1 px-6 py-4 gap-6">
            {/* 媒体选择 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">{t("upload.selectMedia")}</Text>
              {selectedMedia.length > 0 ? (
                <View className="gap-3">
                  <FlatList
                    data={selectedMedia}
                    renderItem={renderMediaItem}
                    keyExtractor={(item) => item.id}
                    numColumns={4}
                    scrollEnabled={false}
                    columnWrapperStyle={{ gap: 12 }}
                    contentContainerStyle={{ gap: 12 }}
                  />
                  {!uploading && (
                    <Pressable
                      onPress={handleSelectMedia}
                      className="flex-row items-center justify-center gap-2 bg-surface rounded-2xl py-3 min-h-[48px] border border-dashed border-primary active:opacity-80"
                    >
                      <MaterialIcons name="add" size={24} color={colors.primary} />
                      <Text className="text-sm font-semibold text-primary">{t("upload.addMore")}</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                <Pressable
                  onPress={handleSelectMedia}
                  className="bg-surface rounded-2xl py-12 items-center justify-center border border-dashed border-border active:opacity-80 gap-2"
                >
                  <MaterialIcons name="add-photo-alternate" size={48} color={colors.muted} />
                  <Text className="text-sm font-semibold text-foreground">{t("upload.clickToSelectPhotos")}</Text>
                  <Text className="text-xs text-muted">{t("upload.supportsJpgPngMp4")}</Text>
                </Pressable>
              )}
            </View>

            {/* 目标相册 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">{t("common.selectAlbum")}</Text>
              {!isAuthenticated ? (
                <Text className="text-sm text-muted">{t("messages.signInToSee")}</Text>
              ) : albums.isLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <FlatList
                  data={albums.data ?? []}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(a) => String(a.id)}
                  contentContainerStyle={{ gap: 8 }}
                  ListFooterComponent={
                    <Pressable
                      disabled={createAlbum.isPending || !familyId || !title}
                      onPress={() =>
                        familyId &&
                        createAlbum.mutate({ familyId, name: title, category: selectedCategory, description: description || undefined })
                      }
                      className="px-4 py-3 min-h-[48px] justify-center rounded-2xl border border-dashed border-primary"
                      style={!title ? { opacity: 0.5 } : undefined}
                    >
                      <Text className="font-semibold text-primary">
                        {createAlbum.isPending ? "…" : l("+ 用标题新建相册", "+ New album from title")}
                      </Text>
                    </Pressable>
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => setSelectedAlbumId(item.id)}
                      disabled={uploading}
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

            {/* 分类（新建相册时使用） */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">{t("upload.category")}</Text>
              <FlatList
                data={CATEGORIES}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setSelectedCategory(item.id)}
                    className={`flex-1 rounded-2xl py-3 min-h-[48px] items-center justify-center gap-1 ${
                      selectedCategory === item.id ? "bg-primary" : "bg-surface"
                    }`}
                  >
                    <MaterialIcons name={item.icon as any} size={20} color={selectedCategory === item.id ? colors.onPrimary : colors.foreground} />
                    <Text className={`text-xs font-semibold ${selectedCategory === item.id ? "text-onPrimary" : "text-foreground"}`}>
                      {l(item.name, item.nameEn)}
                    </Text>
                  </Pressable>
                )}
                keyExtractor={(item) => item.id}
                numColumns={5}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 8 }}
              />
            </View>

            {/* 标题和描述 */}
            <View className="gap-3">
              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">{t("title")}</Text>
                <TextInput
                  placeholder={t("common.enterTitle")}
                  value={title}
                  onChangeText={setTitle}
                  editable={!uploading}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground"
                  maxLength={50}
                />
                <Text className="text-xs text-muted text-right">{title.length}/50</Text>
              </View>
              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">{t("description")}</Text>
                <TextInput
                  placeholder={t("common.enterDescriptionOptional")}
                  value={description}
                  onChangeText={setDescription}
                  editable={!uploading}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground h-24"
                  multiline
                  maxLength={200}
                />
                <Text className="text-xs text-muted text-right">{description.length}/200</Text>
              </View>
            </View>

            {/* 上传进度 */}
            {uploading && (
              <View className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-foreground">{t("upload.uploading")}</Text>
                  <Text className="text-sm font-semibold text-primary">{overallProgress}%</Text>
                </View>
                <View className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.surface }}>
                  <View className="h-full bg-primary" style={{ width: `${overallProgress}%` }} />
                </View>
              </View>
            )}

            {/* 上传按钮 */}
            <Pressable
              onPress={handleUpload}
              disabled={!canUpload}
              className={`rounded-full py-4 min-h-[56px] items-center justify-center active:opacity-80 ${canUpload ? "bg-primary" : "bg-muted/50"}`}
            >
              <Text className={`font-bold text-lg ${canUpload ? "text-onPrimary" : "text-white"}`}>
                {uploading ? t("uploading") : t("upload.confirmUpload")}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
