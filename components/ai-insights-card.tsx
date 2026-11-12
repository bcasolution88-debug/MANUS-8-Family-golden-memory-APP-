import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import { trpc } from "@/lib/trpc";
import { SignedImage } from "@/components/signed-image";

/**
 * P8 — Home "智能推荐" card backed by `ai.recommend` (real activity, no LLM):
 *   • 那年今日 (same calendar week in earlier years)
 *   • 等你命名 (most-loved untitled photos)
 *   • 最佳分享时段 (hour with most likes + comments, last 90 days)
 *   • 下一个纪念日
 *   • N 张照片还没有 AI 标签 → 进相册逐张分析
 * Renders nothing when there is no signal yet, so Home stays clean for new families.
 */
export function AIInsightsCard({ familyId }: { familyId: number }) {
  const router = useRouter();
  const colors = useColors();
  const { l } = useLanguage();
  const rec = trpc.ai.recommend.useQuery({ familyId }, { staleTime: 5 * 60_000 });

  if (rec.isLoading) {
    return (
      <View className="bg-surface rounded-3xl p-4 items-center justify-center min-h-[72px]">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  const data = rec.data;
  if (!data) return null;
  const hasSignal = data.onThisDay.length > 0 || data.untitledGems.length > 0 || data.bestShareHour || data.nextAnniversary || data.unanalyzed > 0;
  if (!hasSignal) return null;

  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;

  return (
    <View className="bg-surface rounded-3xl p-4 gap-4">
      <View className="flex-row items-center gap-2">
        <MaterialIcons name="auto-awesome" size={20} color={colors.primary} />
        <Text className="text-lg font-bold text-foreground flex-1">{l("智能推荐", "Smart picks")}</Text>
        <Text className="text-[10px] text-muted">{l("基于家庭真实活动", "From real family activity")}</Text>
      </View>

      {/* 那年今日 */}
      {data.onThisDay.length > 0 && (
        <View className="gap-2">
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="history" size={16} color={colors.muted} />
            <Text className="text-sm font-semibold text-foreground">{l("那年今日", "On this day")}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {data.onThisDay.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => router.push({ pathname: m.type === "video" ? "/video/[id]" : "/photo/[id]", params: { id: String(m.id) } })}
                className="w-28 gap-1 active:opacity-80"
                accessibilityRole="button"
              >
                <View className="w-28 h-28 rounded-2xl overflow-hidden">
                  <SignedImage mediaId={m.id} style={{ width: "100%", height: "100%" }} />
                  <View className="absolute bottom-1 left-1 rounded-full px-2 py-0.5 bg-black/60">
                    <Text className="text-[10px] font-bold text-white">{l(`${m.yearsAgo} 年前`, `${m.yearsAgo}y ago`)}</Text>
                  </View>
                </View>
                <Text className="text-xs text-foreground" numberOfLines={1}>{m.title ?? new Date(m.createdAt).toLocaleDateString()}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* 等你命名 */}
      {data.untitledGems.length > 0 && (
        <View className="gap-2">
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="edit-note" size={16} color={colors.muted} />
            <Text className="text-sm font-semibold text-foreground">{l("大家都喜欢，还没起名字", "Loved, but untitled")}</Text>
          </View>
          <View className="flex-row gap-2">
            {data.untitledGems.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => router.push({ pathname: "/photo/[id]", params: { id: String(m.id) } })}
                className="flex-1 aspect-square rounded-2xl overflow-hidden active:opacity-80"
                accessibilityRole="button"
                accessibilityLabel={l("为这张照片命名", "Name this photo")}
              >
                <SignedImage mediaId={m.id} style={{ width: "100%", height: "100%" }} />
                <View className="absolute bottom-1 right-1 flex-row items-center gap-0.5 rounded-full px-1.5 py-0.5 bg-black/60">
                  <MaterialIcons name="favorite" size={10} color="white" />
                  <Text className="text-[10px] text-white">{m.likeCount}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* 小贴士行 */}
      <View className="gap-2">
        {data.bestShareHour && (
          <View className="flex-row items-center gap-3 bg-background rounded-2xl p-3">
            <MaterialIcons name="schedule" size={20} color={colors.primary} />
            <Text className="text-sm text-foreground flex-1">
              {l(
                `家人最活跃的时段是 ${hourLabel(data.bestShareHour.hour)}（近 90 天 ${Math.round(data.bestShareHour.share * 100)}% 的互动）`,
                `Your family is most active around ${hourLabel(data.bestShareHour.hour)} (${Math.round(data.bestShareHour.share * 100)}% of recent reactions)`,
              )}
            </Text>
          </View>
        )}
        {data.nextAnniversary && data.nextAnniversary.daysUntil <= 60 && (
          <Pressable onPress={() => router.push("/anniversary" as any)} className="flex-row items-center gap-3 bg-background rounded-2xl p-3 active:opacity-80" accessibilityRole="button">
            <MaterialIcons name="cake" size={20} color={colors.primary} />
            <Text className="text-sm text-foreground flex-1">
              {l(
                `${data.nextAnniversary.couple} 的纪念日还有 ${data.nextAnniversary.daysUntil} 天，要不要做一支回忆视频？`,
                `${data.nextAnniversary.couple}'s anniversary is in ${data.nextAnniversary.daysUntil} days — make a memory video?`,
              )}
            </Text>
            <MaterialIcons name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}
        {data.unanalyzed > 0 && (
          <Pressable onPress={() => router.push("/album" as any)} className="flex-row items-center gap-3 bg-background rounded-2xl p-3 active:opacity-80" accessibilityRole="button">
            <MaterialIcons name="label" size={20} color={colors.primary} />
            <Text className="text-sm text-foreground flex-1">
              {l(`${data.unanalyzed} 张照片还没有 AI 标签，打开照片即可一键分析`, `${data.unanalyzed} photos have no AI tags yet — open one and tap Analyze`)}
            </Text>
            <MaterialIcons name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
