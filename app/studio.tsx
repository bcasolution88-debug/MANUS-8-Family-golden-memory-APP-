import { ScrollView, Text, View, Pressable, FlatList, TextInput, ActivityIndicator, Switch } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useBackHandler } from "@/hooks/use-back-handler";
import { useFamilyId } from "@/hooks/use-family-id";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { SignedImage } from "@/components/signed-image";
import { FamilySwitcher } from "@/components/family-switcher";
import { trpc } from "@/lib/trpc";
import * as DocumentPicker from "expo-document-picker";

/**
 * P7 — Video Studio, now backed by a real server-side renderer.
 *
 *   template → photos (album + up to 12) → copy (title / subtitle / captions,
 *   AI suggest, pacing, transition) → render (ffmpeg job, polled) → done
 *
 * The result is a real `media` row (type video) in the chosen album, so it
 * appears in the album grid, Home "回忆时光", Timeline and notifications.
 */

type Step = "template" | "photos" | "edit" | "render";
type TemplateId = "romantic" | "gathering" | "travel" | "birthday" | "memorial";
type Transition = "fade" | "slideleft" | "wipeleft" | "circleopen" | "dissolve";
type Music = "none" | "romance" | "joy" | "adventure" | "celebration" | "classic";

const MUSIC_OPTIONS: { id: Music; zh: string; en: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "none", zh: "无配乐", en: "Silent", icon: "music-off" },
  { id: "romance", zh: "浪漫", en: "Romance", icon: "favorite" },
  { id: "joy", zh: "欢快", en: "Joy", icon: "sentiment-very-satisfied" },
  { id: "adventure", zh: "远行", en: "Adventure", icon: "flight" },
  { id: "celebration", zh: "庆典", en: "Celebration", icon: "celebration" },
  { id: "classic", zh: "典雅", en: "Classic", icon: "piano" },
];

const TRANSITIONS: { id: Transition; zh: string; en: string }[] = [
  { id: "fade", zh: "淡入淡出", en: "Fade" },
  { id: "dissolve", zh: "溶解", en: "Dissolve" },
  { id: "slideleft", zh: "左滑", en: "Slide" },
  { id: "wipeleft", zh: "擦除", en: "Wipe" },
  { id: "circleopen", zh: "圆形展开", en: "Circle" },
];

const MAX_PHOTOS = 12;

export default function StudioScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ albumId?: string }>();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { familyId, isAuthenticated } = useFamilyId();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<Step>("template");
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const [albumId, setAlbumId] = useState<number | null>(params.albumId ? Number(params.albumId) : null);
  const [selected, setSelected] = useState<number[]>([]);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [captions, setCaptions] = useState<Record<number, string>>({});
  const [showCaptions, setShowCaptions] = useState(false);
  const [secondsPerSlide, setSecondsPerSlide] = useState<number | null>(null);
  const [transition, setTransition] = useState<Transition | null>(null);
  const [music, setMusic] = useState<Music | null>(null);
  // P10: user-supplied soundtrack (uploaded to users/{uid}/music/*; overrides the generated mood)
  const [customMusic, setCustomMusic] = useState<{ key: string; name: string } | null>(null);
  const [musicUploading, setMusicUploading] = useState(false);
  const presignMusic = trpc.studio.presignMusic.useMutation();
  const [jobId, setJobId] = useState<string | null>(null);

  const pickSoundtrack = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["audio/*"], copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const size = asset.size ?? 0;
      if (size > 20 * 1024 * 1024) return toast.warning(l("音频不能超过 20 MB", "Audio must be under 20 MB"));
      const ext = (asset.name.split(".").pop() ?? "").toLowerCase();
      const contentType = (asset.mimeType && asset.mimeType !== "application/octet-stream" ? asset.mimeType : ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/x-m4a" : ext === "wav" ? "audio/wav" : ext === "aac" ? "audio/aac" : ext === "ogg" ? "audio/ogg" : "audio/mpeg") as
        | "audio/mpeg" | "audio/mp4" | "audio/x-m4a" | "audio/aac" | "audio/wav" | "audio/x-wav" | "audio/ogg";
      setMusicUploading(true);
      const { musicKey, presignedUrl } = await presignMusic.mutateAsync({ fileName: asset.name, contentType, fileSize: Math.max(1, size) });
      const blob = await (await fetch(asset.uri)).blob();
      const put = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      setCustomMusic({ key: musicKey, name: asset.name });
      toast.success(l(`已选择配乐「${asset.name}」`, `Soundtrack "${asset.name}" ready`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : l("配乐上传失败", "Soundtrack upload failed"));
    } finally {
      setMusicUploading(false);
    }
  };

  // Android back walks the wizard backwards before leaving the screen.
  useBackHandler(step !== "template" && step !== "render", () => {
    setStep(step === "edit" ? "photos" : "template");
    return true;
  });

  /* ---------------- data ---------------- */
  const templates = trpc.studio.templates.useQuery(undefined, { enabled: isAuthenticated, staleTime: 5 * 60_000 });
  const template = useMemo(() => templates.data?.templates.find((x) => x.id === templateId) ?? null, [templates.data, templateId]);

  const albums = trpc.album.list.useQuery(
    { familyId: familyId ?? 0, take: 100 },
    { enabled: isAuthenticated && !!familyId && step === "photos" },
  );
  useEffect(() => {
    // Default to first album when none preselected
    if (step === "photos" && !albumId && albums.data?.[0]) setAlbumId(albums.data[0].id);
  }, [step, albumId, albums.data]);

  const photos = trpc.media.listMedia.useInfiniteQuery(
    { albumId: albumId ?? 0, type: "image", take: 60 },
    { enabled: isAuthenticated && !!albumId && step === "photos", getNextPageParam: (last) => last.nextCursor },
  );
  const photoItems = useMemo(() => photos.data?.pages.flatMap((p) => p.items) ?? [], [photos.data]);

  const suggest = trpc.studio.suggest.useMutation({
    onSuccess: (s) => {
      setTitle(s.title);
      setSubtitle(s.subtitle);
      const next: Record<number, string> = {};
      selected.forEach((id, i) => {
        if (s.captions[i]) next[id] = s.captions[i]!;
      });
      setCaptions(next);
      if (Object.keys(next).length) setShowCaptions(true);
      toast.success(s.source === "llm" ? l("已生成 AI 文案", "AI copy generated") : l("已填入默认文案", "Default copy applied"));
    },
    onError: (e) => toast.error(e.message),
  });

  const render = trpc.studio.render.useMutation({
    onSuccess: ({ jobId: id }) => {
      setJobId(id);
      setStep("render");
    },
    onError: (e) => toast.error(e.message),
  });
  // P8: jobs are persisted — a failed job can be re-queued server-side with its stored input.
  const retryJob = trpc.studio.retry.useMutation({
    onSuccess: ({ jobId: id }) => setJobId(id),
    onError: (e) => toast.error(e.message),
  });

  const job = trpc.studio.job.useQuery(
    { jobId: jobId ?? "00000000-0000-0000-0000-000000000000" },
    {
      enabled: !!jobId && step === "render",
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "completed" || s === "failed" ? false : 1500;
      },
      retry: false,
    },
  );
  useEffect(() => {
    if (job.data?.status === "completed") {
      void Promise.all([utils.media.invalidate(), utils.album.invalidate(), utils.timeline.invalidate()]);
    }
  }, [job.data?.status, utils]);

  /* ---------------- actions ---------------- */
  const togglePhoto = (id: number) =>
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_PHOTOS) {
        toast.warning(l(`最多选择 ${MAX_PHOTOS} 张照片`, `Up to ${MAX_PHOTOS} photos`));
        return prev;
      }
      return [...prev, id];
    });
  const move = (id: number, dir: -1 | 1) =>
    setSelected((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const handleSuggest = () => {
    if (!albumId || !templateId || selected.length === 0) return;
    suggest.mutate({ albumId, mediaIds: selected, templateId, language: l("zh", "en") as "zh" | "en" });
  };

  const handleRender = () => {
    if (!albumId || !templateId || selected.length === 0) return;
    render.mutate({
      albumId,
      mediaIds: selected,
      templateId,
      title: title.trim() || undefined,
      subtitle: subtitle.trim() || undefined,
      captions: showCaptions ? selected.map((id) => captions[id] ?? "") : undefined,
      secondsPerSlide: secondsPerSlide ?? undefined,
      transition: transition ?? undefined,
      music: music ?? undefined,
      musicKey: customMusic?.key,
    });
  };

  const resetWizard = () => {
    setStep("template");
    setCustomMusic(null);
    setSelected([]);
    setTitle("");
    setSubtitle("");
    setCaptions({});
    setJobId(null);
  };

  const estimatedSeconds = useMemo(() => {
    const per = secondsPerSlide ?? template?.secondsPerSlide ?? 3;
    const n = selected.length + (title.trim() ? 1 : 0);
    return n === 0 ? 0 : Math.round(n * per - (n - 1) * 0.5);
  }, [secondsPerSlide, template, selected.length, title]);

  /* ---------------- shared header ---------------- */
  const Header = ({ label, onBack }: { label: string; onBack: () => void }) => (
    <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
      <Pressable onPress={onBack} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center" accessibilityRole="button">
        <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
      </Pressable>
      <Text className="text-lg font-bold text-foreground">{label}</Text>
      <View className="w-12" />
    </View>
  );

  const StepDots = () => {
    const order: Step[] = ["template", "photos", "edit", "render"];
    const idx = order.indexOf(step);
    return (
      <View className="flex-row items-center justify-center gap-2 py-2">
        {order.map((s, i) => (
          <View key={s} className="h-1.5 rounded-full" style={{ width: i === idx ? 24 : 8, backgroundColor: i <= idx ? colors.primary : colors.border }} />
        ))}
      </View>
    );
  };

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="bg-background p-0">
        <Header label={t("studio.videoStudio")} onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center gap-3 p-8">
          <MaterialIcons name="movie" size={56} color={colors.muted} />
          <Text className="text-base text-muted text-center">{l("登录后即可用家庭照片制作回忆视频", "Sign in to turn family photos into memory videos")}</Text>
        </View>
      </ScreenContainer>
    );
  }

  /* ---------------- step 1: template ---------------- */
  if (step === "template") {
    const unavailable = templates.data && !templates.data.rendererAvailable;
    return (
      <ScreenContainer className="bg-background p-0">
        <Header label={t("studio.videoStudio")} onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <StepDots />
          <View className="flex-1 px-6 py-2 gap-4">
            <View className="gap-2">
              <Text className="text-2xl font-bold text-foreground">{t("studio.chooseTemplate")}</Text>
              <Text className="text-sm text-muted">{t("studio.chooseABeautifulTemplate")}</Text>
            </View>
            {unavailable && (
              <View className="flex-row items-center gap-2 bg-warning/15 rounded-2xl p-3">
                <MaterialIcons name="warning" size={20} color={colors.warning} />
                <Text className="text-xs text-foreground flex-1">{l("服务器尚未安装视频渲染器（ffmpeg），暂时无法导出。", "The server has no video renderer (ffmpeg) installed; export is disabled.")}</Text>
              </View>
            )}
            {templates.isLoading && <ActivityIndicator color={colors.primary} />}
            {templates.data?.templates.map((tpl) => {
              const active = templateId === tpl.id;
              return (
                <Pressable
                  key={tpl.id}
                  onPress={() => {
                    setTemplateId(tpl.id as TemplateId);
                    setStep("photos");
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className="flex-row items-center gap-4 bg-surface rounded-2xl p-4 active:opacity-80 min-h-[88px]"
                  style={active ? { borderWidth: 2, borderColor: colors.primary } : undefined}
                >
                  <View className="w-16 h-16 rounded-2xl items-center justify-center" style={{ backgroundColor: `#${tpl.accent}` }}>
                    <MaterialIcons name={tpl.icon as keyof typeof MaterialIcons.glyphMap} size={32} color="white" />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="font-bold text-foreground">{l(tpl.name, tpl.nameEn)}</Text>
                    <Text className="text-xs text-muted">{l(tpl.description, tpl.descriptionEn)}</Text>
                    <View className="flex-row gap-3 mt-1">
                      <Text className="text-xs text-muted"><MaterialIcons name="timer" size={12} /> {tpl.secondsPerSlide}s / {l("张", "photo")}</Text>
                      <Text className="text-xs text-muted"><MaterialIcons name="music-note" size={12} /> {tpl.music}</Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  /* ---------------- step 2: photos ---------------- */
  if (step === "photos") {
    return (
      <ScreenContainer className="bg-background p-0">
        <Header label={t("studio.manageMedia")} onBack={() => setStep("template")} />
        <StepDots />
        <View className="px-6 gap-3">
          <FamilySwitcher variant="row" />
          <Text className="text-sm text-muted">{l("选择相册，然后按顺序点选照片（最多 12 张）", "Pick an album, then tap photos in order (up to 12)")}</Text>
          {albums.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(albums.data ?? []).map((a) => {
                const active = a.id === albumId;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => {
                      if (a.id !== albumId) {
                        setAlbumId(a.id);
                        setSelected([]);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className="rounded-full px-4 min-h-[44px] items-center justify-center"
                    style={{ backgroundColor: active ? colors.primary : colors.surface }}
                  >
                    <Text className={active ? "font-semibold text-onPrimary" : "font-semibold text-foreground"} numberOfLines={1}>{a.name}</Text>
                  </Pressable>
                );
              })}
              {(albums.data ?? []).length === 0 && <Text className="text-sm text-muted">{l("该家庭还没有相册", "No albums in this family yet")}</Text>}
            </ScrollView>
          )}
        </View>
        <FlatList
          data={photoItems}
          keyExtractor={(m) => String(m.id)}
          numColumns={3}
          className="flex-1 mt-3"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, gap: 4 }}
          columnWrapperStyle={{ gap: 4 }}
          onEndReached={() => photos.hasNextPage && !photos.isFetchingNextPage && photos.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            photos.isLoading ? (
              <ActivityIndicator color={colors.primary} className="mt-8" />
            ) : (
              <View className="items-center gap-2 mt-10">
                <MaterialIcons name="photo-library" size={48} color={colors.muted} />
                <Text className="text-sm text-muted">{l("这个相册还没有照片", "No photos in this album")}</Text>
                {albumId && (
                  <Pressable onPress={() => router.push({ pathname: "/upload", params: { albumId: String(albumId) } })} className="mt-2 px-4 min-h-[44px] items-center justify-center rounded-full" style={{ backgroundColor: colors.primary }}>
                    <Text className="font-semibold text-onPrimary">{l("去上传", "Upload")}</Text>
                  </Pressable>
                )}
              </View>
            )
          }
          ListFooterComponent={photos.isFetchingNextPage ? <ActivityIndicator color={colors.primary} className="my-3" /> : null}
          renderItem={({ item }) => {
            const idx = selected.indexOf(item.id);
            const isSel = idx >= 0;
            return (
              <Pressable
                onPress={() => togglePhoto(item.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSel }}
                className="rounded-xl overflow-hidden"
                style={{ flex: 1 / 3, aspectRatio: 1, opacity: isSel ? 1 : 0.92, borderWidth: isSel ? 3 : 0, borderColor: colors.primary }}
              >
                <SignedImage mediaId={item.id} style={{ width: "100%", height: "100%" }} />
                {isSel && (
                  <View className="absolute top-1 right-1 w-7 h-7 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
                    <Text className="text-xs font-bold text-onPrimary">{idx + 1}</Text>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
        {/* bottom bar */}
        <View className="absolute left-0 right-0 bottom-0 px-6 pb-6 pt-3 bg-background border-t border-border flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="font-semibold text-foreground">{l(`已选 ${selected.length} / ${MAX_PHOTOS}`, `${selected.length} / ${MAX_PHOTOS} selected`)}</Text>
            <Text className="text-xs text-muted">{l(`约 ${estimatedSeconds} 秒`, `≈ ${estimatedSeconds}s`)}</Text>
          </View>
          <Pressable
            onPress={() => setStep("edit")}
            disabled={selected.length === 0}
            accessibilityRole="button"
            className="rounded-full px-6 min-h-[48px] items-center justify-center"
            style={{ backgroundColor: selected.length === 0 ? colors.border : colors.primary }}
          >
            <Text className="font-semibold text-onPrimary">{t("next")}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  /* ---------------- step 3: edit ---------------- */
  if (step === "edit") {
    const per = secondsPerSlide ?? template?.secondsPerSlide ?? 3;
    const trans = transition ?? template?.transition ?? "fade";
    const mood: Music = music ?? (template?.music as Music | undefined) ?? "none";
    const canRender = templates.data?.rendererAvailable !== false && !render.isPending;
    return (
      <ScreenContainer className="bg-background p-0">
        <Header label={t("common.editVideo")} onBack={() => setStep("photos")} />
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <StepDots />
          <View className="px-6 py-2 gap-6">
            {/* order preview */}
            <View className="gap-2">
              <Text className="text-lg font-bold text-foreground">{t("preview")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {title.trim() ? (
                  <View className="w-24 h-24 rounded-xl items-center justify-center p-2" style={{ backgroundColor: "#1a1a1a" }}>
                    <Text className="text-xs font-bold text-center" numberOfLines={3} style={{ color: `#${template?.accent ?? "D4AF37"}` }}>{title}</Text>
                  </View>
                ) : null}
                {selected.map((id, i) => (
                  <View key={id} className="w-24 gap-1">
                    <View className="w-24 h-24 rounded-xl overflow-hidden">
                      <SignedImage mediaId={id} style={{ width: "100%", height: "100%" }} />
                      <View className="absolute top-1 left-1 w-6 h-6 rounded-full items-center justify-center bg-black/60">
                        <Text className="text-[10px] font-bold text-white">{i + 1}</Text>
                      </View>
                    </View>
                    <View className="flex-row justify-between">
                      <Pressable onPress={() => move(id, -1)} disabled={i === 0} className="w-10 h-10 items-center justify-center" accessibilityLabel={l("前移", "Move earlier")}>
                        <MaterialIcons name="chevron-left" size={22} color={i === 0 ? colors.border : colors.foreground} />
                      </Pressable>
                      <Pressable onPress={() => togglePhoto(id)} className="w-10 h-10 items-center justify-center" accessibilityLabel={l("移除", "Remove")}>
                        <MaterialIcons name="close" size={18} color={colors.error} />
                      </Pressable>
                      <Pressable onPress={() => move(id, 1)} disabled={i === selected.length - 1} className="w-10 h-10 items-center justify-center" accessibilityLabel={l("后移", "Move later")}>
                        <MaterialIcons name="chevron-right" size={22} color={i === selected.length - 1 ? colors.border : colors.foreground} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Text className="text-xs text-muted">{l(`${selected.length} 张 · 约 ${estimatedSeconds} 秒 · ${l(template?.name ?? "", template?.nameEn ?? "")}`, `${selected.length} photos · ≈ ${estimatedSeconds}s · ${template?.nameEn ?? ""}`)}</Text>
            </View>

            {/* text */}
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">{t("editText")}</Text>
                <Pressable
                  onPress={handleSuggest}
                  disabled={suggest.isPending}
                  accessibilityRole="button"
                  className="flex-row items-center gap-1 rounded-full px-3 min-h-[40px]"
                  style={{ backgroundColor: `${colors.primary}22` }}
                >
                  {suggest.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />}
                  <Text className="text-sm font-semibold text-primary">{l("AI 生成文案", "AI copy")}</Text>
                </Pressable>
              </View>
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">{t("title")}</Text>
                <TextInput
                  value={title}
                  onChangeText={(v) => setTitle(v.slice(0, 60))}
                  placeholder={l("例如：爸妈的金婚五十年", "e.g. Fifty golden years")}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground"
                  style={{ fontSize: 16 }}
                />
              </View>
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">{l("副标题", "Subtitle")}</Text>
                <TextInput
                  value={subtitle}
                  onChangeText={(v) => setSubtitle(v.slice(0, 80))}
                  placeholder={l("例如：1976 — 2026 · 相守五十年", "e.g. 1976 — 2026")}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground"
                  style={{ fontSize: 16 }}
                />
              </View>
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-1">
                  <Text className="font-semibold text-foreground">{t("studio.addTitlesAndSubtitles")}</Text>
                  <Text className="text-xs text-muted">{l("为每张照片加一行字幕", "One caption line per photo")}</Text>
                </View>
                <Switch value={showCaptions} onValueChange={setShowCaptions} trackColor={{ false: colors.border, true: colors.primary }} />
              </View>
              {showCaptions &&
                selected.map((id, i) => (
                  <View key={id} className="flex-row items-center gap-2">
                    <View className="w-12 h-12 rounded-lg overflow-hidden">
                      <SignedImage mediaId={id} style={{ width: "100%", height: "100%" }} />
                    </View>
                    <TextInput
                      value={captions[id] ?? ""}
                      onChangeText={(v) => setCaptions((prev) => ({ ...prev, [id]: v.slice(0, 80) }))}
                      placeholder={l(`第 ${i + 1} 张字幕`, `Caption ${i + 1}`)}
                      placeholderTextColor={colors.muted}
                      className="flex-1 bg-surface rounded-xl px-3 min-h-[48px] text-foreground"
                    />
                  </View>
                ))}
            </View>

            {/* pacing + transition */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">{t("studio.transitions")}</Text>
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">{l("每张停留", "Per photo")}</Text>
                  <Text className="text-sm text-muted">{per}s</Text>
                </View>
                <View className="flex-row gap-2">
                  {[2, 3, 4, 5, 6].map((sec) => {
                    const active = per === sec;
                    return (
                      <Pressable
                        key={sec}
                        onPress={() => setSecondsPerSlide(sec)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        className="flex-1 rounded-xl min-h-[44px] items-center justify-center"
                        style={{ backgroundColor: active ? colors.primary : colors.background }}
                      >
                        <Text className={active ? "font-semibold text-onPrimary" : "font-semibold text-foreground"}>{sec}s</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="font-semibold text-foreground mt-1">{t("studio.setTransitionEffects")}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {TRANSITIONS.map((tr) => {
                    const active = trans === tr.id;
                    return (
                      <Pressable
                        key={tr.id}
                        onPress={() => setTransition(tr.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        className="rounded-full px-4 min-h-[44px] items-center justify-center"
                        style={{ backgroundColor: active ? colors.primary : colors.background }}
                      >
                        <Text className={active ? "font-semibold text-onPrimary" : "font-semibold text-foreground"}>{l(tr.zh, tr.en)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="font-semibold text-foreground mt-1">{t("studio.chooseMusic")}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {MUSIC_OPTIONS.map((m) => {
                    const active = mood === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => setMusic(m.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        className="rounded-full px-4 min-h-[44px] items-center justify-center flex-row gap-1"
                        style={{ backgroundColor: active ? colors.primary : colors.background }}
                      >
                        <MaterialIcons name={m.icon} size={16} color={active ? colors.onPrimary : colors.muted} />
                        <Text className={active ? "font-semibold text-onPrimary" : "font-semibold text-foreground"}>{l(m.zh, m.en)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {/* P10: 自选配乐 */}
                <View className="flex-row items-center gap-2 flex-wrap">
                  <Pressable
                    onPress={pickSoundtrack}
                    disabled={musicUploading || templates.data?.storageConfigured === false}
                    accessibilityRole="button"
                    className="rounded-full px-4 min-h-[44px] items-center justify-center flex-row gap-1"
                    style={{ backgroundColor: customMusic ? colors.primary : colors.background, opacity: templates.data?.storageConfigured === false ? 0.5 : 1 }}
                  >
                    {musicUploading ? <ActivityIndicator size="small" color={customMusic ? colors.onPrimary : colors.primary} /> : <MaterialIcons name="library-music" size={16} color={customMusic ? colors.onPrimary : colors.muted} />}
                    <Text className={customMusic ? "font-semibold text-onPrimary" : "font-semibold text-foreground"} numberOfLines={1}>
                      {customMusic ? customMusic.name : l("上传自己的配乐", "Upload my own music")}
                    </Text>
                  </Pressable>
                  {customMusic && (
                    <Pressable onPress={() => setCustomMusic(null)} accessibilityLabel={l("移除自选配乐", "Remove soundtrack")} className="min-w-[44px] min-h-[44px] items-center justify-center">
                      <MaterialIcons name="close" size={20} color={colors.muted} />
                    </Pressable>
                  )}
                </View>
                <Text className="text-xs text-muted">
                  {customMusic
                    ? l("将使用您上传的音频（mp3 / m4a / wav，≤ 20 MB），自动循环裁剪并淡入淡出；上方情绪选项不再生效。", "Your uploaded track (mp3 / m4a / wav, ≤ 20 MB) is looped / trimmed to fit with fade in / out; the mood chips above are ignored.")
                    : templates.data?.storageConfigured === false
                      ? l("配乐由服务器按情绪即时生成（无版权风险）。上传自选配乐需要配置对象存储。", "Music is generated per mood (royalty-free). Uploading your own track requires object storage.")
                      : l("配乐由服务器按情绪即时生成（无版权风险），音量柔和并自动淡入淡出；也可上传自己的音频。", "Music is generated on the server per mood (royalty-free) with automatic fade in / out — or upload your own track.")}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
        <View className="absolute left-0 right-0 bottom-0 px-6 pb-6 pt-3 bg-background border-t border-border flex-row gap-3">
          <Pressable onPress={() => setStep("photos")} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
            <Text className="font-semibold text-foreground">{t("studio.manageMedia")}</Text>
          </Pressable>
          <Pressable
            onPress={handleRender}
            disabled={!canRender}
            accessibilityRole="button"
            className="flex-1 rounded-full min-h-[48px] items-center justify-center flex-row gap-2"
            style={{ backgroundColor: canRender ? colors.primary : colors.border }}
          >
            {render.isPending ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <MaterialIcons name="movie-creation" size={20} color={colors.onPrimary} />}
            <Text className="font-semibold text-onPrimary">{t("export")}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  /* ---------------- step 4: render / done ---------------- */
  const status = job.data?.status ?? "queued";
  const progress = job.data?.progress ?? 0;
  const failed = status === "failed" || job.isError;
  const done = status === "completed" && !!job.data?.mediaId;
  const stageLabel: Record<string, [string, string]> = {
    queued: ["排队中", "Queued"],
    claimed: ["已分配渲染器", "Assigned to a worker"],
    requeued: ["重新排队", "Re-queued"],
    preparing: ["准备素材", "Preparing"],
    title: ["制作片头", "Title card"],
    download: ["下载照片", "Fetching photos"],
    slide: ["渲染镜头", "Rendering shots"],
    concat: ["拼接转场", "Stitching"],
    poster: ["生成封面", "Poster"],
    music: ["合成配乐", "Adding music"],
    upload: ["上传到相册", "Uploading"],
    done: ["完成", "Done"],
    error: ["失败", "Failed"],
  };
  const [stageZh, stageEn] = stageLabel[job.data?.stage ?? "queued"] ?? ["处理中", "Working"];

  return (
    <ScreenContainer className="bg-background p-0">
      <Header label={t("export")} onBack={() => (done || failed ? router.back() : undefined)} />
      <StepDots />
      <View className="flex-1 items-center justify-center px-8 gap-6">
        <View className="w-32 h-32 rounded-full items-center justify-center" style={{ backgroundColor: `${failed ? colors.error : colors.primary}22` }}>
          {done ? (
            <MaterialIcons name="check-circle" size={72} color={colors.success} />
          ) : failed ? (
            <MaterialIcons name="error" size={72} color={colors.error} />
          ) : (
            <ActivityIndicator size="large" color={colors.primary} />
          )}
        </View>
        <View className="items-center gap-2">
          <Text className="text-2xl font-bold text-foreground text-center">
            {done ? t("studio.videoExportedSuccessfully") : failed ? l("导出失败", "Export failed") : l(stageZh, stageEn)}
          </Text>
          {!done && !failed && (
            <Text className="text-sm text-muted">
              {status === "queued" && job.data?.queuePosition
                ? l(`队列第 ${job.data.queuePosition} 位`, `#${job.data.queuePosition} in queue`)
                : `${progress}%`}
            </Text>
          )}
          {failed && (
            <Text className="text-sm text-muted text-center">
              {job.data?.error ?? (job.isError ? l("任务已丢失（服务器重启），请重试", "Job lost (server restarted) — please retry") : "")}
            </Text>
          )}
          {done && <Text className="text-sm text-muted text-center">{l("视频已保存到相册，家人会收到通知。", "Saved to the album; your family has been notified.")}</Text>}
        </View>
        {!done && !failed && (
          <View className="w-full h-2 rounded-full overflow-hidden bg-border">
            <View className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </View>
        )}
        {!done && !failed && (
          <Text className="text-xs text-muted text-center">{l("渲染在服务器进行，可以离开此页，稍后在相册中查看。", "Rendering happens on the server — you can leave and find the video in the album later.")}</Text>
        )}
        {done && (
          <View className="w-full gap-3">
            <Pressable
              onPress={() => router.replace({ pathname: "/video/[id]", params: { id: String(job.data!.mediaId) } })}
              accessibilityRole="button"
              className="rounded-full min-h-[52px] items-center justify-center flex-row gap-2"
              style={{ backgroundColor: colors.primary }}
            >
              <MaterialIcons name="play-circle" size={22} color={colors.onPrimary} />
              <Text className="font-semibold text-onPrimary">{l("立即观看", "Watch now")}</Text>
            </Pressable>
            <Pressable onPress={resetWizard} className="rounded-full min-h-[48px] items-center justify-center bg-surface" accessibilityRole="button">
              <Text className="font-semibold text-foreground">{l("再做一个", "Make another")}</Text>
            </Pressable>
          </View>
        )}
        {failed && (
          <View className="w-full gap-3">
            <Pressable
              onPress={() => (jobId && job.data?.status === "failed" ? retryJob.mutate({ jobId }) : setStep("edit"))}
              disabled={retryJob.isPending}
              className="rounded-full min-h-[52px] items-center justify-center flex-row gap-2"
              style={{ backgroundColor: colors.primary }}
              accessibilityRole="button"
            >
              {retryJob.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <MaterialIcons name="refresh" size={20} color={colors.onPrimary} />}
              <Text className="font-semibold text-onPrimary">{l("重试", "Retry")}</Text>
            </Pressable>
            <Pressable onPress={() => setStep("edit")} className="rounded-full min-h-[48px] items-center justify-center bg-surface" accessibilityRole="button">
              <Text className="font-semibold text-foreground">{l("修改后重新导出", "Edit and export again")}</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} className="rounded-full min-h-[48px] items-center justify-center bg-surface" accessibilityRole="button">
              <Text className="font-semibold text-foreground">{t("close")}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}
