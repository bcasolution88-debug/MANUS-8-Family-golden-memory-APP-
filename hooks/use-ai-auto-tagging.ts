import { useCallback, useState } from "react";
import { aiAutoTagging, AutoTaggingSuggestion, TagApplicationResult } from "@/lib/ai-auto-tagging";

export function useAIAutoTagging() {
  const [suggestions, setSuggestions] = useState<Map<string, AutoTaggingSuggestion>>(new Map());
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyzeMedia = useCallback(
    async (mediaId: string, mediaUri: string, mediaType: "photo" | "video") => {
      setIsAnalyzing(true);
      try {
        const suggestion = await aiAutoTagging.analyzeMedia(mediaId, mediaUri, mediaType);
        setSuggestions(prev => new Map(prev).set(mediaId, suggestion));
        return suggestion;
      } finally {
        setIsAnalyzing(false);
      }
    },
    []
  );

  const getSuggestion = useCallback((mediaId: string) => {
    return aiAutoTagging.getSuggestion(mediaId);
  }, []);

  const applyAllSuggestions = useCallback((mediaId: string) => {
    return aiAutoTagging.applyAllSuggestions(mediaId);
  }, []);

  const applyPartialSuggestions = useCallback(
    (mediaId: string, selectedTags: string[], selectedPeople: string[]) => {
      return aiAutoTagging.applyPartialSuggestions(mediaId, selectedTags, selectedPeople);
    },
    []
  );

  const rejectSuggestion = useCallback((mediaId: string) => {
    aiAutoTagging.rejectSuggestion(mediaId);
    setSuggestions(prev => {
      const newMap = new Map(prev);
      newMap.delete(mediaId);
      return newMap;
    });
  }, []);

  const linkPersonIdentity = useCallback((faceEncoding: string, personName: string) => {
    aiAutoTagging.linkPersonIdentity(faceEncoding, personName);
  }, []);

  const getApplicationResult = useCallback((mediaId: string) => {
    return aiAutoTagging.getApplicationResult(mediaId);
  }, []);

  const getFrequentTags = useCallback((limit?: number) => {
    return aiAutoTagging.getFrequentTags(limit);
  }, []);

  const getAllSuggestions = useCallback(() => {
    return aiAutoTagging.getAllSuggestions();
  }, []);

  const getApplicationStats = useCallback(() => {
    return aiAutoTagging.getApplicationStats();
  }, []);

  const clearCache = useCallback(() => {
    aiAutoTagging.clearCache();
    setSuggestions(new Map());
  }, []);

  return {
    analyzeMedia,
    getSuggestion,
    applyAllSuggestions,
    applyPartialSuggestions,
    rejectSuggestion,
    linkPersonIdentity,
    getApplicationResult,
    getFrequentTags,
    getAllSuggestions,
    getApplicationStats,
    clearCache,
    isAnalyzing,
    suggestions,
  };
}
