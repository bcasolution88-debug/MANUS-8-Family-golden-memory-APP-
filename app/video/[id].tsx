import { ScrollView, Text, View, Pressable, TextInput, ActivityIndicator, Platform } from "react-native";
import { UserAvatar } from "@/components/user-avatar";
import { useEffect, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { SignedImage } from "@/components/signed-image";
import { MicButton } from "@/components/mic-button";
import { trpc } from "@/lib/trpc";

const SIGNED_URL_STALE_MS = 12 * 60 * 1000;

const fmtDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Video detail (P5 — real data).
 * media.getMedia → media.getSignedUrl (full URL) → expo-video player with
 * native controls; poster from SignedImage; like / comments / share wired to
 * the same procedures as the photo page. Filters / effects live in Studio.
 */
export default function VideoDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const mediaId = Number(id);
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [comment, setComment] = useState("");

  const valid = Number.isFinite(mediaId) && mediaId > 0;
  const media = trpc.media.getMedia.useQuery({ id: mediaId }, { enabled: valid && isAuthenticated });
  const signed = trpc.media.getSignedUrl.useQuery(
    { id: mediaId },
    { enabled: valid && isAuthenticated, staleTime: SIGNED_URL_STALE_MS, refetchInterval: SIGNED_URL_STALE_MS },
  );
  const liked = trpc.interaction.hasLiked.useQuery({ mediaId }, { enabled: valid && isAuthenticated });
  const comments = trpc.interaction.getComments.useQuery({ mediaId, take: 50 }, { enabled: valid && isAuthenticated });
  const members = trpc.family.getMembers.useQuery(
    { familyId: media.data?.familyId ?? 0 },
    { enabled: !!media.data?.familyId, staleTime: 60_000 },
  );
  const uploader = members.data?.find((m) => m.userId === media.data?.uploadedBy)?.user;

  /* ------------------------------ player ----------------------------- */

  const player = useVideoPlayer(signed.data?.url ?? null, (p) => {
    p.loop = false;
  });
  // Swap the source when the signed URL refreshes (keeps position where possible).
  useEffect(() => {
    if (!signed.data?.url) return;
    const wasPlaying = player.playing;
    const pos = player.currentTime;
    player.replace(signed.data.url);
    if (pos > 0) player.currentTime = pos;
    if (wasPlaying) player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signed.data?.url]);

  /* ------------------------------ like ------------------------------- */

  const invalidateLike = () =>
    Promise.all([utils.interaction.hasLiked.invalidate({ mediaId }), utils.media.getMedia.invalidate({ id: mediaId })]);
  const like = trpc.interaction.createLike.useMutation({
    onMutate: () => {
      utils.interaction.hasLiked.setData({ mediaId }, { liked: true });
      utils.media.getMedia.setData({ id: mediaId }, (prev) => (prev ? { ...prev, likeCount: prev.likeCount + 1 } : prev));
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void invalidateLike(),
  });
  const unlike = trpc.interaction.deleteLike.useMutation({
    onMutate: () => {
      utils.interaction.hasLiked.setData({ mediaId }, { liked: false });
      utils.media.getMedia.setData({ id: mediaId }, (prev) => (prev ? { ...prev, likeCount: Math.max(0, prev.likeCount - 1) } : prev));
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void invalidateLike(),
  });
  const toggleLike = () => (liked.data?.liked ? unlike.mutate({ mediaId }) : like.mutate({ mediaId }));

  const addComment = trpc.interaction.createComment.useMutation({
    onSuccess: async () => {
      setComment("");
      await Promise.all([utils.interaction.getComments.invalidate({ mediaId }), utils.media.getMedia.invalidate({ id: mediaId })]);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleDownload = () => {
    if (!signed.data?.url) return;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(signed.data.url, "_blank", "noopener");
    }
    toast.success(t("video.videoDownloaded"));
  };

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const item = media.data;

  /* ------------------------------ states ----------------------------- */

  if (!valid || (!isAuthenticated && !media.isLoading)) {
    return (
      <ScreenContainer className="bg-background items-center justify-center gap-3">
        <MaterialIcons name="lock-outline" size={48} color={colors.muted} />
        <Text className="text-lg font-semibold text-foreground">{t("messages.signInToSee")}</Text>
      </ScreenContainer>
    );
  }
  if (media.isError) {
    return (
      <ScreenContainer className="bg-background items-center justify-center gap-3">
        <MaterialIcons name="videocam-off" size={48} color={colors.muted} />
        <Text className="text-lg font-semibold text-foreground">{l("无权查看或视频不存在", "Video not found or access denied")}</Text>
        <Pressable onPress={() => router.back()} className="px-6 py-3 min-h-[48px] rounded-full bg-primary">
          <Text className="font-semibold text-onPrimary">{t("cancel")}</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{t("video.videoDetail")}</Text>
            <Pressable
              onPress={() => item && router.push({ pathname: "/album", params: { albumId: String(item.albumId) } } as any)}
              accessibilityLabel={t("common.albums")}
              className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
            >
              <MaterialIcons name="photo-library" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          <View className="flex-1 px-6 py-4 gap-4">
            {/* 播放器 */}
            <View className="bg-black rounded-2xl overflow-hidden" style={{ aspectRatio: 16 / 9 }}>
              {signed.data?.url ? (
                <VideoView
                  player={player}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="contain"
                  nativeControls
                  allowsFullscreen
                  allowsPictureInPicture
                />
              ) : item ? (
                <>
                  <SignedImage mediaId={item.id} className="w-full h-full" resizeMode="cover" />
                  <View className="absolute inset-0 items-center justify-center">
                    <ActivityIndicator color="white" />
                  </View>
                </>
              ) : (
                <View className="flex-1 items-center justify-center">
                  <ActivityIndicator color="white" />
                </View>
              )}
              {item?.duration ? (
                <View className="absolute bottom-2 right-2 bg-black/70 rounded-lg px-2 py-1" pointerEvents="none">
                  <Text className="text-white text-xs font-bold">{fmtDuration(item.duration)}</Text>
                </View>
              ) : null}
            </View>

            {/* 信息 */}
            <View className="gap-3">
              <Text className="text-2xl font-bold text-foreground">{item?.title ?? "…"}</Text>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <UserAvatar avatar={uploader?.avatar} name={uploader?.name} size={40} bgClassName="bg-primary" textClassName="text-onPrimary" />
                  <View>
                    <Text className="font-semibold text-foreground">{uploader?.name ?? t("notif.someone")}</Text>
                    <Text className="text-xs text-muted">{item ? new Date(item.createdAt).toLocaleDateString(locale) : ""}</Text>
                  </View>
                </View>
                <View className="flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1">
                    <MaterialIcons name="favorite" size={14} color={colors.muted} />
                    <Text className="text-xs text-muted">{item?.likeCount ?? 0}</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <MaterialIcons name="comment" size={14} color={colors.muted} />
                    <Text className="text-xs text-muted">{item?.commentCount ?? 0}</Text>
                  </View>
                </View>
              </View>
              {item?.description ? <Text className="text-sm text-muted">{item.description}</Text> : null}
            </View>

            {/* 操作 */}
            <View className="flex-row gap-2">
              <ActionButton
                icon={liked.data?.liked ? "favorite" : "favorite-border"}
                color={liked.data?.liked ? colors.error : colors.primary}
                label={t("common.like")}
                onPress={toggleLike}
                disabled={!item}
              />
              <ActionButton icon="share" color={colors.primary} label={t("common.share")} onPress={() => router.push("/share" as any)} />
              <ActionButton icon="download" color={colors.primary} label={t("video.download")} onPress={handleDownload} disabled={!signed.data?.url} />
              <ActionButton icon="edit" color={colors.primary} label={t("common.editVideo")} onPress={() => router.push("/studio" as any)} />
            </View>

            {/* 评论 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("common.comments")} ({item?.commentCount ?? comments.data?.length ?? 0})
              </Text>
              <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2 min-h-[48px]">
                <TextInput
                  placeholder={t("writeComment")}
                  value={comment}
                  onChangeText={setComment}
                  editable={!addComment.isPending}
                  placeholderTextColor={colors.muted}
                  className="flex-1 text-foreground"
                  maxLength={500}
                  onSubmitEditing={() => comment.trim() && addComment.mutate({ mediaId, content: comment.trim() })}
                />
                <MicButton disabled={addComment.isPending} onTranscript={(text) => setComment((prev) => (prev ? `${prev} ${text}` : text))} />
                <Pressable
                  onPress={() => comment.trim() && addComment.mutate({ mediaId, content: comment.trim() })}
                  disabled={!comment.trim() || addComment.isPending}
                  className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
                >
                  {addComment.isPending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <MaterialIcons name="send" size={20} color={comment.trim() ? colors.primary : colors.muted} />
                  )}
                </Pressable>
              </View>
              {comments.isLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (comments.data?.length ?? 0) === 0 ? (
                <Text className="text-sm text-muted text-center py-4">{l("还没有评论", "No comments yet")}</Text>
              ) : (
                comments.data!.map((c) => (
                  <View key={c.id} className="flex-row gap-3">
                    <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
                      <Text className="text-xs font-bold text-onPrimary">{(c.author?.name ?? "?").charAt(0)}</Text>
                    </View>
                    <View className="flex-1 gap-0.5">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-sm font-semibold text-foreground">{c.author?.name ?? t("notif.someone")}</Text>
                        <Text className="text-xs text-muted">{new Date(c.createdAt).toLocaleDateString(locale)}</Text>
                      </View>
                      <Text className="text-sm text-foreground">{c.content}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function ActionButton({
  icon,
  color,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-1 bg-surface rounded-2xl py-3 min-h-[56px] items-center justify-center gap-1 active:opacity-80"
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      <MaterialIcons name={icon} size={22} color={color} />
      <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}
