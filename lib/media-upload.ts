import { addToSyncQueue } from "./sync-manager";

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface MediaFile {
  uri: string;
  type: "photo" | "video";
  name: string;
  size: number;
  mimeType: string;
  duration?: number;
  thumbnail?: string;
}

/**
 * 选择照片
 * 注：实际使用时需要集成 expo-image-picker
 */
export async function pickPhoto(): Promise<MediaFile | null> {
  try {
    // 模拟照片选择
    return {
      uri: "file:///path/to/photo.jpg",
      type: "photo",
      name: "photo.jpg",
      size: 2048000,
      mimeType: "image/jpeg",
    };
  } catch (error) {
    console.error("Failed to pick photo:", error);
    throw error;
  }
}

/**
 * 选择视频
 */
export async function pickVideo(): Promise<MediaFile | null> {
  try {
    // 模拟视频选择
    return {
      uri: "file:///path/to/video.mp4",
      type: "video",
      name: "video.mp4",
      size: 52428800,
      mimeType: "video/mp4",
      duration: 180,
    };
  } catch (error) {
    console.error("Failed to pick video:", error);
    throw error;
  }
}

/**
 * 使用相机拍照
 */
export async function takePhoto(): Promise<MediaFile | null> {
  try {
    return {
      uri: "file:///path/to/camera_photo.jpg",
      type: "photo",
      name: "camera_photo.jpg",
      size: 3145728,
      mimeType: "image/jpeg",
    };
  } catch (error) {
    console.error("Failed to take photo:", error);
    throw error;
  }
}

/**
 * 使用相机录视频
 */
export async function recordVideo(): Promise<MediaFile | null> {
  try {
    return {
      uri: "file:///path/to/camera_video.mp4",
      type: "video",
      name: "camera_video.mp4",
      size: 104857600,
      mimeType: "video/mp4",
      duration: 300,
    };
  } catch (error) {
    console.error("Failed to record video:", error);
    throw error;
  }
}

/**
 * 生成缩略图
 */
export async function generatePhotoThumbnail(
  mediaFile: MediaFile
): Promise<string | null> {
  try {
    return mediaFile.uri;
  } catch (error) {
    console.error("Failed to generate photo thumbnail:", error);
    return null;
  }
}

/**
 * 上传媒体文件到S3
 */
export async function uploadMediaToS3(
  mediaFile: MediaFile,
  albumId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  try {
    // 模拟上传进度
    for (let i = 0; i <= 100; i += 10) {
      onProgress?.({
        loaded: (mediaFile.size * i) / 100,
        total: mediaFile.size,
        percentage: i,
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 模拟上传响应
    return `https://s3.amazonaws.com/golden-memory/${albumId}/${mediaFile.name}`;
  } catch (error) {
    console.error("Failed to upload media:", error);

    // 添加到离线队列
    await addToSyncQueue({
      type: "upload",
      data: {
        mediaFile,
        albumId,
      },
    });

    throw error;
  }
}

/**
 * 批量上传媒体文件
 */
export async function uploadMultipleMedia(
  mediaFiles: MediaFile[],
  albumId: string,
  onProgress?: (fileIndex: number, progress: UploadProgress) => void
): Promise<string[]> {
  const uploadedUrls: string[] = [];

  for (let i = 0; i < mediaFiles.length; i++) {
    try {
      const url = await uploadMediaToS3(mediaFiles[i], albumId, (progress) => {
        onProgress?.(i, progress);
      });
      uploadedUrls.push(url);
    } catch (error) {
      console.error(`Failed to upload file ${i}:`, error);
    }
  }

  return uploadedUrls;
}

/**
 * 获取文件大小（MB）
 */
export function getFileSizeMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

/**
 * 格式化视频时长
 */
export function formatVideoDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
