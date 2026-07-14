import { useCallback } from "react";
import { aiFeatures } from "@/lib/ai-features";

export function useAIFeatures() {
  const detectFaces = useCallback(async (videoUri: string) => {
    return aiFeatures.detectFaces(videoUri);
  }, []);

  const identifyFace = useCallback(async (faceEncoding: string, userId: string) => {
    return aiFeatures.identifyFace(faceEncoding, userId);
  }, []);

  const generateVideoSummary = useCallback(async (videoId: string, videoUri: string) => {
    return aiFeatures.generateVideoSummary(videoId, videoUri);
  }, []);

  const generateSmartTags = useCallback(
    async (mediaUri: string, mediaType: "photo" | "video") => {
      return aiFeatures.generateSmartTags(mediaUri, mediaType);
    },
    []
  );

  const getContentRecommendations = useCallback(
    async (
      mediaId: string,
      userPreferences: {
        likedTags: string[];
        viewHistory: string[];
        familyMembers: string[];
      }
    ) => {
      return aiFeatures.getContentRecommendations(mediaId, userPreferences);
    },
    []
  );

  const autoClassifyMedia = useCallback(
    async (mediaUri: string, mediaType: "photo" | "video") => {
      return aiFeatures.autoClassifyMedia(mediaUri, mediaType);
    },
    []
  );

  const extractKeyframes = useCallback(async (videoUri: string, count?: number) => {
    return aiFeatures.extractKeyframes(videoUri, count);
  }, []);

  const detectEmotions = useCallback(async (imageUri: string) => {
    return aiFeatures.detectEmotions(imageUri);
  }, []);

  const clearCache = useCallback(() => {
    aiFeatures.clearCache();
  }, []);

  const getCacheStats = useCallback(() => {
    return aiFeatures.getCacheStats();
  }, []);

  return {
    detectFaces,
    identifyFace,
    generateVideoSummary,
    generateSmartTags,
    getContentRecommendations,
    autoClassifyMedia,
    extractKeyframes,
    detectEmotions,
    clearCache,
    getCacheStats,
  };
}
