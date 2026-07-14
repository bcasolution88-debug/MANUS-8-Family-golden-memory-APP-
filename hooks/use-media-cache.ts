import { useEffect, useCallback } from "react";
import { mediaCacheManager, NetworkInfo } from "@/lib/media-cache-manager";

export function useMediaCache() {
  // 监听网络状态变化
  useEffect(() => {
    // 模拟网络信息更新
    const updateNetworkInfo = () => {
      const mockNetworkInfo: Partial<NetworkInfo> = {
        type: "wifi",
        effectiveType: "4g",
        downlink: 10,
        rtt: 50,
      };
      mediaCacheManager.updateNetworkInfo(mockNetworkInfo);
    };

    updateNetworkInfo();

    // 定期更新网络信息
    const interval = setInterval(updateNetworkInfo, 5000);

    return () => clearInterval(interval);
  }, []);

  const preloadMedias = useCallback((urls: string[]) => {
    return mediaCacheManager.preloadMedias(urls);
  }, []);

  const getMedia = useCallback((url: string) => {
    return mediaCacheManager.getMedia(url);
  }, []);

  const cacheMedia = useCallback((url: string, data: string) => {
    mediaCacheManager.cacheMedia(url, data);
  }, []);

  const clearCache = useCallback(() => {
    mediaCacheManager.clearCache();
  }, []);

  const getCacheStats = useCallback(() => {
    return mediaCacheManager.getCacheStats();
  }, []);

  const getRecommendedImageQuality = useCallback(() => {
    return mediaCacheManager.getRecommendedImageQuality();
  }, []);

  const getRecommendedVideoQuality = useCallback(() => {
    return mediaCacheManager.getRecommendedVideoQuality();
  }, []);

  return {
    preloadMedias,
    getMedia,
    cacheMedia,
    clearCache,
    getCacheStats,
    getRecommendedImageQuality,
    getRecommendedVideoQuality,
  };
}
