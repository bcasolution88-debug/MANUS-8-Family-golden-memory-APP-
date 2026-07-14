/**
 * 完整的媒体上传流程管理
 * 集成媒体选择、S3上传、进度显示、缩略图生成
 */

export interface UploadTask {
  id: string;
  mediaId: string;
  filename: string;
  mediaType: "photo" | "video";
  fileSize: number;
  status: "pending" | "uploading" | "processing" | "completed" | "failed";
  progress: number;
  uploadedSize: number;
  thumbnailUrl?: string;
  s3Url?: string;
  metadata?: Record<string, any>;
  error?: string;
  startTime: number;
  endTime?: number;
  retryCount: number;
}

export interface UploadProgress {
  taskId: string;
  progress: number;
  uploadedSize: number;
  totalSize: number;
  speed: number; // bytes per second
  estimatedTime: number; // seconds
  status: string;
}

export interface ThumbnailOptions {
  width: number;
  height: number;
  quality: number;
}

class CompleteUploadManager {
  private uploadTasks: Map<string, UploadTask> = new Map();
  private activeUploads: Set<string> = new Set();
  private maxConcurrentUploads = 3;
  private uploadQueue: string[] = [];
  private s3Endpoint = "https://s3.amazonaws.com"; // 模拟S3端点
  private thumbnailCache: Map<string, string> = new Map();

  /**
   * 创建上传任务
   */
  createUploadTask(
    mediaId: string,
    filename: string,
    mediaType: "photo" | "video",
    fileSize: number,
    metadata?: Record<string, any>
  ): UploadTask {
    const task: UploadTask = {
      id: `upload_${Date.now()}`,
      mediaId,
      filename,
      mediaType,
      fileSize,
      status: "pending",
      progress: 0,
      uploadedSize: 0,
      metadata,
      startTime: Date.now(),
      retryCount: 0,
    };

    this.uploadTasks.set(task.id, task);
    this.uploadQueue.push(task.id);

    console.log(`Upload task created: ${task.id}`);
    return task;
  }

  /**
   * 开始上传
   */
  async startUpload(
    taskId: string,
    fileData: ArrayBuffer,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadTask> {
    const task = this.uploadTasks.get(taskId);
    if (!task) {
      throw new Error(`Upload task not found: ${taskId}`);
    }

    // 等待队列
    while (this.activeUploads.size >= this.maxConcurrentUploads) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.activeUploads.add(taskId);
    task.status = "uploading";
    task.startTime = Date.now();

    try {
      // 模拟分块上传
      const chunkSize = 1024 * 1024; // 1MB chunks
      const chunks = Math.ceil(task.fileSize / chunkSize);

      for (let i = 0; i < chunks; i++) {
        // 模拟上传延迟
        await new Promise(resolve => setTimeout(resolve, 100));

        const uploadedSize = Math.min((i + 1) * chunkSize, task.fileSize);
        task.uploadedSize = uploadedSize;
        task.progress = Math.round((uploadedSize / task.fileSize) * 100);

        if (onProgress) {
          const elapsed = (Date.now() - task.startTime) / 1000;
          const speed = uploadedSize / elapsed;
          const remaining = task.fileSize - uploadedSize;
          const estimatedTime = remaining / speed;

          onProgress({
            taskId,
            progress: task.progress,
            uploadedSize,
            totalSize: task.fileSize,
            speed,
            estimatedTime,
            status: "uploading",
          });
        }
      }

      // 生成S3 URL
      task.s3Url = `${this.s3Endpoint}/uploads/${task.mediaId}/${task.filename}`;

      // 生成缩略图
      if (task.mediaType === "photo") {
        task.status = "processing";
        task.thumbnailUrl = await this.generateThumbnail(
          task.mediaId,
          fileData,
          { width: 200, height: 200, quality: 80 }
        );
      }

      task.status = "completed";
      task.endTime = Date.now();

      console.log(`Upload completed: ${taskId}`);
      return task;
    } catch (error) {
      task.status = "failed";
      task.error = String(error);
      task.retryCount++;

      console.error(`Upload failed: ${taskId}`, error);
      throw error;
    } finally {
      this.activeUploads.delete(taskId);
    }
  }

  /**
   * 生成缩略图
   */
  async generateThumbnail(
    mediaId: string,
    fileData: ArrayBuffer,
    options: ThumbnailOptions = { width: 200, height: 200, quality: 80 }
  ): Promise<string> {
    const cacheKey = `${mediaId}_${options.width}x${options.height}`;

    if (this.thumbnailCache.has(cacheKey)) {
      return this.thumbnailCache.get(cacheKey)!;
    }

    try {
      // 模拟缩略图生成
      await new Promise(resolve => setTimeout(resolve, 500));

      const thumbnailUrl = `${this.s3Endpoint}/thumbnails/${mediaId}_${options.width}x${options.height}.jpg`;
      this.thumbnailCache.set(cacheKey, thumbnailUrl);

      console.log(`Thumbnail generated: ${thumbnailUrl}`);
      return thumbnailUrl;
    } catch (error) {
      console.error("Failed to generate thumbnail:", error);
      throw error;
    }
  }

  /**
   * 暂停上传
   */
  pauseUpload(taskId: string): void {
    const task = this.uploadTasks.get(taskId);
    if (task && task.status === "uploading") {
      task.status = "pending";
      this.activeUploads.delete(taskId);
      console.log(`Upload paused: ${taskId}`);
    }
  }

  /**
   * 继续上传
   */
  async resumeUpload(
    taskId: string,
    fileData: ArrayBuffer,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadTask> {
    const task = this.uploadTasks.get(taskId);
    if (!task) {
      throw new Error(`Upload task not found: ${taskId}`);
    }

    console.log(`Upload resumed: ${taskId}`);
    return this.startUpload(taskId, fileData, onProgress);
  }

  /**
   * 取消上传
   */
  cancelUpload(taskId: string): void {
    const task = this.uploadTasks.get(taskId);
    if (task) {
      this.uploadTasks.delete(taskId);
      this.activeUploads.delete(taskId);
      const queueIndex = this.uploadQueue.indexOf(taskId);
      if (queueIndex > -1) {
        this.uploadQueue.splice(queueIndex, 1);
      }
      console.log(`Upload cancelled: ${taskId}`);
    }
  }

  /**
   * 获取上传任务
   */
  getUploadTask(taskId: string): UploadTask | undefined {
    return this.uploadTasks.get(taskId);
  }

  /**
   * 获取所有上传任务
   */
  getAllUploadTasks(): UploadTask[] {
    return Array.from(this.uploadTasks.values());
  }

  /**
   * 获取进行中的上传任务
   */
  getActiveUploads(): UploadTask[] {
    return Array.from(this.activeUploads)
      .map(id => this.uploadTasks.get(id))
      .filter((task): task is UploadTask => !!task);
  }

  /**
   * 获取上传统计
   */
  getStats(): {
    total: number;
    completed: number;
    failed: number;
    active: number;
    queued: number;
    totalSize: number;
    uploadedSize: number;
  } {
    const tasks = Array.from(this.uploadTasks.values());

    return {
      total: tasks.length,
      completed: tasks.filter(t => t.status === "completed").length,
      failed: tasks.filter(t => t.status === "failed").length,
      active: this.activeUploads.size,
      queued: this.uploadQueue.length,
      totalSize: tasks.reduce((sum, t) => sum + t.fileSize, 0),
      uploadedSize: tasks.reduce((sum, t) => sum + t.uploadedSize, 0),
    };
  }

  /**
   * 清空完成的上传
   */
  clearCompleted(): void {
    const completed = Array.from(this.uploadTasks.entries())
      .filter(([_, task]) => task.status === "completed")
      .map(([id]) => id);

    completed.forEach(id => this.uploadTasks.delete(id));
    console.log(`Cleared ${completed.length} completed uploads`);
  }

  /**
   * 清空所有上传
   */
  clearAll(): void {
    this.uploadTasks.clear();
    this.activeUploads.clear();
    this.uploadQueue = [];
    this.thumbnailCache.clear();
    console.log("All uploads cleared");
  }

  /**
   * 重试失败的上传
   */
  async retryFailed(
    fileData: Map<string, ArrayBuffer>,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    const failed = Array.from(this.uploadTasks.values()).filter(
      t => t.status === "failed" && t.retryCount < 3
    );

    for (const task of failed) {
      const data = fileData.get(task.id);
      if (data) {
        try {
          await this.startUpload(task.id, data, onProgress);
        } catch (error) {
          console.error(`Retry failed for ${task.id}:`, error);
        }
      }
    }
  }
}

// 导出单例
export const completeUploadManager = new CompleteUploadManager();
