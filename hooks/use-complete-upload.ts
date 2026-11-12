import { useCallback, useEffect, useState } from "react";

import {
  completeUploadManager,
  type UploadProgress,
  type UploadSource,
  type UploadTarget,
  type UploadTask,
} from "@/lib/complete-upload-manager";

/**
 * React binding for the upload manager (P4: real initUpload → PUT → completeUpload).
 * Subscribes to manager events instead of polling.
 */
export function useCompleteUpload() {
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>(completeUploadManager.getAllUploadTasks());
  const [activeUploads, setActiveUploads] = useState<UploadTask[]>(completeUploadManager.getActiveUploads());
  const [stats, setStats] = useState(completeUploadManager.getStats());

  useEffect(() => {
    const sync = () => {
      setUploadTasks(completeUploadManager.getAllUploadTasks());
      setActiveUploads(completeUploadManager.getActiveUploads());
      setStats(completeUploadManager.getStats());
    };
    return completeUploadManager.subscribe(sync);
  }, []);

  const createUploadTask = useCallback(
    (source: UploadSource, target: UploadTarget) => completeUploadManager.createUploadTask(source, target),
    [],
  );

  const startUpload = useCallback(
    (taskId: string, onProgress?: (p: UploadProgress) => void) => completeUploadManager.startUpload(taskId, onProgress),
    [],
  );

  /** Create + start. */
  const upload = useCallback(
    (source: UploadSource, target: UploadTarget, onProgress?: (p: UploadProgress) => void) =>
      completeUploadManager.upload(source, target, onProgress),
    [],
  );

  const retry = useCallback(
    (taskId: string, onProgress?: (p: UploadProgress) => void) => completeUploadManager.retry(taskId, onProgress),
    [],
  );

  const cancelUpload = useCallback((taskId: string) => completeUploadManager.cancelUpload(taskId), []);
  const clearCompleted = useCallback(() => completeUploadManager.clearCompleted(), []);

  return { uploadTasks, activeUploads, stats, createUploadTask, startUpload, upload, retry, cancelUpload, clearCompleted };
}
