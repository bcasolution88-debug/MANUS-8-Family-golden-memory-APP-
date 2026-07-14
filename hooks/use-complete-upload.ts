import { useCallback, useState, useEffect } from "react";
import { completeUploadManager, UploadTask, UploadProgress } from "@/lib/complete-upload-manager";

export function useCompleteUpload() {
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>(
    completeUploadManager.getAllUploadTasks()
  );
  const [activeUploads, setActiveUploads] = useState<UploadTask[]>(
    completeUploadManager.getActiveUploads()
  );
  const [stats, setStats] = useState(completeUploadManager.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setUploadTasks(completeUploadManager.getAllUploadTasks());
      setActiveUploads(completeUploadManager.getActiveUploads());
      setStats(completeUploadManager.getStats());
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const createUploadTask = useCallback(
    (
      mediaId: string,
      filename: string,
      mediaType: "photo" | "video",
      fileSize: number,
      metadata?: Record<string, any>
    ) => {
      const task = completeUploadManager.createUploadTask(
        mediaId,
        filename,
        mediaType,
        fileSize,
        metadata
      );
      setUploadTasks(completeUploadManager.getAllUploadTasks());
      return task;
    },
    []
  );

  const startUpload = useCallback(
    async (
      taskId: string,
      fileData: ArrayBuffer,
      onProgress?: (progress: UploadProgress) => void
    ) => {
      try {
        const task = await completeUploadManager.startUpload(taskId, fileData, onProgress);
        setUploadTasks(completeUploadManager.getAllUploadTasks());
        setActiveUploads(completeUploadManager.getActiveUploads());
        setStats(completeUploadManager.getStats());
        return task;
      } catch (error) {
        console.error("Upload failed:", error);
        throw error;
      }
    },
    []
  );

  const pauseUpload = useCallback((taskId: string) => {
    completeUploadManager.pauseUpload(taskId);
    setUploadTasks(completeUploadManager.getAllUploadTasks());
    setActiveUploads(completeUploadManager.getActiveUploads());
  }, []);

  const resumeUpload = useCallback(
    async (
      taskId: string,
      fileData: ArrayBuffer,
      onProgress?: (progress: UploadProgress) => void
    ) => {
      try {
        const task = await completeUploadManager.resumeUpload(taskId, fileData, onProgress);
        setUploadTasks(completeUploadManager.getAllUploadTasks());
        setActiveUploads(completeUploadManager.getActiveUploads());
        return task;
      } catch (error) {
        console.error("Resume failed:", error);
        throw error;
      }
    },
    []
  );

  const cancelUpload = useCallback((taskId: string) => {
    completeUploadManager.cancelUpload(taskId);
    setUploadTasks(completeUploadManager.getAllUploadTasks());
    setActiveUploads(completeUploadManager.getActiveUploads());
    setStats(completeUploadManager.getStats());
  }, []);

  const clearCompleted = useCallback(() => {
    completeUploadManager.clearCompleted();
    setUploadTasks(completeUploadManager.getAllUploadTasks());
    setStats(completeUploadManager.getStats());
  }, []);

  return {
    uploadTasks,
    activeUploads,
    stats,
    createUploadTask,
    startUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    clearCompleted,
  };
}
