/**
 * Media upload pipeline (P4 — real implementation).
 *
 *   media.initUpload   → { uploadId, storageKey, presignedUrl }
 *   HTTP PUT           → direct to private S3 (XHR for progress events)
 *   media.completeUpload → INSERT media{storageKey, url:/manus-storage/{key}}
 *
 * Objects live under owner-prefixed keys (see server/storage.ts) and the
 * server re-derives the key on completion, so a client cannot register an
 * object outside its own album. Progress, retries and concurrency are kept
 * client-side; nothing here is simulated anymore.
 */
import { Platform } from "react-native";
import { trpcClient } from "@/lib/trpc-client";

/** Thumbnail target: 400px on the long edge, JPEG q0.7 — ~30–60 KB. */
export const THUMBNAIL_SIZE = 400;
const THUMBNAIL_QUALITY = 0.7;

/**
 * P5: generate a JPEG thumbnail for an image or video on-device.
 * Returns null when generation isn't possible (web video, unsupported file),
 * in which case the server falls back to the original as thumbnail.
 */
export async function generateThumbnail(
  uri: string,
  mediaType: "photo" | "video",
  duration?: number,
): Promise<{ uri: string; blob: Blob } | null> {
  try {
    let thumbUri: string | null = null;
    if (mediaType === "photo") {
      const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
      const result = await manipulateAsync(uri, [{ resize: { width: THUMBNAIL_SIZE } }], {
        compress: THUMBNAIL_QUALITY,
        format: SaveFormat.JPEG,
      });
      thumbUri = result.uri;
    } else if (Platform.OS !== "web") {
      const { getThumbnailAsync } = await import("expo-video-thumbnails");
      // Grab a frame ~1s in (or the midpoint for very short clips).
      const timeMs = duration && duration < 2 ? Math.round((duration * 1000) / 2) : 1000;
      const result = await getThumbnailAsync(uri, { time: timeMs, quality: THUMBNAIL_QUALITY });
      const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
      const resized = await manipulateAsync(result.uri, [{ resize: { width: THUMBNAIL_SIZE } }], {
        compress: THUMBNAIL_QUALITY,
        format: SaveFormat.JPEG,
      });
      thumbUri = resized.uri;
    }
    if (!thumbUri) return null;
    const blob = await (await fetch(thumbUri)).blob();
    return { uri: thumbUri, blob };
  } catch (error) {
    console.warn("[upload] thumbnail generation failed, server will fall back", error);
    return null;
  }
}

export type UploadStatus = "pending" | "uploading" | "processing" | "completed" | "failed" | "cancelled";

export interface UploadSource {
  /** Local file URI (expo-image-picker asset.uri) or a Blob (web). */
  uri?: string;
  blob?: Blob;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  /** Video duration in seconds, if known. */
  duration?: number;
}

export interface UploadTarget {
  albumId: number;
  familyId: number;
  title?: string;
  description?: string;
}

export interface UploadTask {
  id: string;
  /** Server media id once completeUpload succeeds. */
  mediaId?: number;
  filename: string;
  mediaType: "photo" | "video";
  fileSize: number;
  status: UploadStatus;
  progress: number;
  uploadedSize: number;
  /** Private object key returned by initUpload. */
  storageKey?: string;
  /** Private key of the client-generated thumbnail (P5), if one was uploaded. */
  thumbnailKey?: string;
  uploadId?: string;
  /** Access-controlled proxy path (`/manus-storage/{key}`) after completion. */
  url?: string;
  thumbnailUrl?: string;
  error?: string;
  startTime: number;
  endTime?: number;
  retryCount: number;
  source: UploadSource;
  target: UploadTarget;
}

export interface UploadProgress {
  taskId: string;
  progress: number;
  uploadedSize: number;
  totalSize: number;
  speed: number; // bytes per second
  estimatedTime: number; // seconds
  status: UploadStatus;
}

type Listener = () => void;

const isVideo = (mime: string | undefined, name: string) =>
  (mime?.startsWith("video/") ?? false) || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name);

const guessMime = (name: string, fallback?: string) => {
  if (fallback) return fallback;
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", webp: "image/webp", gif: "image/gif",
    mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm",
  };
  return (ext && map[ext]) || "application/octet-stream";
};

class CompleteUploadManager {
  private tasks = new Map<string, UploadTask>();
  private active = new Set<string>();
  private queue: string[] = [];
  private xhrs = new Map<string, XMLHttpRequest>();
  private listeners = new Set<Listener>();
  maxConcurrentUploads = 3;
  maxRetries = 3;

  /* ------------------------------ events ------------------------------ */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  /* ------------------------------ tasks ------------------------------- */

  createUploadTask(source: UploadSource, target: UploadTarget): UploadTask {
    const task: UploadTask = {
      id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      filename: source.fileName,
      mediaType: isVideo(source.mimeType, source.fileName) ? "video" : "photo",
      fileSize: source.fileSize ?? 0,
      status: "pending",
      progress: 0,
      uploadedSize: 0,
      startTime: Date.now(),
      retryCount: 0,
      source,
      target,
    };
    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    this.emit();
    return task;
  }

  /** Create + start in one call. Resolves with the completed task. */
  async upload(source: UploadSource, target: UploadTarget, onProgress?: (p: UploadProgress) => void) {
    const task = this.createUploadTask(source, target);
    return this.startUpload(task.id, onProgress);
  }

  async startUpload(taskId: string, onProgress?: (p: UploadProgress) => void): Promise<UploadTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Upload task not found: ${taskId}`);

    // Simple concurrency gate.
    while (this.active.size >= this.maxConcurrentUploads) {
      await new Promise((r) => setTimeout(r, 150));
      if (!this.tasks.has(taskId)) throw new Error("Upload cancelled");
    }
    this.active.add(taskId);
    this.queue = this.queue.filter((id) => id !== taskId);
    task.status = "uploading";
    task.startTime = Date.now();
    task.error = undefined;
    this.emit();

    try {
      // 1. Materialize the file as a Blob (works for file:// on native and blob:/http on web).
      const blob = task.source.blob ?? (await (await fetch(task.source.uri!)).blob());
      const contentType = guessMime(task.filename, task.source.mimeType || blob.type || undefined);
      task.fileSize = blob.size || task.fileSize;

      // 2. Presign under an owner-prefixed key.
      const init = await trpcClient.media.initUpload.mutate({
        fileName: task.filename,
        fileSize: Math.max(1, task.fileSize),
        fileType: task.mediaType === "video" ? "video" : "image",
        albumId: task.target.albumId,
        contentType,
      });
      task.uploadId = init.uploadId;
      task.storageKey = init.storageKey;
      this.emit();

      // 3. PUT directly to storage with progress.
      await this.putWithProgress(task, init.presignedUrl, blob, contentType, onProgress);

      // 3b. P5: generate + upload a thumbnail (best effort, never fails the upload).
      task.status = "processing";
      this.emit();
      let thumbnailKey: string | undefined;
      if (task.source.uri) {
        const thumb = await generateThumbnail(task.source.uri, task.mediaType, task.source.duration);
        if (thumb && !init.thumbnailPresignedUrl.startsWith("/")) {
          try {
            const put = await fetch(init.thumbnailPresignedUrl, {
              method: "PUT",
              headers: { "Content-Type": "image/jpeg" },
              body: thumb.blob,
            });
            if (put.ok) thumbnailKey = init.thumbnailKey;
          } catch (error) {
            console.warn("[upload] thumbnail PUT failed", error);
          }
        } else if (thumb) {
          // Dev fallback (storage unconfigured): record the key without a PUT.
          thumbnailKey = init.thumbnailKey;
        }
      }
      task.thumbnailKey = thumbnailKey;

      // 4. Register the object.
      const media = await trpcClient.media.completeUpload.mutate({
        uploadId: init.uploadId,
        fileName: task.filename,
        fileSize: Math.max(1, task.fileSize),
        fileType: task.mediaType === "video" ? "video" : "image",
        albumId: task.target.albumId,
        familyId: task.target.familyId,
        storageKey: init.storageKey,
        thumbnailKey,
        duration: task.source.duration ? Math.round(task.source.duration) : undefined,
        title: task.target.title,
        description: task.target.description,
      });

      task.mediaId = media.id;
      task.url = media.url;
      task.thumbnailUrl = media.thumbnail ?? media.url;
      task.status = "completed";
      task.progress = 100;
      task.uploadedSize = task.fileSize;
      task.endTime = Date.now();
      onProgress?.(this.progressOf(task));
      return task;
    } catch (error) {
      // Re-read via the map: cancelUpload() may have mutated status concurrently.
      const current = this.tasks.get(taskId)?.status as UploadStatus | undefined;
      if (current && current !== "cancelled") {
        task.status = "failed";
        task.error = error instanceof Error ? error.message : String(error);
        task.retryCount += 1;
      }
      throw error;
    } finally {
      this.active.delete(taskId);
      this.xhrs.delete(taskId);
      this.emit();
    }
  }

  private putWithProgress(
    task: UploadTask,
    url: string,
    blob: Blob,
    contentType: string,
    onProgress?: (p: UploadProgress) => void,
  ): Promise<void> {
    // Dev fallback: when storage isn't configured the server hands back the
    // proxy path instead of a presigned URL. Skip the PUT so the flow still
    // completes end-to-end locally.
    if (url.startsWith("/")) {
      task.progress = 100;
      task.uploadedSize = task.fileSize;
      onProgress?.(this.progressOf(task));
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.xhrs.set(task.id, xhr);
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        task.uploadedSize = e.loaded;
        task.fileSize = e.total || task.fileSize;
        task.progress = Math.min(99, Math.round((e.loaded / (e.total || 1)) * 100));
        onProgress?.(this.progressOf(task));
        this.emit();
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Storage PUT failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.send(blob);
    });
  }

  private progressOf(task: UploadTask): UploadProgress {
    const elapsed = Math.max(0.001, (Date.now() - task.startTime) / 1000);
    const speed = task.uploadedSize / elapsed;
    const remaining = Math.max(0, task.fileSize - task.uploadedSize);
    return {
      taskId: task.id,
      progress: task.progress,
      uploadedSize: task.uploadedSize,
      totalSize: task.fileSize,
      speed,
      estimatedTime: speed > 0 ? remaining / speed : 0,
      status: task.status,
    };
  }

  /* ------------------------------ control ----------------------------- */

  cancelUpload(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "cancelled";
    this.xhrs.get(taskId)?.abort();
    this.xhrs.delete(taskId);
    this.active.delete(taskId);
    this.queue = this.queue.filter((id) => id !== taskId);
    this.tasks.delete(taskId);
    this.emit();
  }

  async retry(taskId: string, onProgress?: (p: UploadProgress) => void): Promise<UploadTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Upload task not found: ${taskId}`);
    if (task.retryCount >= this.maxRetries) throw new Error("Max retries reached");
    task.status = "pending";
    task.progress = 0;
    task.uploadedSize = 0;
    this.queue.push(taskId);
    return this.startUpload(taskId, onProgress);
  }

  async retryFailed(onProgress?: (p: UploadProgress) => void): Promise<void> {
    const failed = [...this.tasks.values()].filter((t) => t.status === "failed" && t.retryCount < this.maxRetries);
    for (const task of failed) {
      try {
        await this.retry(task.id, onProgress);
      } catch (error) {
        console.error(`[upload] retry failed for ${task.id}`, error);
      }
    }
  }

  /* ------------------------------ queries ----------------------------- */

  getUploadTask(taskId: string) {
    return this.tasks.get(taskId);
  }
  getAllUploadTasks(): UploadTask[] {
    return [...this.tasks.values()];
  }
  getActiveUploads(): UploadTask[] {
    return [...this.active].map((id) => this.tasks.get(id)).filter((t): t is UploadTask => !!t);
  }
  getStats() {
    const tasks = [...this.tasks.values()];
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      active: this.active.size,
      queued: this.queue.length,
      totalSize: tasks.reduce((s, t) => s + t.fileSize, 0),
      uploadedSize: tasks.reduce((s, t) => s + t.uploadedSize, 0),
    };
  }
  clearCompleted(): void {
    for (const [id, t] of this.tasks) if (t.status === "completed") this.tasks.delete(id);
    this.emit();
  }
  clearAll(): void {
    for (const id of [...this.tasks.keys()]) this.cancelUpload(id);
  }
}

export const completeUploadManager = new CompleteUploadManager();
