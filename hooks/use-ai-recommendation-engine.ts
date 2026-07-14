import { useCallback, useState } from "react";
import {
  aiRecommendationEngine,
  TimeSlot,
  AnniversaryRecommendation,
  ContentRecommendation,
} from "@/lib/ai-recommendation-engine";

export function useAIRecommendationEngine() {
  const [stats, setStats] = useState(aiRecommendationEngine.getStats());

  const analyzeBestShareTime = useCallback((familyId: string): TimeSlot[] => {
    const slots = aiRecommendationEngine.analyzeBestShareTime(familyId);
    setStats(aiRecommendationEngine.getStats());
    return slots;
  }, []);

  const recommendAnniversaries = useCallback(
    (familyId: string): AnniversaryRecommendation[] => {
      const recommendations = aiRecommendationEngine.recommendAnniversaries(familyId);
      setStats(aiRecommendationEngine.getStats());
      return recommendations;
    },
    []
  );

  const recommendContent = useCallback(
    (familyId: string, limit?: number): ContentRecommendation[] => {
      const recommendations = aiRecommendationEngine.recommendContent(familyId, limit);
      setStats(aiRecommendationEngine.getStats());
      return recommendations;
    },
    []
  );

  const analyzeUserBehavior = useCallback((userId: string, activities: any[]) => {
    const pattern = aiRecommendationEngine.analyzeUserBehavior(userId, activities);
    setStats(aiRecommendationEngine.getStats());
    return pattern;
  }, []);

  return {
    stats,
    analyzeBestShareTime,
    recommendAnniversaries,
    recommendContent,
    analyzeUserBehavior,
  };
}
