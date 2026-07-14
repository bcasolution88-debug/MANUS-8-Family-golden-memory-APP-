import { addToSyncQueue } from "./sync-manager";

export interface UploadTask {
  id: string;
  fileName: string;
  fileSize: number;
  uploadedSize: number;
  percentage: number;
  status: "pending" | "uploading" | "paused" | "completed" | "failed";
  startTime: number;
  estimatedTime: number; // 预计剩余时间（秒）
  speed: number; // 上传速度（字节/秒）
  chunkSize: number;
  uploadedChunks: number[];
  error?: string;
}

export interface UploadChunk {
  chunkIndex: number;
  startByte: number;
  endByte: number;
  size: number;
  data: string; // Base64编码的数据
}

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MAX_CONCURRENT_CHUNKS = 3;
const UPLOAD_TASKS: Map<string, UploadTask> = new Map();

/**
 * 创建上传任务
 */
export function createUploadTask(
  fileName: string,
  fileSize: number
): UploadTask {
  const taskId = `upload_${Date.now()}_${Math.random()}`;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  const task: UploadTask = {
    id: taskId,
    fileName,
    fileSize,
    uploadedSize: 0,
    percentage: 0,
    status: "pending",
    startTime: Date.now(),
    estimatedTime: 0,
    speed: 0,
    chunkSize: CHUNK_SIZE,
    uploadedChunks: [],
    error: undefined,
  };

  UPLOAD_TASKS.set(taskId, task);
  return task;
}

/**
 * 获取上传任务
 */
export function getUploadTask(taskId: string): UploadTask | undefined {
  return UPLOAD_TASKS.get(taskId);
}

/**
 * 更新上传进度
 */
export function updateUploadProgress(
  taskId: string,
  uploadedSize: number,
  chunkIndex: number
): UploadTask | undefined {
  const task = UPLOAD_TASKS.get(taskId);
  if (!task) return undefined;

  task.uploadedSize = uploadedSize;
  task.percentage = Math.round((uploadedSize / task.fileSize) * 100);

  // 计算上传速度和预计时间
  const elapsedTime = (Date.now() - task.startTime) / 1000;
  task.speed = uploadedSize / elapsedTime;
  const remainingSize = task.fileSize - uploadedSize;
  task.estimatedTime = Math.ceil(remainingSize / task.speed);

  // 记录已上传的分块
  if (!task.uploadedChunks.includes(chunkIndex)) {
    task.uploadedChunks.push(chunkIndex);
  }

  return task;
}

/**
 * 暂停上传
 */
export function pauseUpload(taskId: string): UploadTask | undefined {
  const task = UPLOAD_TASKS.get(taskId);
  if (!task) return undefined;

  task.status = "paused";
  return task;
}

/**
 * 恢复上传
 */
export function resumeUpload(taskId: string): UploadTask | undefined {
  const task = UPLOAD_TASKS.get(taskId);
  if (!task) return undefined;

  task.status = "uploading";
  return task;
}

/**
 * 取消上传
 */
export function cancelUpload(taskId: string): void {
  UPLOAD_TASKS.delete(taskId);
}

/**
 * 完成上传
 */
export function completeUpload(taskId: string): UploadTask | undefined {
  const task = UPLOAD_TASKS.get(taskId);
  if (!task) return undefined;

  task.status = "completed";
  task.percentage = 100;
  return task;
}

/**
 * 标记上传失败
 */
export function failUpload(taskId: string, error: string): UploadTask | undefined {
  const task = UPLOAD_TASKS.get(taskId);
  if (!task) return undefined;

  task.status = "failed";
  task.error = error;
  return task;
}

/**
 * 分割文件为分块
 */
export function splitFileIntoChunks(
  fileSize: number,
  totalSize: number = fileSize
): UploadChunk[] {
  const chunks: UploadChunk[] = [];
  const chunkCount = Math.ceil(totalSize / CHUNK_SIZE);

  for (let i = 0; i < chunkCount; i++) {
    const startByte = i * CHUNK_SIZE;
    const endByte = Math.min((i + 1) * CHUNK_SIZE, totalSize);
    const size = endByte - startByte;

    chunks.push({
      chunkIndex: i,
      startByte,
      endByte,
      size,
      data: "", // 实际使用时需要填充
    });
  }

  return chunks;
}

/**
 * 获取待上传的分块列表
 */
export function getPendingChunks(
  taskId: string
): UploadChunk[] {
  const task = UPLOAD_TASKS.get(taskId);
  if (!task) return [];

  const chunks = splitFileIntoChunks(task.fileSize);
  return chunks.filter(chunk => !task.uploadedChunks.includes(chunk.chunkIndex));
}

/**
 * 上传单个分块
 */
export async function uploadChunk(
  taskId: string,
  chunk: UploadChunk,
  onProgress?: (progress: { loaded: number; total: number }) => void
): Promise<void> {
  try {
    const task = UPLOAD_TASKS.get(taskId);
    if (!task) throw new Error("Task not found");

    // 模拟上传分块
    await new Promise(resolve => setTimeout(resolve, 500));

    // 更新进度
    const uploadedSize = task.uploadedSize + chunk.size;
    updateUploadProgress(taskId, uploadedSize, chunk.chunkIndex);

    onProgress?.({
      loaded: uploadedSize,
      total: task.fileSize,
    });
  } catch (error) {
    console.error("Failed to upload chunk:", error);
    throw error;
  }
}

/**
 * 并发上传多个分块
 */
export async function uploadChunksInParallel(
  taskId: string,
  chunks: UploadChunk[],
  onProgress?: (progress: { loaded: number; total: number }) => void
): Promise<void> {
  try {
    const task = UPLOAD_TASKS.get(taskId);
    if (!task) throw new Error("Task not found");

    task.status = "uploading";

    // 分批上传分块
    for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_CHUNKS) {
      if (task.status === "paused") {
        break;
      }

      const batch = chunks.slice(i, i + MAX_CONCURRENT_CHUNKS);
      await Promise.all(
        batch.map(chunk =>
          uploadChunk(taskId, chunk, onProgress).catch(error => {
            console.error(`Failed to upload chunk ${chunk.chunkIndex}:`, error);
            throw error;
          })
        )
      );
    }

    // 所有分块上传完成
    if (task.status !== "paused") {
      completeUpload(taskId);
    }
  } catch (error) {
    console.error("Failed to upload chunks in parallel:", error);
    failUpload(taskId, String(error));
    throw error;
  }
}

/**
 * 获取所有上传任务
 */
export function getAllUploadTasks(): UploadTask[] {
  return Array.from(UPLOAD_TASKS.values());
}

/**
 * 清理已完成的上传任务
 */
export function cleanupCompletedTasks(): void {
  for (const [taskId, task] of UPLOAD_TASKS.entries()) {
    if (task.status === "completed" || task.status === "failed") {
      UPLOAD_TASKS.delete(taskId);
    }
  }
}

/**
 * 格式化上传速度
 */
export function formatUploadSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${Math.round(bytesPerSecond)} B/s`;
  } else if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
  } else {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
  }
}

/**
 * 格式化剩余时间
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${minutes}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}
