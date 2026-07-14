import { useCallback, useState, useEffect } from "react";
import { realStorageIntegration, MediaAsset, S3Config } from "@/lib/real-storage-integration";

export function useRealStorageIntegration() {
  const [albums, setAlbums] = useState<Array<{ id: string; title: string; assetCount: number }>>(
    []
  );
  const [currentAlbumMedia, setCurrentAlbumMedia] = useState<MediaAsset[]>([]);
  const [stats, setStats] = useState(realStorageIntegration.getStats());
  const [loading, setLoading] = useState(false);

  const initializeS3 = useCallback((config: S3Config) => {
    realStorageIntegration.initializeS3(config);
    setStats(realStorageIntegration.getStats());
  }, []);

  const requestPermission = useCallback(async () => {
    setLoading(true);
    try {
      const granted = await realStorageIntegration.requestMediaLibraryPermission();
      setStats(realStorageIntegration.getStats());
      return granted;
    } finally {
      setLoading(false);
    }
  }, []);

  const getAlbums = useCallback(async () => {
    setLoading(true);
    try {
      const albumList = await realStorageIntegration.getDeviceAlbums();
      setAlbums(albumList);
      return albumList;
    } finally {
      setLoading(false);
    }
  }, []);

  const getAlbumMedia = useCallback(
    async (albumId: string, limit: number = 50, offset: number = 0) => {
      setLoading(true);
      try {
        const media = await realStorageIntegration.getAlbumMedia(albumId, limit, offset);
        setCurrentAlbumMedia(media);
        return media;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const uploadToS3 = useCallback(
    async (asset: MediaAsset, fileData: ArrayBuffer) => {
      setLoading(true);
      try {
        const url = await realStorageIntegration.uploadToS3(asset, fileData);
        setStats(realStorageIntegration.getStats());
        return url;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const batchUploadToS3 = useCallback(
    async (assets: MediaAsset[], fileDataMap: Map<string, ArrayBuffer>) => {
      setLoading(true);
      try {
        const results = await realStorageIntegration.batchUploadToS3(assets, fileDataMap);
        setStats(realStorageIntegration.getStats());
        return results;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const deleteFromS3 = useCallback(async (key: string) => {
    setLoading(true);
    try {
      await realStorageIntegration.deleteFromS3(key);
      setStats(realStorageIntegration.getStats());
    } finally {
      setLoading(false);
    }
  }, []);

  const getUploadedAsset = useCallback((assetId: string) => {
    return realStorageIntegration.getUploadedAsset(assetId);
  }, []);

  return {
    albums,
    currentAlbumMedia,
    stats,
    loading,
    initializeS3,
    requestPermission,
    getAlbums,
    getAlbumMedia,
    uploadToS3,
    batchUploadToS3,
    deleteFromS3,
    getUploadedAsset,
  };
}
