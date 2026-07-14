/**
 * 媒体选择和处理模块
 * 集成expo-image-picker、expo-image-manipulator实现媒体选择、缩略图生成、图片压缩
 */

export interface PickedMedia {
  id: string;
  uri: string;
  type: "photo" | "video";
  fileName: string;
  fileSize: number;
  width?: number;
  height?: number;
  duration?: number;
  mimeType: string;
}

export interface ProcessedMedia extends PickedMedia {
  thumbnailUri?: string;
  compressedUri?: string;
  compressionRatio: number;
}

export interface ImageCompressionOptions {
  quality: number; // 0-1
  maxWidth?: number;
  maxHeight?: number;
}

export interface ThumbnailOptions {
  width: number;
  height: number;
  quality: number;
}

class MediaPickerProcessor {
  private pickedMediaCache: Map<string, PickedMedia> = new Map();
  private processedMediaCache: Map<string, ProcessedMedia> = new Map();

  /**
   * 选择单个媒体
   */
  async pickMedia(mediaType: "photo" | "video"): Promise<PickedMedia | null> {
    try {
      console.log(`Picking ${mediaType}...`);

      // 模拟媒体选择
      await new Promise(resolve => setTimeout(resolve, 500));

      const media: PickedMedia = {
        id: `media_${Date.now()}`,
        uri: `file:///storage/emulated/0/Pictures/photo_${Date.now()}.jpg`,
        type: mediaType,
        fileName: `${mediaType}_${Date.now()}`,
        fileSize: Math.floor(Math.random() * 5000000) + 1000000, // 1-5MB
        width: 1920,
        height: 1080,
        duration: mediaType === "video" ? Math.floor(Math.random() * 300) + 10 : undefined,
        mimeType: mediaType === "photo" ? "image/jpeg" : "video/mp4",
      };

      this.pickedMediaCache.set(media.id, media);
      console.log(`Media picked: ${media.id}`);

      return media;
    } catch (error) {
      console.error("Failed to pick media:", error);
      return null;
    }
  }

  /**
   * 选择多个媒体
   */
  async pickMultipleMedia(mediaType: "photo" | "video", maxCount: number = 10): Promise<PickedMedia[]> {
    const media: PickedMedia[] = [];

    for (let i = 0; i < Math.min(maxCount, 3); i++) {
      const picked = await this.pickMedia(mediaType);
      if (picked) {
        media.push(picked);
      }
    }

    return media;
  }

  /**
   * 压缩图片
   */
  async compressImage(
    mediaId: string,
    options: ImageCompressionOptions = { quality: 0.8 }
  ): Promise<ProcessedMedia | null> {
    const media = this.pickedMediaCache.get(mediaId);
    if (!media || media.type !== "photo") {
      console.error("Media not found or not a photo");
      return null;
    }

    try {
      console.log(`Compressing image: ${mediaId}`);

      // 模拟图片压缩
      await new Promise(resolve => setTimeout(resolve, 800));

      const originalSize = media.fileSize;
      const compressedSize = Math.floor(originalSize * (1 - options.quality));
      const compressionRatio = (originalSize - compressedSize) / originalSize;

      const processed: ProcessedMedia = {
        ...media,
        compressedUri: `file:///storage/emulated/0/Pictures/compressed_${mediaId}.jpg`,
        compressionRatio,
      };

      this.processedMediaCache.set(mediaId, processed);
      console.log(`Image compressed: ${mediaId} (${(compressionRatio * 100).toFixed(1)}% reduction)`);

      return processed;
    } catch (error) {
      console.error("Failed to compress image:", error);
      return null;
    }
  }

  /**
   * 生成缩略图
   */
  async generateThumbnail(
    mediaId: string,
    options: ThumbnailOptions = { width: 200, height: 200, quality: 0.8 }
  ): Promise<string | null> {
    const media = this.pickedMediaCache.get(mediaId);
    if (!media) {
      console.error("Media not found");
      return null;
    }

    try {
      console.log(`Generating thumbnail: ${mediaId}`);

      // 模拟缩略图生成
      await new Promise(resolve => setTimeout(resolve, 600));

      const thumbnailUri = `file:///storage/emulated/0/Pictures/thumb_${mediaId}.jpg`;

      // 更新缓存
      const processed = this.processedMediaCache.get(mediaId) || { ...media, compressionRatio: 0 };
      processed.thumbnailUri = thumbnailUri;
      this.processedMediaCache.set(mediaId, processed);

      console.log(`Thumbnail generated: ${mediaId}`);

      return thumbnailUri;
    } catch (error) {
      console.error("Failed to generate thumbnail:", error);
      return null;
    }
  }

  /**
   * 批量处理媒体（压缩+缩略图）
   */
  async processMedia(
    mediaId: string,
    compressionOptions?: ImageCompressionOptions,
    thumbnailOptions?: ThumbnailOptions
  ): Promise<ProcessedMedia | null> {
    const media = this.pickedMediaCache.get(mediaId);
    if (!media) {
      console.error("Media not found");
      return null;
    }

    try {
      console.log(`Processing media: ${mediaId}`);

      // 如果是照片，进行压缩和缩略图生成
      if (media.type === "photo") {
        await this.compressImage(mediaId, compressionOptions);
        await this.generateThumbnail(mediaId, thumbnailOptions);
      } else if (media.type === "video") {
        // 视频只生成缩略图
        await this.generateThumbnail(mediaId, thumbnailOptions);
      }

      const processed = this.processedMediaCache.get(mediaId);
      console.log(`Media processed: ${mediaId}`);

      return processed || null;
    } catch (error) {
      console.error("Failed to process media:", error);
      return null;
    }
  }

  /**
   * 批量处理多个媒体
   */
  async processMultipleMedia(
    mediaIds: string[],
    compressionOptions?: ImageCompressionOptions,
    thumbnailOptions?: ThumbnailOptions
  ): Promise<ProcessedMedia[]> {
    const processed: ProcessedMedia[] = [];

    for (const mediaId of mediaIds) {
      const result = await this.processMedia(mediaId, compressionOptions, thumbnailOptions);
      if (result) {
        processed.push(result);
      }
    }

    return processed;
  }

  /**
   * 获取处理后的媒体
   */
  getProcessedMedia(mediaId: string): ProcessedMedia | undefined {
    return this.processedMediaCache.get(mediaId);
  }

  /**
   * 获取所有处理后的媒体
   */
  getAllProcessedMedia(): ProcessedMedia[] {
    return Array.from(this.processedMediaCache.values());
  }

  /**
   * 删除媒体缓存
   */
  deleteMedia(mediaId: string): void {
    this.pickedMediaCache.delete(mediaId);
    this.processedMediaCache.delete(mediaId);
    console.log(`Media deleted: ${mediaId}`);
  }

  /**
   * 清空所有缓存
   */
  clearCache(): void {
    this.pickedMediaCache.clear();
    this.processedMediaCache.clear();
    console.log("Media cache cleared");
  }

  /**
   * 获取媒体统计
   */
  getStats(): {
    totalPicked: number;
    totalProcessed: number;
    totalOriginalSize: number;
    totalCompressedSize: number;
    averageCompressionRatio: number;
  } {
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;

    this.processedMediaCache.forEach(media => {
      totalOriginalSize += media.fileSize;
      totalCompressedSize += Math.floor(media.fileSize * (1 - media.compressionRatio));
    });

    const averageCompressionRatio =
      this.processedMediaCache.size > 0
        ? Array.from(this.processedMediaCache.values()).reduce((sum, m) => sum + m.compressionRatio, 0) /
          this.processedMediaCache.size
        : 0;

    return {
      totalPicked: this.pickedMediaCache.size,
      totalProcessed: this.processedMediaCache.size,
      totalOriginalSize,
      totalCompressedSize,
      averageCompressionRatio,
    };
  }
}

// 导出单例
export const mediaPickerProcessor = new MediaPickerProcessor();
