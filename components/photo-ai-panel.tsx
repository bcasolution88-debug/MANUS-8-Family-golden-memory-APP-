import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import { useToast } from "@/components/toast";
import { UserAvatar } from "@/components/user-avatar";
import { trpc } from "@/lib/trpc";

type Props = {
  mediaId: number;
  familyId: number;
  /** Current title — used to offer "use suggested title". */
  currentTitle?: string | null;
  /** Called when the user accepts the AI title / caption (parent persists via media.updateMedia). */
  onApplyText?: (patch: { title?: string; description?: string }) => void;
  canEdit?: boolean;
};

const MOOD_ICON: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  warm: "wb-sunny",
  joyful: "sentiment-very-satisfied",
  calm: "spa",
  nostalgic: "history",
  festive: "celebration",
  solemn: "church",
  playful: "toys",
};

/**
 * P8 — "AI 识别" section on the photo page.
 *
 *   ai.get      → cached analysis (caption / title / mood / tags / people)
 *   ai.analyze  → run (or re-run) the vision model; heuristic fallback when
 *                 the LLM isn't configured, so the button always does something
 *   ai.tagPerson→ link a detected person to a family member ("这是爷爷")
 *
 * Detected people are described, never identified: the model only sees the
 * photo and outputs "elderly woman in red"; a family member decides who it is.
 */
export function PhotoAIPanel({ mediaId, familyId, currentTitle, onApplyText, canEdit = true }: Props) {
  const colors = useColors();
  const { l } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [tagging, setTagging] = useState<string | null>(null);

  const analysis = trpc.ai.get.useQuery({ mediaId }, { staleTime: 5 * 60_000 });
  const members = trpc.family.getMembers.useQuery({ familyId }, { enabled: tagging !== null, staleTime: 60_000 });
  const analyze = trpc.ai.analyze.useMutation({
    onSuccess: async (res) => {
      utils.ai.get.setData({ mediaId }, res);
      await utils.ai.recommend.invalidate();
      toast.success(res.source === "llm" ? l("AI 识别完成", "Analysis complete") : l("已生成基础标签（未配置视觉模型）", "Basic tags generated (vision model not configured)"));
    },
    onError: (e) => toast.error(e.message),
  });
  const tagPerson = trpc.ai.tagPerson.useMutation({
    onSuccess: (res) => {
      utils.ai.get.setData({ mediaId }, res);
      utils.ai.peopleIndex.invalidate();
      setTagging(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const data = analysis.data;
  const memberById = new Map((members.data ?? []).map((m) => [m.userId, m]));

  const Header = (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        <MaterialIcons name="auto-awesome" size={20} color={colors.primary} />
        <Text className="text-lg font-bold text-foreground">{l("AI 识别", "AI insights")}</Text>
        {data?.model && <Text className="text-[10px] text-muted">{data.model === "heuristic" ? l("基础", "basic") : "vision"}</Text>}
      </View>
      <Pressable
        onPress={() => analyze.mutate({ mediaId, force: !!data, language: l("zh", "en") as "zh" | "en" })}
        disabled={analyze.isPending}
        accessibilityRole="button"
        className="flex-row items-center gap-1 rounded-full px-3 min-h-[40px]"
        style={{ backgroundColor: `${colors.primary}22` }}
      >
        {analyze.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name={data ? "refresh" : "auto-fix-high"} size={18} color={colors.primary} />}
        <Text className="text-sm font-semibold text-primary">{data ? l("重新分析", "Re-analyze") : l("一键分析", "Analyze")}</Text>
      </Pressable>
    </View>
  );

  if (analysis.isLoading) {
    return (
      <View className="gap-3">
        {Header}
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View className="gap-3">
        {Header}
        <Text className="text-xs text-muted">{l("识别照片中的场景、季节、人物，自动生成标题与标签，方便搜索和制作回忆视频。", "Detect scene, season and people; get a suggested title and tags for search and memory videos.")}</Text>
      </View>
    );
  }

  const unknownIdx = (id: string) => data.people.findIndex((p) => p.id === id) + 1;

  return (
    <View className="gap-3">
      {Header}

      {/* caption + mood */}
      {data.caption ? (
        <View className="bg-surface rounded-2xl p-3 gap-2">
          <View className="flex-row items-start gap-2">
            {data.mood && <MaterialIcons name={MOOD_ICON[data.mood] ?? "wb-sunny"} size={18} color={colors.primary} style={{ marginTop: 2 }} />}
            <Text className="text-sm text-foreground flex-1">{data.caption}</Text>
          </View>
          {canEdit && onApplyText && (
            <View className="flex-row gap-2 flex-wrap">
              {data.suggestedTitle && data.suggestedTitle !== currentTitle && (
                <Pressable onPress={() => onApplyText({ title: data.suggestedTitle! })} className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: colors.background }} accessibilityRole="button">
                  <Text className="text-xs font-semibold text-primary">{l(`用作标题：「${data.suggestedTitle}」`, `Use title: "${data.suggestedTitle}"`)}</Text>
                </Pressable>
              )}
              <Pressable onPress={() => onApplyText({ description: data.caption! })} className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: colors.background }} accessibilityRole="button">
                <Text className="text-xs font-semibold text-primary">{l("用作描述", "Use as description")}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {/* tags */}
      {data.tags.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {data.tags.map((tag) => (
            <View key={tag} className="rounded-full px-3 py-1.5 bg-surface">
              <Text className="text-xs text-foreground">#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* people */}
      {data.people.length > 0 && (
        <View className="gap-2">
          <Text className="text-sm font-semibold text-foreground">{l(`照片中的人（${data.people.length}）`, `People in this photo (${data.people.length})`)}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {data.people.map((p) => {
              const member = p.userId ? memberById.get(p.userId) : undefined;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => canEdit && setTagging(p.id)}
                  disabled={!canEdit}
                  accessibilityRole="button"
                  accessibilityLabel={l("标记这个人", "Tag this person")}
                  className="items-center gap-1 w-20 active:opacity-80"
                >
                  {p.userId ? (
                    <PersonAvatar userId={p.userId} familyId={familyId} size={48} />
                  ) : (
                    <View className="w-12 h-12 rounded-full items-center justify-center bg-surface border border-dashed" style={{ borderColor: colors.primary }}>
                      <MaterialIcons name="person-add" size={22} color={colors.primary} />
                    </View>
                  )}
                  <Text className="text-xs font-semibold text-foreground text-center" numberOfLines={1}>
                    {member?.user.name ?? (p.userId ? "…" : l(`人物 ${unknownIdx(p.id)}`, `Person ${unknownIdx(p.id)}`))}
                  </Text>
                  <Text className="text-[10px] text-muted text-center" numberOfLines={2}>{p.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* tag sheet */}
      <Modal visible={tagging !== null} transparent animationType="fade" onRequestClose={() => setTagging(null)}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setTagging(null)}>
          <Pressable className="bg-background rounded-t-3xl p-6 gap-3" onPress={() => undefined}>
            <Text className="text-xl font-bold text-foreground">{l("这是谁？", "Who is this?")}</Text>
            <Text className="text-xs text-muted">{tagging ? data.people.find((p) => p.id === tagging)?.label : ""}</Text>
            {members.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
                {(members.data ?? []).map((m) => {
                  const selected = data.people.find((p) => p.id === tagging)?.userId === m.userId;
                  return (
                    <Pressable
                      key={m.userId}
                      onPress={() => tagging && tagPerson.mutate({ mediaId, personId: tagging, userId: m.userId })}
                      disabled={tagPerson.isPending}
                      className="flex-row items-center gap-3 bg-surface rounded-2xl p-3 min-h-[56px] active:opacity-80"
                      style={selected ? { borderWidth: 2, borderColor: colors.primary } : undefined}
                      accessibilityRole="button"
                    >
                      <UserAvatar avatar={m.user.avatar} name={m.user.name} size={40} />
                      <View className="flex-1">
                        <Text className="font-semibold text-foreground">{m.user.name ?? m.user.email}</Text>
                        {m.user.relationship ? <Text className="text-xs text-muted">{m.user.relationship}</Text> : null}
                      </View>
                      {selected && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
                    </Pressable>
                  );
                })}
                {data.people.find((p) => p.id === tagging)?.userId && (
                  <Pressable
                    onPress={() => tagging && tagPerson.mutate({ mediaId, personId: tagging, userId: null })}
                    className="flex-row items-center gap-3 rounded-2xl p-3 min-h-[48px]"
                    accessibilityRole="button"
                  >
                    <MaterialIcons name="person-remove" size={22} color={colors.error} />
                    <Text className="font-semibold" style={{ color: colors.error }}>{l("取消标记", "Remove tag")}</Text>
                  </Pressable>
                )}
              </ScrollView>
            )}
            <Pressable onPress={() => setTagging(null)} className="bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
              <Text className="font-semibold text-foreground">{l("关闭", "Close")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Avatar for a linked member — resolves via getMembers so it needs no extra query per person. */
function PersonAvatar({ userId, familyId, size }: { userId: number; familyId: number; size: number }) {
  const members = trpc.family.getMembers.useQuery({ familyId }, { staleTime: 60_000 });
  const m = members.data?.find((x) => x.userId === userId);
  return <UserAvatar avatar={m?.user.avatar} name={m?.user.name} size={size} />;
}
