import { ScrollView, Text, View, Pressable, TextInput, Modal, ActivityIndicator, RefreshControl, Platform } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useFamilyId } from "@/hooks/use-family-id";
import { useBackHandler } from "@/hooks/use-back-handler";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { GradientCard } from "@/components/gradient-card";
import { SignedImage } from "@/components/signed-image";
import { trpc } from "@/lib/trpc";

type AnniversaryType = "silver" | "golden" | "diamond" | "platinum";

const MILESTONES: { type: AnniversaryType; years: number; zh: string; en: string }[] = [
  { type: "silver", years: 25, zh: "银婚", en: "Silver" },
  { type: "golden", years: 50, zh: "金婚", en: "Golden" },
  { type: "diamond", years: 60, zh: "钻石婚", en: "Diamond" },
  { type: "platinum", years: 70, zh: "白金婚", en: "Platinum" },
];
const milestone = (type: AnniversaryType) => MILESTONES.find((m) => m.type === type)!;

/** Next occurrence (yearly) of `date` from today, plus derived numbers. */
function nextOccurrence(date: Date | string) {
  const base = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(today.getFullYear(), base.getMonth(), base.getDate());
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  const yearsAtNext = next.getFullYear() - base.getFullYear();
  return { base, next, yearsAtNext };
}

const parseDate = (v: string): Date | null => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Anniversary (P6 — real data).
 * family.getAnniversaries → pick the nearest upcoming as the hero (live
 * countdown), list the rest below; create / edit / delete via a sheet
 * (editor+ to create, creator|admin to edit). Photo strip = media.recent.
 */
export default function AnniversaryScreen() {
  const router = useRouter();
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { familyId, isAuthenticated } = useFamilyId();

  const list = trpc.family.getAnniversaries.useQuery({ familyId: familyId ?? 0 }, { enabled: isAuthenticated && !!familyId });
  const members = trpc.family.getMembers.useQuery({ familyId: familyId ?? 0 }, { enabled: isAuthenticated && !!familyId, staleTime: 60_000 });
  const recent = trpc.media.recent.useQuery({ familyId: familyId ?? 0, take: 6 }, { enabled: isAuthenticated && !!familyId });
  const myRole = members.data?.find((m) => m.userId === user?.id)?.role;
  const canCreate = myRole && myRole !== "viewer";
  const isAdmin = myRole === "owner" || myRole === "admin";

  const sorted = useMemo(() => {
    return (list.data ?? [])
      .map((a) => ({ ...a, ...nextOccurrence(a.date) }))
      .sort((x, y) => x.next.getTime() - y.next.getTime());
  }, [list.data]);
  const hero = sorted[0] ?? null;

  /* ---------------------------- countdown ---------------------------- */
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  useEffect(() => {
    if (!hero) return;
    const tick = () => {
      const diff = Math.max(0, hero.next.getTime() - Date.now());
      setTimeLeft({
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff / 3_600_000) % 24),
        minutes: Math.floor((diff / 60_000) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hero]);

  /* ------------------------------ form ------------------------------- */
  const [sheet, setSheet] = useState<null | { id?: number; type: AnniversaryType; date: string; couple: string; description: string }>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  useBackHandler(!!sheet || deleteTarget !== null, () => {
    setSheet(null);
    setDeleteTarget(null);
    return true;
  });

  const invalidate = () => Promise.all([utils.family.getAnniversaries.invalidate(), utils.timeline.invalidate()]);
  const create = trpc.family.createAnniversary.useMutation({
    onSuccess: async () => { await invalidate(); setSheet(null); toast.success(l("纪念日已添加", "Anniversary added")); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.family.updateAnniversary.useMutation({
    onSuccess: async () => { await invalidate(); setSheet(null); toast.success(l("已保存", "Saved")); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.family.deleteAnniversary.useMutation({
    onSuccess: async () => { await invalidate(); setDeleteTarget(null); toast.success(l("已删除", "Deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => setSheet({ type: "golden", date: "", couple: "", description: "" });
  const openEdit = (a: (typeof sorted)[number]) =>
    setSheet({ id: a.id, type: a.type, date: a.base.toISOString().slice(0, 10), couple: a.couple, description: a.description ?? "" });
  const submit = () => {
    if (!sheet || !familyId) return;
    const date = parseDate(sheet.date);
    if (!date) return toast.warning(l("日期格式应为 YYYY-MM-DD", "Date must be YYYY-MM-DD"));
    if (!sheet.couple.trim()) return toast.warning(l("请填写主角姓名", "Please enter the couple's names"));
    const payload = { type: sheet.type, date, couple: sheet.couple.trim(), description: sheet.description.trim() || undefined };
    if (sheet.id) update.mutate({ id: sheet.id, ...payload, description: payload.description ?? null });
    else create.mutate({ familyId, ...payload });
  };

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const fmt = (d: Date) => d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => invalidate()} tintColor={colors.primary} />}
      >
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{t("goldenAnniversary")}</Text>
            {canCreate ? (
              <Pressable onPress={openCreate} accessibilityLabel={l("添加纪念日", "Add anniversary")} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
                <MaterialIcons name="add" size={24} color={colors.primary} />
              </Pressable>
            ) : (
              <View className="w-12" />
            )}
          </View>

          <View className="flex-1 px-6 py-4 gap-6">
            {!isAuthenticated ? (
              <Empty icon="lock-outline" text={t("messages.signInToSee")} />
            ) : list.isLoading ? (
              <ActivityIndicator color={colors.primary} className="py-12" />
            ) : !hero ? (
              <View className="items-center gap-4 py-12">
                <MaterialIcons name="cake" size={56} color={colors.muted} />
                <Text className="text-lg font-semibold text-foreground text-center">{l("还没有纪念日", "No anniversaries yet")}</Text>
                <Text className="text-sm text-muted text-center">{l("添加爸妈的结婚日期，我们会帮您倒计时每一个重要的里程碑。", "Add your parents' wedding date and we'll count down every milestone.")}</Text>
                {canCreate && (
                  <Pressable onPress={openCreate} className="bg-primary rounded-full px-6 py-3 min-h-[48px] items-center justify-center">
                    <Text className="font-semibold text-onPrimary">{l("添加纪念日", "Add anniversary")}</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                {/* 主卡片 + 倒计时 */}
                <GradientCard variant="gold" className="rounded-3xl p-6 gap-5 items-center">
                  <Text className="text-sm font-semibold text-onPrimary opacity-80">
                    🏆 {l(milestone(hero.type).zh, milestone(hero.type).en)} · {hero.yearsAtNext} {l("周年", "years")}
                  </Text>
                  <Text className="text-3xl font-bold text-onPrimary text-center tracking-widest">{hero.couple}</Text>
                  <View className="flex-row gap-3">
                    {[
                      { value: timeLeft.days, label: t("days") },
                      { value: timeLeft.hours, label: t("hours") },
                      { value: timeLeft.minutes, label: t("minutes") },
                      { value: timeLeft.seconds, label: t("seconds") },
                    ].map((u) => (
                      <View key={u.label} className="items-center bg-white/25 rounded-2xl px-3 py-2 min-w-[64px]">
                        <Text className="text-2xl font-bold text-onPrimary">{String(u.value).padStart(2, "0")}</Text>
                        <Text className="text-xs text-onPrimary opacity-80">{u.label}</Text>
                      </View>
                    ))}
                  </View>
                  <Text className="text-xs text-onPrimary opacity-80">
                    {fmt(hero.next)} · {l("结婚于", "Married")} {fmt(hero.base)}
                  </Text>
                  {hero.description ? <Text className="text-sm text-onPrimary text-center">{hero.description}</Text> : null}
                  {(isAdmin || hero.createdBy === user?.id) && (
                    <View className="flex-row gap-2">
                      <Pressable onPress={() => openEdit(hero)} className="flex-row items-center gap-1 bg-white/25 rounded-full px-4 py-2 min-h-[44px]">
                        <MaterialIcons name="edit" size={16} color={colors.onPrimary} />
                        <Text className="text-sm font-semibold text-onPrimary">{t("edit")}</Text>
                      </Pressable>
                      <Pressable onPress={() => setDeleteTarget(hero.id)} className="flex-row items-center gap-1 bg-white/25 rounded-full px-4 py-2 min-h-[44px]">
                        <MaterialIcons name="delete-outline" size={16} color={colors.onPrimary} />
                        <Text className="text-sm font-semibold text-onPrimary">{t("deletePhoto")}</Text>
                      </Pressable>
                    </View>
                  )}
                </GradientCard>

                {/* 里程碑 */}
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">{l("里程碑", "Milestones")}</Text>
                  <View className="flex-row gap-2">
                    {MILESTONES.map((m) => {
                      const reached = hero.yearsAtNext >= m.years;
                      const current = hero.type === m.type;
                      return (
                        <View key={m.type} className={`flex-1 items-center gap-1 rounded-2xl p-3 ${current ? "bg-primary" : reached ? "bg-primary/20" : "bg-surface"}`}>
                          <Text className={`text-lg font-bold ${current ? "text-onPrimary" : "text-foreground"}`}>{m.years}</Text>
                          <Text className={`text-xs ${current ? "text-onPrimary" : "text-muted"}`}>{l(m.zh, m.en)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* 快捷操作 */}
                <View className="flex-row gap-3">
                  <Pressable onPress={() => router.push("/studio" as any)} className="flex-1 bg-info rounded-2xl py-4 min-h-[72px] items-center justify-center gap-1 active:opacity-80">
                    <MaterialIcons name="movie" size={24} color="white" />
                    <Text className="text-sm font-semibold text-white">{t("makeVideoBtn")}</Text>
                  </Pressable>
                  <Pressable onPress={() => router.push("/stories" as any)} className="flex-1 bg-primary rounded-2xl py-4 min-h-[72px] items-center justify-center gap-1 active:opacity-80">
                    <MaterialIcons name="auto-stories" size={24} color={colors.onPrimary} />
                    <Text className="text-sm font-semibold text-onPrimary">{t("anniversary.writeStory")}</Text>
                  </Pressable>
                </View>

                {/* 相册精选 */}
                <View className="gap-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-lg font-bold text-foreground">{t("photoGallery")}</Text>
                    <Pressable onPress={() => router.push("/album" as any)} className="px-2 min-h-[44px] justify-center">
                      <Text className="text-sm font-semibold text-primary">{t("viewAll")}</Text>
                    </Pressable>
                  </View>
                  {(recent.data?.length ?? 0) === 0 ? (
                    <Pressable onPress={() => router.push("/upload" as any)} className="bg-surface rounded-2xl p-6 items-center gap-2">
                      <MaterialIcons name="add-photo-alternate" size={28} color={colors.primary} />
                      <Text className="text-sm text-muted">{l("上传第一张纪念照片", "Upload the first anniversary photo")}</Text>
                    </Pressable>
                  ) : (
                    <View className="flex-row flex-wrap gap-2">
                      {recent.data!.slice(0, 6).map((m) => (
                        <Pressable
                          key={m.id}
                          onPress={() => router.push((m.type === "video" ? `/video/${m.id}` : `/photo/${m.id}`) as any)}
                          className="active:opacity-80"
                          style={{ width: "31%", aspectRatio: 1 }}
                        >
                          <SignedImage mediaId={m.id} style={{ width: "100%", height: "100%", borderRadius: 12 }} />
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>

                {/* 其他纪念日 */}
                {sorted.length > 1 && (
                  <View className="gap-3">
                    <Text className="text-lg font-bold text-foreground">{t("viewAllAnniversaries")}</Text>
                    {sorted.slice(1).map((a) => (
                      <View key={a.id} className="flex-row items-center justify-between bg-surface rounded-2xl p-4 min-h-[64px]">
                        <View className="flex-1">
                          <Text className="font-semibold text-foreground">{a.couple}</Text>
                          <Text className="text-xs text-muted">
                            {l(milestone(a.type).zh, milestone(a.type).en)} · {a.yearsAtNext} {l("周年", "y")} · {fmt(a.next)}
                          </Text>
                        </View>
                        {(isAdmin || a.createdBy === user?.id) && (
                          <View className="flex-row">
                            <Pressable onPress={() => openEdit(a)} className="p-2 min-w-[44px] min-h-[44px] items-center justify-center">
                              <MaterialIcons name="edit" size={18} color={colors.primary} />
                            </Pressable>
                            <Pressable onPress={() => setDeleteTarget(a.id)} className="p-2 min-w-[44px] min-h-[44px] items-center justify-center">
                              <MaterialIcons name="delete-outline" size={18} color={colors.error} />
                            </Pressable>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {/* 新建 / 编辑 */}
      <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-background rounded-t-3xl p-6 gap-4">
            <Text className="text-xl font-bold text-foreground">{sheet?.id ? t("edit") : l("添加纪念日", "Add anniversary")}</Text>
            <View className="flex-row gap-2">
              {MILESTONES.map((m) => (
                <Pressable
                  key={m.type}
                  onPress={() => sheet && setSheet({ ...sheet, type: m.type })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sheet?.type === m.type }}
                  className={`flex-1 py-2 min-h-[44px] items-center justify-center rounded-full ${sheet?.type === m.type ? "bg-primary" : "bg-surface"}`}
                >
                  <Text className={`text-xs font-semibold ${sheet?.type === m.type ? "text-onPrimary" : "text-foreground"}`}>{l(m.zh, m.en)}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              placeholder={l("主角，如：陈建国 & 李秀英", "Couple, e.g. Jianguo & Xiuying")}
              value={sheet?.couple ?? ""}
              onChangeText={(v) => sheet && setSheet({ ...sheet, couple: v })}
              maxLength={100}
              placeholderTextColor={colors.muted}
              className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground"
            />
            <TextInput
              placeholder={l("结婚日期 YYYY-MM-DD", "Wedding date YYYY-MM-DD")}
              value={sheet?.date ?? ""}
              onChangeText={(v) => sheet && setSheet({ ...sheet, date: v })}
              keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
              maxLength={10}
              placeholderTextColor={colors.muted}
              className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground font-mono"
            />
            <TextInput
              placeholder={t("common.enterDescriptionOptional")}
              value={sheet?.description ?? ""}
              onChangeText={(v) => sheet && setSheet({ ...sheet, description: v })}
              multiline
              maxLength={500}
              placeholderTextColor={colors.muted}
              className="bg-surface rounded-2xl px-4 py-3 text-foreground h-20"
              textAlignVertical="top"
            />
            <View className="flex-row gap-3">
              <Pressable onPress={() => setSheet(null)} className="flex-1 bg-surface rounded-full py-3 min-h-[48px] items-center justify-center">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable onPress={submit} disabled={create.isPending || update.isPending} className="flex-1 bg-primary rounded-full py-3 min-h-[48px] items-center justify-center">
                {create.isPending || update.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{t("save")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 删除确认 */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-xl font-bold text-foreground">{l("删除纪念日？", "Delete anniversary?")}</Text>
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
