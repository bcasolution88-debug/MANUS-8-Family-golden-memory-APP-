import { useCallback, useState } from "react";
import { mediaPickerProcessor, PickedMedia, ProcessedMedia, ImageCompressionOptions, ThumbnailOptions } from "@/lib/media-picker-processor";

export function useMediaPickerProcessor() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedMedia, setProcessedMedia] = useState<ProcessedMedia[]>([]);

  const pickMedia = useCallback(async (mediaType: "photo" | "video") => {
    setIsProcessing(true);
    try {
      const media = await mediaPickerProcessor.pickMedia(mediaType);
      return media;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const pickMultipleMedia = useCallback(
    async (mediaType: "photo" | "video", maxCount?: number) => {
      setIsProcessing(true);
      try {
        const media = await mediaPickerProcessor.pickMultipleMedia(mediaType, maxCount);
        return media;
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const compressImage = useCallback(
    async (mediaId: string, options?: ImageCompressionOptions) => {
      setIsProcessing(true);
      try {
        return await mediaPickerProcessor.compressImage(mediaId, options);
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const generateThumbnail = useCallback(
    async (mediaId: string, options?: ThumbnailOptions) => {
      setIsProcessing(true);
      try {
        return await mediaPickerProcessor.generateThumbnail(mediaId, options);
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const processMedia = useCallback(
    async (
      mediaId: string,
      compressionOptions?: ImageCompressionOptions,
      thumbnailOptions?: ThumbnailOptions
    ) => {
      setIsProcessing(true);
      try {
        const result = await mediaPickerProcessor.processMedia(
          mediaId,
          compressionOptions,
          thumbnailOptions
        );
        if (result) {
          setProcessedMedia(prev => [...prev, result]);
        }
        return result;
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const processMultipleMedia = useCallback(
    async (
      mediaIds: string[],
      compressionOptions?: ImageCompressionOptions,
      thumbnailOptions?: ThumbnailOptions
    ) => {
      setIsProcessing(true);
      try {
        const results = await mediaPickerProcessor.processMultipleMedia(
          mediaIds,
          compressionOptions,
          thumbnailOptions
        );
        setProcessedMedia(prev => [...prev, ...results]);
        return results;
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const getProcessedMedia = useCallback((mediaId: string) => {
    return mediaPickerProcessor.getProcessedMedia(mediaId);
  }, []);

  const getAllProcessedMedia = useCallback(() => {
    return mediaPickerProcessor.getAllProcessedMedia();
  }, []);

  const deleteMedia = useCallback((mediaId: string) => {
    mediaPickerProcessor.deleteMedia(mediaId);
    setProcessedMedia(prev => prev.filter(m => m.id !== mediaId));
  }, []);

  const clearCache = useCallback(() => {
    mediaPickerProcessor.clearCache();
    setProcessedMedia([]);
  }, []);

  const getStats = useCallback(() => {
    return mediaPickerProcessor.getStats();
  }, []);

  return {
    pickMedia,
    pickMultipleMedia,
    compressImage,
    generateThumbnail,
    processMedia,
    processMultipleMedia,
    getProcessedMedia,
    getAllProcessedMedia,
    deleteMedia,
    clearCache,
    getStats,
    isProcessing,
    processedMedia,
  };
}
