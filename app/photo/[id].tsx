import { ScrollView, Text, View, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { UserAvatar } from "@/components/user-avatar";
import { useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { MicButton } from "@/components/mic-button";
import { SignedImage } from "@/components/signed-image";
import { PhotoAIPanel } from "@/components/photo-ai-panel";
import { trpc } from "@/lib/trpc";

/**
 * Photo detail (P4 — real data).
 * media.getMedia + media.getSignedUrl (via SignedImage) + interaction.hasLiked /
 * createLike / deleteLike (optimistic) + getComments (with author) / createComment.
 */
export default function PhotoDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const mediaId = Number(id);
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [comment, setComment] = useState("");

  const valid = Number.isFinite(mediaId) && mediaId > 0;
  const media = trpc.media.getMedia.useQuery({ id: mediaId }, { enabled: valid && isAuthenticated });
  const liked = trpc.interaction.hasLiked.useQuery({ mediaId }, { enabled: valid && isAuthenticated });
  const comments = trpc.interaction.getComments.useQuery({ mediaId, take: 100 }, { enabled: valid && isAuthenticated });
  const uploader = trpc.family.getMembers.useQuery(
    { familyId: media.data?.familyId ?? 0 },
    { enabled: !!media.data?.familyId, staleTime: 60_000 },
  );
  const authorName =
    uploader.data?.find((m) => m.userId === media.data?.uploadedBy)?.user.name ?? t("notif.someone");
  const myRole = uploader.data?.find((m) => m.userId === user?.id)?.role;
  const isFamilyAdmin = myRole === "owner" || myRole === "admin";

  /* ------------------------------ like ------------------------------ */

  const invalidateLike = () =>
    Promise.all([utils.interaction.hasLiked.invalidate({ mediaId }), utils.media.getMedia.invalidate({ id: mediaId })]);

  const like = trpc.interaction.createLike.useMutation({
    onMutate: async () => {
      await utils.interaction.hasLiked.cancel({ mediaId });
      utils.interaction.hasLiked.setData({ mediaId }, { liked: true });
      utils.media.getMedia.setData({ id: mediaId }, (prev) => (prev ? { ...prev, likeCount: prev.likeCount + 1 } : prev));
    },
    onError: (e) => { toast.error(e.message); void invalidateLike(); },
    onSettled: () => void invalidateLike(),
  });
  const unlike = trpc.interaction.deleteLike.useMutation({
    onMutate: async () => {
      await utils.interaction.hasLiked.cancel({ mediaId });
      utils.interaction.hasLiked.setData({ mediaId }, { liked: false });
      utils.media.getMedia.setData({ id: mediaId }, (prev) => (prev ? { ...prev, likeCount: Math.max(0, prev.likeCount - 1) } : prev));
    },
    onError: (e) => { toast.error(e.message); void invalidateLike(); },
    onSettled: () => void invalidateLike(),
  });
  const toggleLike = () => (liked.data?.liked ? unlike.mutate({ mediaId }) : like.mutate({ mediaId }));

  /* ----------------------------- comment ---------------------------- */

  const addComment = trpc.interaction.createComment.useMutation({
    onSuccess: async () => {
      setComment("");
      await Promise.all([utils.interaction.getComments.invalidate({ mediaId }), utils.media.getMedia.invalidate({ id: mediaId })]);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteComment = trpc.interaction.deleteComment.useMutation({
    onSuccess: () => Promise.all([utils.interaction.getComments.invalidate({ mediaId }), utils.media.getMedia.invalidate({ id: mediaId })]),
    onError: (e) => toast.error(e.message),
  });

  const handleAddComment = () => {
    const content = comment.trim();
    if (!content) return;
    addComment.mutate({ mediaId, content });
  };

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const commentList = comments.data ?? [];

  /* ----------------------------- states ----------------------------- */

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
        <MaterialIcons name="broken-image" size={48} color={colors.muted} />
        <Text className="text-lg font-semibold text-foreground">{l("无权查看或照片不存在", "Photo not found or access denied")}</Text>
        <Pressable onPress={() => router.back()} className="px-6 py-3 min-h-[48px] rounded-full bg-primary">
          <Text className="font-semibold text-onPrimary">{t("cancel")}</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  const item = media.data;

  // P8: accept AI-suggested title / caption → media.updateMedia
  const updateMedia = trpc.media.updateMedia.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.media.getMedia.invalidate({ id: mediaId }), utils.media.recent.invalidate(), utils.media.listMedia.invalidate()]);
      toast.success(t("success"));
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={media.isRefetching || comments.isRefetching}
            onRefresh={() => { void media.refetch(); void comments.refetch(); }}
            tintColor={colors.primary}
          />
        }
      >
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{t("photo.photoDetails")}</Text>
            <Pressable
              onPress={() => router.push("/share" as any)}
              accessibilityLabel={t("common.share")}
              className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
            >
              <MaterialIcons name="share" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 照片（签名 URL，全尺寸） */}
          {item ? (
            <SignedImage mediaId={item.id} thumbnail={false} className="w-full h-80" resizeMode="cover" />
          ) : (
            <View className="w-full h-80 bg-surface items-center justify-center">
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          <View className="flex-1 px-6 py-4 gap-4">
            {/* 标题和描述 */}
            <View className="gap-2">
              <Text className="text-2xl font-bold text-foreground">{item?.title ?? "…"}</Text>
              {item?.description ? <Text className="text-sm text-muted">{item.description}</Text> : null}
            </View>

            {/* 作者信息和日期 */}
            <View className="flex-row items-center justify-between py-3 border-b border-border">
              <View className="flex-row items-center gap-2">
                <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
                  <Text className="font-bold text-onPrimary">{authorName[0] ?? "?"}</Text>
                </View>
                <View>
                  <Text className="font-semibold text-foreground">{authorName}</Text>
                  <Text className="text-xs text-muted">{item ? new Date(item.createdAt).toLocaleDateString(locale) : ""}</Text>
                </View>
              </View>
              <Pressable
                onPress={() => router.push({ pathname: "/album", params: { albumId: String(item?.albumId) } } as any)}
                disabled={!item}
                className="px-3 py-2 min-h-[44px] justify-center rounded-full bg-surface"
              >
                <Text className="text-sm font-semibold text-primary">{t("common.albums")}</Text>
              </Pressable>
            </View>

            {/* 互动栏 */}
            <View className="flex-row items-center justify-around py-3 border-b border-border">
              <Pressable
                onPress={toggleLike}
                disabled={!item || like.isPending || unlike.isPending}
                accessibilityRole="button"
                accessibilityState={{ selected: !!liked.data?.liked }}
                className="flex-row items-center gap-2 px-4 min-h-[48px] active:opacity-80"
              >
                <MaterialIcons name={liked.data?.liked ? "favorite" : "favorite-border"} size={24} color={liked.data?.liked ? colors.error : colors.muted} />
                <Text className="font-semibold text-foreground">{item?.likeCount ?? 0}</Text>
              </Pressable>
              <View className="flex-row items-center gap-2 px-4 min-h-[48px]">
                <MaterialIcons name="comment" size={24} color={colors.muted} />
                <Text className="font-semibold text-foreground">{item?.commentCount ?? commentList.length}</Text>
              </View>
              <Pressable onPress={() => router.push("/share" as any)} className="flex-row items-center gap-2 px-4 min-h-[48px] active:opacity-80">
                <MaterialIcons name="share" size={24} color={colors.muted} />
                <Text className="font-semibold text-foreground">{t("common.share")}</Text>
              </Pressable>
            </View>

            {/* P8: AI 识别（场景 / 标签 / 人物 → 家庭成员） */}
            {item && item.type === "photo" && (
              <View className="py-3 border-b border-border">
                <PhotoAIPanel
                  mediaId={item.id}
                  familyId={item.familyId}
                  currentTitle={item.title}
                  canEdit={user?.id === item.uploadedBy || isFamilyAdmin}
                  onApplyText={(patch) => updateMedia.mutate({ id: item.id, ...patch })}
                />
              </View>
            )}

            {/* 评论区 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("common.comments")} ({item?.commentCount ?? commentList.length})
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
                  onSubmitEditing={handleAddComment}
                />
                <MicButton disabled={addComment.isPending} onTranscript={(text) => setComment((prev) => (prev ? `${prev} ${text}` : text))} />
                <Pressable
                  onPress={handleAddComment}
                  disabled={!comment.trim() || addComment.isPending}
                  accessibilityLabel={t("writeComment")}
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
              ) : commentList.length === 0 ? (
                <Text className="text-sm text-muted text-center py-6">{l("还没有评论，来说点什么吧", "No comments yet — be the first")}</Text>
              ) : (
                commentList.map((c) => {
                  const name = c.author?.name ?? t("notif.someone");
                  const mine = user?.id === c.userId;
                  return (
                    <View key={c.id} className="flex-row gap-3 mb-2">
                      <UserAvatar avatar={c.author?.avatar} name={name} size={40} bgClassName="bg-primary" textClassName="text-onPrimary" />
                      <View className="flex-1 gap-1">
                        <View className="flex-row items-center justify-between">
                          <Text className="font-semibold text-foreground">{name}</Text>
                          <View className="flex-row items-center gap-2">
                            <Text className="text-xs text-muted">{new Date(c.createdAt).toLocaleDateString(locale)}</Text>
                            {mine && (
                              <Pressable
                                onPress={() => deleteComment.mutate({ id: c.id })}
                                hitSlop={8}
                                accessibilityLabel={t("deletePhoto")}
                                className="min-w-[32px] min-h-[32px] items-center justify-center"
                              >
                                <MaterialIcons name="delete-outline" size={16} color={colors.muted} />
                              </Pressable>
                            )}
                          </View>
                        </View>
                        <Text className="text-sm text-foreground">{c.content}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
