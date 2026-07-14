import { useCallback, useState } from "react";
import { aiFaceRecognition, PhotoAnalysisResult, SmartTag, PersonProfile } from "@/lib/ai-face-recognition";

export function useAIFaceRecognition() {
  const [analyzing, setAnalyzing] = useState(false);
  const [stats, setStats] = useState(aiFaceRecognition.getStats());

  const analyzePhoto = useCallback(async (photoId: string, imageData: ArrayBuffer) => {
    setAnalyzing(true);
    try {
      const result = await aiFaceRecognition.analyzePhoto(photoId, imageData);
      setStats(aiFaceRecognition.getStats());
      return result;
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const identifyPerson = useCallback(
    async (faceId: string, faceEmbedding: number[]) => {
      return aiFaceRecognition.identifyPerson(faceId, faceEmbedding);
    },
    []
  );

  const createPersonProfile = useCallback((name: string, faceEmbedding: number[]) => {
    const profile = aiFaceRecognition.createPersonProfile(name, faceEmbedding);
    setStats(aiFaceRecognition.getStats());
    return profile;
  }, []);

  const applyRecommendedTags = useCallback((photoId: string): SmartTag[] => {
    return aiFaceRecognition.applyRecommendedTags(photoId);
  }, []);

  const getAnalysisResult = useCallback(
    (photoId: string): PhotoAnalysisResult | undefined => {
      return aiFaceRecognition.getAnalysisResult(photoId);
    },
    []
  );

  const getAllPersonProfiles = useCallback((): PersonProfile[] => {
    return aiFaceRecognition.getAllPersonProfiles();
  }, []);

  return {
    analyzing,
    stats,
    analyzePhoto,
    identifyPerson,
    createPersonProfile,
    applyRecommendedTags,
    getAnalysisResult,
    getAllPersonProfiles,
  };
}
