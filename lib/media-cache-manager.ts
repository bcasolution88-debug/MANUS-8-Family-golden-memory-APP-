/**
 * 媒体缓存和预加载管理模块
 * 支持LRU缓存、智能预加载、网络自适应加载
 */

export interface CachedMedia {
  url: string;
  data: string; // Base64编码的数据
  size: number;
  timestamp: number;
  accessCount: number;
  lastAccessTime: number;
}

export interface NetworkInfo {
  type: "wifi" | "cellular" | "none" | "unknown";
  effectiveType: "4g" | "3g" | "2g" | "slow-2g";
  downlink: number; // Mbps
  rtt: number; // 往返时间（毫秒）
}

class MediaCacheManager {
  private cache: Map<string, CachedMedia> = new Map();
  private maxCacheSize = 100 * 1024 * 1024; // 100MB
  private currentCacheSize = 0;
  private preloadQueue: string[] = [];
  private isPreloading = false;
  private networkInfo: NetworkInfo = {
    type: "unknown",
    effectiveType: "4g",
    downlink: 10,
    rtt: 50,
  };

  /**
   * 获取缓存的媒体
   */
  getMedia(url: string): CachedMedia | undefined {
    const media = this.cache.get(url);
    if (media) {
      // 更新访问统计
      media.accessCount++;
      media.lastAccessTime = Date.now();
    }
    return media;
  }

  /**
   * 缓存媒体
   */
  cacheMedia(url: string, data: string): void {
    const size = data.length;

    // 检查缓存大小
    if (this.currentCacheSize + size > this.maxCacheSize) {
      this.evictLRU();
    }

    const media: CachedMedia = {
      url,
      data,
      size,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessTime: Date.now(),
    };

    this.cache.set(url, media);
    this.currentCacheSize += size;

    console.log(`Media cached: ${url} (${this.formatSize(size)})`);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.currentCacheSize = 0;
    console.log("Cache cleared");
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.currentCacheSize;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    itemCount: number;
    totalSize: string;
    maxSize: string;
    hitRate: number;
  } {
    let totalAccess = 0;
    this.cache.forEach(media => {
      totalAccess += media.accessCount;
    });

    return {
      itemCount: this.cache.size,
      totalSize: this.formatSize(this.currentCacheSize),
      maxSize: this.formatSize(this.maxCacheSize),
      hitRate: totalAccess > 0 ? (totalAccess / (totalAccess + 1)) * 100 : 0,
    };
  }

  /**
   * 预加载媒体列表
   */
  async preloadMedias(urls: string[]): Promise<void> {
    this.preloadQueue.push(...urls);
    await this.processPreloadQueue();
  }

  /**
   * 处理预加载队列
   */
  private async processPreloadQueue(): Promise<void> {
    if (this.isPreloading || this.preloadQueue.length === 0) return;

    this.isPreloading = true;

    try {
      while (this.preloadQueue.length > 0) {
        const url = this.preloadQueue.shift();
        if (url && !this.cache.has(url)) {
          await this.preloadMedia(url);
        }
      }
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * 预加载单个媒体
   */
  private async preloadMedia(url: string): Promise<void> {
    try {
      // 根据网络情况调整加载策略
      const shouldPreload = this.shouldPreloadMedia();
      if (!shouldPreload) {
        console.log(`Skipping preload for ${url} due to network conditions`);
        return;
      }

      console.log(`Preloading media: ${url}`);

      // 模拟加载
      await new Promise(resolve => setTimeout(resolve, 500));

      // 实际实现中会从URL加载数据
      const mockData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      this.cacheMedia(url, mockData);
    } catch (error) {
      console.error(`Failed to preload media ${url}:`, error);
    }
  }

  /**
   * 判断是否应该预加载
   */
  private shouldPreloadMedia(): boolean {
    // WiFi环境下总是预加载
    if (this.networkInfo.type === "wifi") {
      return true;
    }

    // 4G环境下预加载
    if (this.networkInfo.effectiveType === "4g") {
      return true;
    }

    // 3G及以下网络不预加载
    return false;
  }

  /**
   * 更新网络信息
   */
  updateNetworkInfo(info: Partial<NetworkInfo>): void {
    this.networkInfo = { ...this.networkInfo, ...info };
    console.log("Network info updated:", this.networkInfo);
  }

  /**
   * 获取网络信息
   */
  getNetworkInfo(): NetworkInfo {
    return this.networkInfo;
  }

  /**
   * 获取推荐的图片质量
   */
  getRecommendedImageQuality(): "high" | "medium" | "low" {
    switch (this.networkInfo.effectiveType) {
      case "4g":
        return "high";
      case "3g":
        return "medium";
      case "2g":
      case "slow-2g":
        return "low";
      default:
        return "high";
    }
  }

  /**
   * 获取推荐的视频质量
   */
  getRecommendedVideoQuality(): "1080p" | "720p" | "480p" | "360p" {
    switch (this.networkInfo.effectiveType) {
      case "4g":
        return "1080p";
      case "3g":
        return "720p";
      case "2g":
        return "480p";
      case "slow-2g":
        return "360p";
      default:
        return "1080p";
    }
  }

  /**
   * LRU驱逐策略
   */
  private evictLRU(): void {
    // 找到最少使用的媒体
    let lruUrl: string | null = null;
    let minScore = Infinity;

    this.cache.forEach((media, url) => {
      // 计算LRU分数（访问次数 * 最后访问时间）
      const score = media.accessCount * (Date.now() - media.lastAccessTime);
      if (score < minScore) {
        minScore = score;
        lruUrl = url;
      }
    });

    if (lruUrl) {
      const media = this.cache.get(lruUrl);
      if (media) {
        this.currentCacheSize -= media.size;
        this.cache.delete(lruUrl);
        console.log(`Evicted LRU media: ${lruUrl}`);
      }
    }
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

// 导出单例
export const mediaCacheManager = new MediaCacheManager();
