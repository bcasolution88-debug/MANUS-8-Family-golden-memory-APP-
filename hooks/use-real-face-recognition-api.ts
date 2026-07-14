import { useCallback, useState } from "react";
import { realFaceRecognitionAPI, APIConfig, FaceDetectionResult } from "@/lib/real-face-recognition-api";

export function useRealFaceRecognitionAPI() {
  const [detecting, setDetecting] = useState(false);
  const [stats, setStats] = useState(realFaceRecognitionAPI.getStats());

  const initializeAPI = useCallback((config: APIConfig) => {
    realFaceRecognitionAPI.initializeAPI(config);
    setStats(realFaceRecognitionAPI.getStats());
  }, []);

  const detectFaces = useCallback(
    async (imageId: string, imageData: ArrayBuffer): Promise<FaceDetectionResult[]> => {
      setDetecting(true);
      try {
        const faces = await realFaceRecognitionAPI.detectFaces(imageId, imageData);
        setStats(realFaceRecognitionAPI.getStats());
        return faces;
      } finally {
        setDetecting(false);
      }
    },
    []
  );

  const detectLabels = useCallback(
    async (imageId: string, imageData: ArrayBuffer) => {
      setDetecting(true);
      try {
        const labels = await realFaceRecognitionAPI.detectLabels(imageId, imageData);
        setStats(realFaceRecognitionAPI.getStats());
        return labels;
      } finally {
        setDetecting(false);
      }
    },
    []
  );

  const recognizeText = useCallback(
    async (imageId: string, imageData: ArrayBuffer) => {
      setDetecting(true);
      try {
        const texts = await realFaceRecognitionAPI.recognizeText(imageId, imageData);
        setStats(realFaceRecognitionAPI.getStats());
        return texts;
      } finally {
        setDetecting(false);
      }
    },
    []
  );

  const clearCache = useCallback(() => {
    realFaceRecognitionAPI.clearCache();
    setStats(realFaceRecognitionAPI.getStats());
  }, []);

  const resetStats = useCallback(() => {
    realFaceRecognitionAPI.resetStats();
    setStats(realFaceRecognitionAPI.getStats());
  }, []);

  return {
    detecting,
    stats,
    initializeAPI,
    detectFaces,
    detectLabels,
    recognizeText,
    clearCache,
    resetStats,
  };
}
