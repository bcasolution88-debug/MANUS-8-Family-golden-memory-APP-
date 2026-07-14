import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 离线同步和缓存管理模块
 * 支持本地数据缓存、离线队列、后台同步等功能
 */

export interface SyncItem {
  id: string;
  type: "upload" | "comment" | "like" | "share";
  data: any;
  timestamp: number;
  status: "pending" | "synced" | "failed";
  retries: number;
}

export interface CacheEntry {
  key: string;
  data: any;
  timestamp: number;
  ttl?: number; // Time to live in milliseconds
}

const SYNC_QUEUE_KEY = "@golden_memory_sync_queue";
const CACHE_PREFIX = "@golden_memory_cache_";
const CACHE_INDEX_KEY = "@golden_memory_cache_index";

/**
 * 添加项目到离线同步队列
 */
export async function addToSyncQueue(item: Omit<SyncItem, "id" | "timestamp" | "status" | "retries">) {
  try {
    const queue = await getSyncQueue();
    const newItem: SyncItem = {
      ...item,
      id: `${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      status: "pending",
      retries: 0,
    };
    queue.push(newItem);
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    return newItem;
  } catch (error) {
    console.error("Failed to add to sync queue:", error);
    throw error;
  }
}

/**
 * 获取离线同步队列
 */
export async function getSyncQueue(): Promise<SyncItem[]> {
  try {
    const queue = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
    return queue ? JSON.parse(queue) : [];
  } catch (error) {
    console.error("Failed to get sync queue:", error);
    return [];
  }
}

/**
 * 标记同步项为已同步
 */
export async function markAsSynced(itemId: string) {
  try {
    const queue = await getSyncQueue();
    const index = queue.findIndex(item => item.id === itemId);
    if (index !== -1) {
      queue[index].status = "synced";
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (error) {
    console.error("Failed to mark as synced:", error);
    throw error;
  }
}

/**
 * 标记同步项为失败
 */
export async function markAsFailed(itemId: string, retries: number) {
  try {
    const queue = await getSyncQueue();
    const index = queue.findIndex(item => item.id === itemId);
    if (index !== -1) {
      queue[index].status = retries >= 3 ? "failed" : "pending";
      queue[index].retries = retries;
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (error) {
    console.error("Failed to mark as failed:", error);
    throw error;
  }
}

/**
 * 清空同步队列
 */
export async function clearSyncQueue() {
  try {
    await AsyncStorage.removeItem(SYNC_QUEUE_KEY);
  } catch (error) {
    console.error("Failed to clear sync queue:", error);
    throw error;
  }
}

/**
 * 缓存数据
 */
export async function cacheData(key: string, data: any, ttl?: number) {
  try {
    const cacheKey = `${CACHE_PREFIX}${key}`;
    const entry: CacheEntry = {
      key,
      data,
      timestamp: Date.now(),
      ttl,
    };
    await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));

    // 更新缓存索引
    const index = await getCacheIndex();
    if (!index.includes(key)) {
      index.push(key);
      await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    }
  } catch (error) {
    console.error("Failed to cache data:", error);
    throw error;
  }
}

/**
 * 获取缓存数据
 */
export async function getCachedData(key: string): Promise<any | null> {
  try {
    const cacheKey = `${CACHE_PREFIX}${key}`;
    const cached = await AsyncStorage.getItem(cacheKey);
    if (!cached) return null;

    const entry: CacheEntry = JSON.parse(cached);

    // 检查 TTL
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      await removeCachedData(key);
      return null;
    }

    return entry.data;
  } catch (error) {
    console.error("Failed to get cached data:", error);
    return null;
  }
}

/**
 * 移除缓存数据
 */
export async function removeCachedData(key: string) {
  try {
    const cacheKey = `${CACHE_PREFIX}${key}`;
    await AsyncStorage.removeItem(cacheKey);

    // 更新缓存索引
    const index = await getCacheIndex();
    const newIndex = index.filter(k => k !== key);
    await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(newIndex));
  } catch (error) {
    console.error("Failed to remove cached data:", error);
    throw error;
  }
}

/**
 * 获取缓存索引
 */
export async function getCacheIndex(): Promise<string[]> {
  try {
    const index = await AsyncStorage.getItem(CACHE_INDEX_KEY);
    return index ? JSON.parse(index) : [];
  } catch (error) {
    console.error("Failed to get cache index:", error);
    return [];
  }
}

/**
 * 清空所有缓存
 */
export async function clearAllCache() {
  try {
    const index = await getCacheIndex();
    const keys = index.map(key => `${CACHE_PREFIX}${key}`);
    keys.push(CACHE_INDEX_KEY);
    await AsyncStorage.multiRemove(keys);
  } catch (error) {
    console.error("Failed to clear all cache:", error);
    throw error;
  }
}

/**
 * 获取缓存大小（字节）
 */
export async function getCacheSize(): Promise<number> {
  try {
    const index = await getCacheIndex();
    let totalSize = 0;

    for (const key of index) {
      const cacheKey = `${CACHE_PREFIX}${key}`;
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        totalSize += cached.length;
      }
    }

    return totalSize;
  } catch (error) {
    console.error("Failed to get cache size:", error);
    return 0;
  }
}

/**
 * 获取待同步项的数量
 */
export async function getPendingSyncCount(): Promise<number> {
  try {
    const queue = await getSyncQueue();
    return queue.filter(item => item.status === "pending").length;
  } catch (error) {
    console.error("Failed to get pending sync count:", error);
    return 0;
  }
}

/**
 * 同步待处理项
 * 这个函数应该在网络恢复时被调用
 */
export async function syncPendingItems(syncFunction: (item: SyncItem) => Promise<void>) {
  try {
    const queue = await getSyncQueue();
    const pendingItems = queue.filter(item => item.status === "pending");

    for (const item of pendingItems) {
      try {
        await syncFunction(item);
        await markAsSynced(item.id);
      } catch (error) {
        console.error(`Failed to sync item ${item.id}:`, error);
        await markAsFailed(item.id, item.retries + 1);
      }
    }
  } catch (error) {
    console.error("Failed to sync pending items:", error);
    throw error;
  }
}

/**
 * 监听网络连接状态并自动同步
 */
export function setupAutoSync(syncFunction: (item: SyncItem) => Promise<void>) {
  // 这个函数应该与网络状态监听器集成
  // 当网络恢复时调用 syncPendingItems
  return () => {
    // 清理函数
  };
}
