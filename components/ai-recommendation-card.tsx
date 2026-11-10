import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import { useAIRecommendationEngine } from "@/hooks/use-ai-recommendation-engine";

export interface AIRecommendationCardProps {
  familyId: string;
  onViewAnniversaries?: () => void;
  onViewRecommendedContent?: () => void;
}

export function AIRecommendationCard({
  familyId,
  onViewAnniversaries,
  onViewRecommendedContent,
}: AIRecommendationCardProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const { analyzeBestShareTime, recommendAnniversaries, recommendContent } =
    useAIRecommendationEngine();

  const bestTimes = analyzeBestShareTime(familyId);
  const anniversaries = recommendAnniversaries(familyId);
  const recommendations = recommendContent(familyId, 3);

  const nextAnniversary = anniversaries.length > 0 ? anniversaries[0] : null;
  const bestTime = bestTimes.length > 0 ? bestTimes[0] : null;

  const formatDaysUntil = (days: number): string => {
    if (days === 0) return t("today") || "今天";
    if (days === 1) return t("tomorrow") || "明天";
    return `${days} ${t("daysLater") || "天后"}`;
  };

  const getAnniversaryEmoji = (type: string): string => {
    const emojiMap: Record<string, string> = {
      golden: "👑",
      silver: "💎",
      diamond: "💍",
      birthday: "🎂",
      wedding: "💒",
    };
    return emojiMap[type] || "📅";
  };

  return (
    <View className="gap-4">
      {/* 最佳分享时间卡片 */}
      {bestTime && (
        <View className="bg-surface rounded-lg p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-bold text-foreground">
              ⏰ {t("bestShareTime") || "最佳分享时间"}
            </Text>
            <Text className="text-xs bg-primary text-background px-2 py-1 rounded">
              {t("recommended") || "推荐"} {(bestTime.engagementScore * 100).toFixed(0)}%
            </Text>
          </View>

          <View className="bg-background rounded-lg p-3 gap-2">
            <Text className="text-foreground font-semibold">
              {["周日", "周一", "周二", "周三", "周四", "周五", "周六"][bestTime.dayOfWeek]}{" "}
              {bestTime.hour}:00
            </Text>
            <Text className="text-sm text-muted">{bestTime.recommendedContent}</Text>
          </View>

          <Pressable className="bg-primary rounded-lg py-2">
            <Text className="text-background text-center font-semibold text-sm">
              {t("scheduleShare") || "安排分享"} →
            </Text>
          </Pressable>
        </View>
      )}

      {/* 热门纪念日卡片 */}
      {nextAnniversary && (
        <View className="bg-surface rounded-lg p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-bold text-foreground">
              {getAnniversaryEmoji(nextAnniversary.type)} {t("upcomingAnniversary") || "即将到来的纪念日"}
            </Text>
            <Text className="text-xs bg-error text-background px-2 py-1 rounded">
              {formatDaysUntil(nextAnniversary.daysUntil)}
            </Text>
          </View>

          <View className="bg-background rounded-lg p-3 gap-2">
            <Text className="text-foreground font-semibold">
              {nextAnniversary.type === "golden"
                ? "金婚纪念日 / Golden Anniversary"
                : nextAnniversary.type === "silver"
                  ? "银婚纪念日 / Silver Anniversary"
                  : nextAnniversary.type === "birthday"
                    ? "生日 / Birthday"
                    : "纪念日 / Anniversary"}
            </Text>
            <Text className="text-xs text-muted">
              {t("urgency") || "紧急度"}: {(nextAnniversary.urgencyScore * 100).toFixed(0)}%
            </Text>
          </View>

          {/* 建议的操作 */}
          {nextAnniversary.suggestedActions.length > 0 && (
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {t("suggestedActions") || "建议操作"}:
              </Text>
              {nextAnniversary.suggestedActions.slice(0, 2).map((action, idx) => (
                <Pressable key={idx} className="bg-background rounded-lg px-3 py-2">
                  <Text className="text-sm text-foreground">✓ {action}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            className="bg-primary rounded-lg py-2"
            onPress={onViewAnniversaries}
          >
            <Text className="text-background text-center font-semibold text-sm">
              {t("viewAllAnniversaries") || "查看所有纪念日"} →
            </Text>
          </Pressable>
        </View>
      )}

      {/* 推荐内容卡片 */}
      {recommendations.length > 0 && (
        <View className="bg-surface rounded-lg p-4 gap-3">
          <Text className="text-lg font-bold text-foreground">
            ⭐ {t("recommendedContent") || "推荐内容"}
          </Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
            {recommendations.map((rec, idx) => (
              <View key={idx} className="bg-background rounded-lg p-3 w-48 gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-foreground">
                    {t("score") || "评分"}
                  </Text>
                  <Text className="text-xs bg-primary text-background px-2 py-1 rounded">
                    {(rec.score * 100).toFixed(0)}%
                  </Text>
                </View>
                <Text className="text-xs text-muted">{rec.reason}</Text>
                {rec.suggestedCaption && (
                  <Text className="text-xs text-foreground italic">
                    "{rec.suggestedCaption}"
                  </Text>
                )}
                {rec.bestShareTime && (
                  <Text className="text-xs text-muted">
                    {t("bestTime") || "最佳时间"}: {rec.bestShareTime.hour}:00
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>

          <Pressable
            className="bg-primary rounded-lg py-2"
            onPress={onViewRecommendedContent}
          >
            <Text className="text-background text-center font-semibold text-sm">
              {t("viewAllRecommendations") || "查看所有推荐"} →
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
