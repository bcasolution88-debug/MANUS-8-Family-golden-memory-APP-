/**
 * 媒体库访问管理模块
 * 集成expo-media-library实现设备相册访问、权限管理、媒体库浏览
 */

export interface MediaAsset {
  id: string;
  filename: string;
  uri: string;
  mediaType: "photo" | "video";
  width?: number;
  height?: number;
  duration?: number;
  creationTime: number;
  modificationTime: number;
  albumId?: string;
}

export interface MediaAlbum {
  id: string;
  title: string;
  assetCount: number;
  assets: MediaAsset[];
}

export interface PermissionStatus {
  hasPermission: boolean;
  canAskAgain: boolean;
  status: "granted" | "denied" | "undetermined";
}

class MediaLibraryManager {
  private albums: Map<string, MediaAlbum> = new Map();
  private assets: Map<string, MediaAsset> = new Map();
  private permissionStatus: PermissionStatus = {
    hasPermission: false,
    canAskAgain: true,
    status: "undetermined",
  };

  /**
   * 请求媒体库权限
   */
  async requestPermission(): Promise<PermissionStatus> {
    try {
      console.log("Requesting media library permission...");

      // 模拟权限请求
      await new Promise(resolve => setTimeout(resolve, 500));

      this.permissionStatus = {
        hasPermission: true,
        canAskAgain: false,
        status: "granted",
      };

      console.log("Permission granted");
      return this.permissionStatus;
    } catch (error) {
      console.error("Failed to request permission:", error);
      this.permissionStatus = {
        hasPermission: false,
        canAskAgain: true,
        status: "denied",
      };
      return this.permissionStatus;
    }
  }

  /**
   * 获取权限状态
   */
  getPermissionStatus(): PermissionStatus {
    return this.permissionStatus;
  }

  /**
   * 获取所有相册
   */
  async getAlbums(): Promise<MediaAlbum[]> {
    if (!this.permissionStatus.hasPermission) {
      console.error("Permission not granted");
      return [];
    }

    try {
      console.log("Fetching albums...");

      // 模拟获取相册
      await new Promise(resolve => setTimeout(resolve, 800));

      const mockAlbums: MediaAlbum[] = [
        {
          id: "album_1",
          title: "Camera Roll",
          assetCount: 45,
          assets: [],
        },
        {
          id: "album_2",
          title: "Screenshots",
          assetCount: 12,
          assets: [],
        },
        {
          id: "album_3",
          title: "Memories",
          assetCount: 28,
          assets: [],
        },
      ];

      mockAlbums.forEach(album => this.albums.set(album.id, album));
      console.log(`Fetched ${mockAlbums.length} albums`);

      return mockAlbums;
    } catch (error) {
      console.error("Failed to fetch albums:", error);
      return [];
    }
  }

  /**
   * 获取相册中的媒体
   */
  async getAlbumAssets(albumId: string, limit: number = 50): Promise<MediaAsset[]> {
    if (!this.permissionStatus.hasPermission) {
      console.error("Permission not granted");
      return [];
    }

    try {
      console.log(`Fetching assets for album ${albumId}...`);

      // 模拟获取相册中的媒体
      await new Promise(resolve => setTimeout(resolve, 1000));

      const assets: MediaAsset[] = [];
      for (let i = 0; i < Math.min(limit, 20); i++) {
        const asset: MediaAsset = {
          id: `asset_${albumId}_${i}`,
          filename: `media_${i}.${i % 2 === 0 ? "jpg" : "mp4"}`,
          uri: `file:///storage/emulated/0/Pictures/media_${i}.${i % 2 === 0 ? "jpg" : "mp4"}`,
          mediaType: i % 2 === 0 ? "photo" : "video",
          width: 1920,
          height: 1080,
          duration: i % 2 === 0 ? undefined : Math.floor(Math.random() * 300) + 10,
          creationTime: Date.now() - i * 86400000,
          modificationTime: Date.now() - i * 86400000,
          albumId,
        };

        assets.push(asset);
        this.assets.set(asset.id, asset);
      }

      const album = this.albums.get(albumId);
      if (album) {
        album.assets = assets;
      }

      console.log(`Fetched ${assets.length} assets`);
      return assets;
    } catch (error) {
      console.error("Failed to fetch assets:", error);
      return [];
    }
  }

  /**
   * 获取最近的媒体
   */
  async getRecentAssets(limit: number = 20): Promise<MediaAsset[]> {
    if (!this.permissionStatus.hasPermission) {
      console.error("Permission not granted");
      return [];
    }

    try {
      console.log("Fetching recent assets...");

      // 模拟获取最近的媒体
      await new Promise(resolve => setTimeout(resolve, 800));

      const assets: MediaAsset[] = [];
      for (let i = 0; i < Math.min(limit, 20); i++) {
        const asset: MediaAsset = {
          id: `recent_asset_${i}`,
          filename: `recent_${i}.${i % 2 === 0 ? "jpg" : "mp4"}`,
          uri: `file:///storage/emulated/0/Pictures/recent_${i}.${i % 2 === 0 ? "jpg" : "mp4"}`,
          mediaType: i % 2 === 0 ? "photo" : "video",
          width: 1920,
          height: 1080,
          duration: i % 2 === 0 ? undefined : Math.floor(Math.random() * 300) + 10,
          creationTime: Date.now() - i * 3600000,
          modificationTime: Date.now() - i * 3600000,
        };

        assets.push(asset);
        this.assets.set(asset.id, asset);
      }

      console.log(`Fetched ${assets.length} recent assets`);
      return assets;
    } catch (error) {
      console.error("Failed to fetch recent assets:", error);
      return [];
    }
  }

  /**
   * 搜索媒体
   */
  async searchAssets(query: string, limit: number = 50): Promise<MediaAsset[]> {
    if (!this.permissionStatus.hasPermission) {
      console.error("Permission not granted");
      return [];
    }

    try {
      console.log(`Searching for "${query}"...`);

      // 模拟搜索
      await new Promise(resolve => setTimeout(resolve, 600));

      const assets: MediaAsset[] = [];
      for (let i = 0; i < Math.min(limit, 10); i++) {
        const asset: MediaAsset = {
          id: `search_asset_${i}`,
          filename: `${query}_${i}.${i % 2 === 0 ? "jpg" : "mp4"}`,
          uri: `file:///storage/emulated/0/Pictures/${query}_${i}.${i % 2 === 0 ? "jpg" : "mp4"}`,
          mediaType: i % 2 === 0 ? "photo" : "video",
          width: 1920,
          height: 1080,
          creationTime: Date.now() - i * 86400000,
          modificationTime: Date.now() - i * 86400000,
        };

        assets.push(asset);
      }

      console.log(`Found ${assets.length} assets`);
      return assets;
    } catch (error) {
      console.error("Failed to search assets:", error);
      return [];
    }
  }

  /**
   * 获取单个媒体详情
   */
  getAsset(assetId: string): MediaAsset | undefined {
    return this.assets.get(assetId);
  }

  /**
   * 获取所有缓存的媒体
   */
  getAllCachedAssets(): MediaAsset[] {
    return Array.from(this.assets.values());
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.albums.clear();
    this.assets.clear();
    console.log("Media library cache cleared");
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalAlbums: number;
    totalAssets: number;
    totalPhotos: number;
    totalVideos: number;
    permissionStatus: PermissionStatus;
  } {
    let totalPhotos = 0;
    let totalVideos = 0;

    this.assets.forEach(asset => {
      if (asset.mediaType === "photo") {
        totalPhotos++;
      } else {
        totalVideos++;
      }
    });

    return {
      totalAlbums: this.albums.size,
      totalAssets: this.assets.size,
      totalPhotos,
      totalVideos,
      permissionStatus: this.permissionStatus,
    };
  }
}

// 导出单例
export const mediaLibraryManager = new MediaLibraryManager();
