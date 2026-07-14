import { useEffect, useState, useCallback } from "react";
import { mediaLibraryManager, MediaAsset, MediaAlbum, PermissionStatus } from "@/lib/media-library-manager";

export function useMediaLibrary() {
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [recentAssets, setRecentAssets] = useState<MediaAsset[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>(
    mediaLibraryManager.getPermissionStatus()
  );
  const [isLoading, setIsLoading] = useState(false);

  const requestPermission = useCallback(async () => {
    setIsLoading(true);
    try {
      const status = await mediaLibraryManager.requestPermission();
      setPermissionStatus(status);
      return status;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getAlbums = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetchedAlbums = await mediaLibraryManager.getAlbums();
      setAlbums(fetchedAlbums);
      return fetchedAlbums;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getAlbumAssets = useCallback(async (albumId: string, limit?: number) => {
    setIsLoading(true);
    try {
      return await mediaLibraryManager.getAlbumAssets(albumId, limit);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getRecentAssets = useCallback(async (limit?: number) => {
    setIsLoading(true);
    try {
      const assets = await mediaLibraryManager.getRecentAssets(limit);
      setRecentAssets(assets);
      return assets;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const searchAssets = useCallback(async (query: string, limit?: number) => {
    setIsLoading(true);
    try {
      return await mediaLibraryManager.searchAssets(query, limit);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getAsset = useCallback((assetId: string) => {
    return mediaLibraryManager.getAsset(assetId);
  }, []);

  const getAllCachedAssets = useCallback(() => {
    return mediaLibraryManager.getAllCachedAssets();
  }, []);

  const clearCache = useCallback(() => {
    mediaLibraryManager.clearCache();
    setAlbums([]);
    setRecentAssets([]);
  }, []);

  const getStats = useCallback(() => {
    return mediaLibraryManager.getStats();
  }, []);

  return {
    albums,
    recentAssets,
    permissionStatus,
    isLoading,
    requestPermission,
    getAlbums,
    getAlbumAssets,
    getRecentAssets,
    searchAssets,
    getAsset,
    getAllCachedAssets,
    clearCache,
    getStats,
  };
}
