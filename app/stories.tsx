import { ScrollView, Text, View, Pressable, TextInput, Modal, ActivityIndicator, RefreshControl } from "react-native";
import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useFamilyId } from "@/hooks/use-family-id";
import { useBackHandler } from "@/hooks/use-back-handler";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { MicButton } from "@/components/mic-button";
import { trpc } from "@/lib/trpc";

type Draft = { id?: number; chapter: number; year: string; title: string; titleEn: string; description: string };

/**
 * Love Story (P6 — real data).
 * family.getLoveStories (ordered by chapter) → chapter cards; editor+ can add,
 * author | admin can edit / delete. The editor supports voice dictation via
 * MicButton (same pipeline as comments). Android back exits edit mode first.
 */
export default function StoriesScreen() {
  const router = useRouter();
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { familyId, isAuthenticated } = useFamilyId();

  const stories = trpc.family.getLoveStories.useQuery({ familyId: familyId ?? 0 }, { enabled: isAuthenticated && !!familyId });
  const members = trpc.family.getMembers.useQuery({ familyId: familyId ?? 0 }, { enabled: isAuthenticated && !!familyId, staleTime: 60_000 });
  const myRole = members.data?.find((m) => m.userId === user?.id)?.role;
  const canCreate = !!myRole && myRole !== "viewer";
  const isAdmin = myRole === "owner" || myRole === "admin";
  const nameOf = (id: number) => members.data?.find((m) => m.userId === id)?.user.name ?? t("notif.someone");

  // Server returns newest chapter first; the reader wants chronological order.
  const chapters = useMemo(() => [...(stories.data ?? [])].sort((a, b) => a.chapter - b.chapter), [stories.data]);
  const nextChapter = (chapters[chapters.length - 1]?.chapter ?? 0) + 1;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  useBackHandler(!!draft || deleteTarget !== null, () => {
    if (deleteTarget !== null) setDeleteTarget(null);
    else setDraft(null);
    return true;
  });

  const invalidate = () => Promise.all([utils.family.getLoveStories.invalidate(), utils.timeline.invalidate(), utils.profile.stats.invalidate()]);
  const create = trpc.family.createLoveStory.useMutation({
    onSuccess: async () => { await invalidate(); setDraft(null); toast.success(l("章节已添加", "Chapter added")); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.family.updateLoveStory.useMutation({
    onSuccess: async () => { await invalidate(); setDraft(null); toast.success(l("已保存", "Saved")); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.family.deleteLoveStory.useMutation({
    onSuccess: async () => { await invalidate(); setDeleteTarget(null); toast.success(l("已删除", "Deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => setDraft({ chapter: nextChapter, year: "", title: "", titleEn: "", description: "" });
  const openEdit = (c: (typeof chapters)[number]) =>
    setDraft({ id: c.id, chapter: c.chapter, year: c.year ? String(c.year) : "", title: c.title, titleEn: c.titleEn ?? "", description: c.description ?? "" });

  const submit = () => {
    if (!draft || !familyId) return;
    if (!draft.title.trim()) return toast.warning(t("common.enterTitle"));
    const year = draft.year.trim() ? Number(draft.year) : undefined;
    if (draft.year.trim() && (!Number.isInteger(year) || year! < 1900 || year! > 2100)) return toast.warning(l("年份格式不正确", "Invalid year"));
    const base = { chapter: draft.chapter, title: draft.title.trim(), titleEn: draft.titleEn.trim() || undefined, description: draft.description.trim() || undefined };
    if (draft.id) update.mutate({ id: draft.id, ...base, year: year ?? null, titleEn: base.titleEn ?? null, description: base.description ?? null });
    else create.mutate({ familyId, ...base, year });
  };

  const saving = create.isPending || update.isPending;
  const locale = language === "zh" ? "zh-CN" : "en-US";

  /* ----------------------------- editor ----------------------------- */
  if (draft) {
    return (
      <ScreenContainer className="bg-background p-0">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => setDraft(null)} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{draft.id ? t("stories.editStory") : t("stories.addNewChapter")}</Text>
            <View className="w-12" />
          </View>
          <View className="flex-1 px-6 py-4 gap-4">
            <View className="flex-row gap-3">
              <View className="gap-2" style={{ width: 96 }}>
                <Text className="text-sm font-semibold text-foreground">{l("章节", "Chapter")}</Text>
                <TextInput
                  value={String(draft.chapter)}
                  onChangeText={(v) => setDraft({ ...draft, chapter: Number(v.replace(/\D/g, "")) || 1 })}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground text-center"
                />
              </View>
              <View className="gap-2 flex-1">
                <Text className="text-sm font-semibold text-foreground">{l("年份（可选）", "Year (optional)")}</Text>
                <TextInput
                  placeholder="1975"
                  value={draft.year}
                  onChangeText={(v) => setDraft({ ...draft, year: v.replace(/\D/g, "").slice(0, 4) })}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground"
                />
              </View>
            </View>
            <View className="gap-2">
              <Text className="text-lg font-bold text-foreground">{t("title")}</Text>
              <TextInput
                placeholder={t("common.enterTitle")}
                value={draft.title}
                onChangeText={(v) => setDraft({ ...draft, title: v })}
                maxLength={120}
                placeholderTextColor={colors.muted}
                className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground"
              />
              <TextInput
                placeholder={l("英文标题（可选）", "English title (optional)")}
                value={draft.titleEn}
                onChangeText={(v) => setDraft({ ...draft, titleEn: v })}
                maxLength={120}
                placeholderTextColor={colors.muted}
                className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground"
              />
            </View>
            <View className="gap-2 flex-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">{t("stories.content")}</Text>
                <View className="flex-row items-center gap-1">
                  <Text className="text-xs text-muted">{t("voiceInput")}</Text>
                  <MicButton onTranscript={(text) => setDraft((d) => (d ? { ...d, description: d.description ? `${d.description}\n${text}` : text } : d))} />
                </View>
              </View>
              <TextInput
                placeholder={t("stories.enterStoryContent")}
                value={draft.description}
                onChangeText={(v) => setDraft({ ...draft, description: v })}
                multiline
                textAlignVertical="top"
                maxLength={20000}
                placeholderTextColor={colors.muted}
                className="bg-surface rounded-2xl px-4 py-3 text-foreground flex-1"
                style={{ minHeight: 240, lineHeight: 24 }}
              />
              <Text className="text-xs text-muted text-right">{draft.description.length}/20000</Text>
            </View>
            <View className="flex-row gap-3">
              <Pressable onPress={() => setDraft(null)} className="flex-1 bg-surface rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable onPress={submit} disabled={saving} className="flex-1 bg-primary rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80">
                {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{t("save")}</Text>}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  /* ------------------------------ list ------------------------------ */
  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={stories.isRefetching} onRefresh={() => stories.refetch()} tintColor={colors.primary} />}
      >
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{t("stories.loveStory")}</Text>
            {canCreate ? (
              <Pressable onPress={openCreate} accessibilityLabel={t("stories.addNewChapter")} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
                <MaterialIcons name="add" size={24} color={colors.primary} />
              </Pressable>
            ) : (
              <View className="w-12" />
            )}
          </View>

          <View className="flex-1 px-6 py-4 gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-bold text-foreground">{t("stories.ourStory")}</Text>
              <Text className="text-sm text-muted">{t("stories.recordEveryMomentOf")}</Text>
            </View>

            {!isAuthenticated ? (
              <Empty icon="lock-outline" text={t("messages.signInToSee")} />
            ) : stories.isLoading ? (
              <ActivityIndicator color={colors.primary} className="py-12" />
            ) : chapters.length === 0 ? (
              <View className="items-center gap-4 py-12">
                <MaterialIcons name="auto-stories" size={56} color={colors.muted} />
                <Text className="text-lg font-semibold text-foreground">{l("还没有故事章节", "No chapters yet")}</Text>
                <Text className="text-sm text-muted text-center">{l("从「初相识」开始，用文字或语音记录爸妈的爱情。", "Start with “How we met” — type or dictate your parents' story.")}</Text>
                {canCreate && (
                  <Pressable onPress={openCreate} className="bg-primary rounded-full px-6 py-3 min-h-[48px] items-center justify-center">
                    <Text className="font-semibold text-onPrimary">{t("stories.addNewChapter")}</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View>
                {chapters.map((c, idx) => {
                  const open = expanded === c.id;
                  const mine = c.createdBy === user?.id;
                  return (
                    <View key={c.id} className="flex-row gap-3" style={{ alignItems: "stretch" }}>
                      {/* 时间轴 */}
                      <View className="items-center" style={{ width: 28 }}>
                        <View className="w-7 h-7 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
                          <Text className="text-xs font-bold text-onPrimary">{c.chapter}</Text>
                        </View>
                        {idx < chapters.length - 1 && <View className="flex-1 w-0.5 my-1" style={{ backgroundColor: colors.border }} />}
                      </View>
                      {/* 卡片 */}
                      <Pressable
                        onPress={() => setExpanded(open ? null : c.id)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        className="flex-1 bg-surface rounded-2xl p-4 mb-4 gap-2 active:opacity-90"
                      >
                        <View className="flex-row items-start justify-between gap-2">
                          <View className="flex-1">
                            <Text className="text-lg font-bold text-foreground">{l(c.title, c.titleEn || c.title)}</Text>
                            <Text className="text-xs text-muted">
                              {c.year ? `${c.year} · ` : ""}{nameOf(c.createdBy)} · {new Date(c.createdAt).toLocaleDateString(locale)}
                            </Text>
                          </View>
                          <MaterialIcons name={open ? "expand-less" : "expand-more"} size={22} color={colors.muted} />
                        </View>
                        {c.description ? (
                          <Text className="text-sm text-foreground" numberOfLines={open ? undefined : 3} style={{ lineHeight: 22 }}>
                            {c.description}
                          </Text>
                        ) : null}
                        {c.voiceRecording ? (
                          <View className="flex-row items-center gap-1">
                            <MaterialIcons name="mic" size={14} color={colors.primary} />
                            <Text className="text-xs text-primary">{l("含语音记录", "Has voice recording")}</Text>
                          </View>
                        ) : null}
                        {open && (mine || isAdmin) && (
                          <View className="flex-row justify-end gap-1 pt-1 border-t border-border">
                            <Pressable onPress={() => openEdit(c)} className="flex-row items-center gap-1 px-3 min-h-[44px]">
                              <MaterialIcons name="edit" size={16} color={colors.primary} />
                              <Text className="text-sm font-semibold text-primary">{t("edit")}</Text>
                            </Pressable>
                            <Pressable onPress={() => setDeleteTarget(c.id)} className="flex-row items-center gap-1 px-3 min-h-[44px]">
                              <MaterialIcons name="delete-outline" size={16} color={colors.error} />
                              <Text className="text-sm font-semibold" style={{ color: colors.error }}>{t("deletePhoto")}</Text>
                            </Pressable>
                          </View>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            {canCreate && chapters.length > 0 && (
              <Pressable onPress={openCreate} className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 min-h-[48px] active:opacity-80">
                <MaterialIcons name="add" size={20} color={colors.onPrimary} />
                <Text className="text-onPrimary font-bold text-lg">{t("stories.addNewChapter")}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>

      <Modal visible={deleteTarget !== null} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-xl font-bold text-foreground">{l("删除这一章？", "Delete this chapter?")}</Text>
            <Text className="text-sm text-muted">{l("此操作不可恢复。", "This cannot be undone.")}</Text>
            <View className="flex-row gap-3">
              <Pressable onPress={() => setDeleteTarget(null)} className="flex-1 bg-surface rounded-full py-3 min-h-[48px] items-center justify-center">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                disabled={remove.isPending}
                onPress={() => deleteTarget !== null && remove.mutate({ id: deleteTarget })}
                className="flex-1 rounded-full py-3 min-h-[48px] items-center justify-center"
                style={{ backgroundColor: colors.error }}
              >
                {remove.isPending ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">{t("deletePhoto")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function Empty({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View className="items-center justify-center gap-2 py-16">
      <MaterialIcons name={icon} size={48} color={colors.muted} />
      <Text className="text-base font-semibold text-foreground text-center">{text}</Text>
    </View>
  );
}
