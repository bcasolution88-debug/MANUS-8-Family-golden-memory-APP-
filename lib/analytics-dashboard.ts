/**
 * 可视化数据统计面板系统
 * 展示家庭相册的云端存储空间使用情况、成员活跃度以及分享卡片的互动数据
 */

export interface StorageStats {
  totalUsed: number; // 字节
  totalQuota: number; // 字节
  photosSize: number;
  videosSize: number;
  storiesSize: number;
  usagePercentage: number;
}

export interface MemberActivity {
  userId: string;
  userName: string;
  uploadCount: number;
  commentCount: number;
  likeCount: number;
  shareCount: number;
  lastActive: number;
  activityScore: number;
}

export interface ShareMetrics {
  cardId: string;
  title: string;
  views: number;
  clicks: number;
  shares: number;
  conversions: number;
  ctr: number; // 点击率
  conversionRate: number;
}

export interface FamilyAnalytics {
  familyId: string;
  totalMembers: number;
  activeMembers: number;
  totalPhotos: number;
  totalVideos: number;
  totalStories: number;
  totalComments: number;
  totalLikes: number;
  totalShares: number;
  averageEngagement: number;
}

export interface TimeSeriesData {
  timestamp: number;
  value: number;
  label: string;
}

class AnalyticsDashboard {
  private storageStats: Map<string, StorageStats> = new Map();
  private memberActivities: Map<string, MemberActivity[]> = new Map();
  private shareMetrics: Map<string, ShareMetrics[]> = new Map();
  private familyAnalytics: Map<string, FamilyAnalytics> = new Map();
  private activityTimeSeries: Map<string, TimeSeriesData[]> = new Map();

  /**
   * 更新存储统计
   */
  updateStorageStats(familyId: string, stats: StorageStats): void {
    this.storageStats.set(familyId, stats);
    console.log(`Storage stats updated for family: ${familyId}`);
  }

  /**
   * 获取存储统计
   */
  getStorageStats(familyId: string): StorageStats | undefined {
    return this.storageStats.get(familyId);
  }

  /**
   * 更新成员活跃度
   */
  updateMemberActivity(familyId: string, activity: MemberActivity): void {
    if (!this.memberActivities.has(familyId)) {
      this.memberActivities.set(familyId, []);
    }

    const activities = this.memberActivities.get(familyId)!;
    const index = activities.findIndex(a => a.userId === activity.userId);

    if (index >= 0) {
      activities[index] = activity;
    } else {
      activities.push(activity);
    }

    console.log(`Member activity updated: ${activity.userId}`);
  }

  /**
   * 获取成员活跃度排行
   */
  getMemberActivityRanking(familyId: string, limit: number = 10): MemberActivity[] {
    const activities = this.memberActivities.get(familyId) || [];
    return activities
      .sort((a, b) => b.activityScore - a.activityScore)
      .slice(0, limit);
  }

  /**
   * 获取所有成员活跃度
   */
  getAllMemberActivities(familyId: string): MemberActivity[] {
    return this.memberActivities.get(familyId) || [];
  }

  /**
   * 更新分享指标
   */
  updateShareMetrics(familyId: string, metrics: ShareMetrics): void {
    if (!this.shareMetrics.has(familyId)) {
      this.shareMetrics.set(familyId, []);
    }

    const metricsArray = this.shareMetrics.get(familyId)!;
    const index = metricsArray.findIndex(m => m.cardId === metrics.cardId);

    if (index >= 0) {
      metricsArray[index] = metrics;
    } else {
      metricsArray.push(metrics);
    }

    console.log(`Share metrics updated: ${metrics.cardId}`);
  }

  /**
   * 获取分享指标排行
   */
  getTopShareMetrics(familyId: string, limit: number = 10): ShareMetrics[] {
    const metrics = this.shareMetrics.get(familyId) || [];
    return metrics
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);
  }

  /**
   * 获取所有分享指标
   */
  getAllShareMetrics(familyId: string): ShareMetrics[] {
    return this.shareMetrics.get(familyId) || [];
  }

  /**
   * 更新家庭分析数据
   */
  updateFamilyAnalytics(analytics: FamilyAnalytics): void {
    this.familyAnalytics.set(analytics.familyId, analytics);
    console.log(`Family analytics updated: ${analytics.familyId}`);
  }

  /**
   * 获取家庭分析数据
   */
  getFamilyAnalytics(familyId: string): FamilyAnalytics | undefined {
    return this.familyAnalytics.get(familyId);
  }

  /**
   * 添加时间序列数据
   */
  addTimeSeriesData(familyId: string, data: TimeSeriesData): void {
    if (!this.activityTimeSeries.has(familyId)) {
      this.activityTimeSeries.set(familyId, []);
    }

    this.activityTimeSeries.get(familyId)!.push(data);
    console.log(`Time series data added: ${familyId}`);
  }

  /**
   * 获取时间序列数据
   */
  getTimeSeriesData(familyId: string, days: number = 30): TimeSeriesData[] {
    const allData = this.activityTimeSeries.get(familyId) || [];
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    return allData.filter(d => d.timestamp >= cutoffTime);
  }

  /**
   * 生成仪表板总结
   */
  generateDashboardSummary(familyId: string): {
    storage: StorageStats | undefined;
    topMembers: MemberActivity[];
    topShares: ShareMetrics[];
    familyStats: FamilyAnalytics | undefined;
    recentActivity: TimeSeriesData[];
  } {
    return {
      storage: this.getStorageStats(familyId),
      topMembers: this.getMemberActivityRanking(familyId, 5),
      topShares: this.getTopShareMetrics(familyId, 5),
      familyStats: this.getFamilyAnalytics(familyId),
      recentActivity: this.getTimeSeriesData(familyId, 7),
    };
  }

  /**
   * 计算参与度指数
   */
  calculateEngagementIndex(familyId: string): number {
    const analytics = this.getFamilyAnalytics(familyId);
    if (!analytics) {
      return 0;
    }

    const totalInteractions =
      analytics.totalComments + analytics.totalLikes + analytics.totalShares;
    const totalContent = analytics.totalPhotos + analytics.totalVideos + analytics.totalStories;

    if (totalContent === 0) {
      return 0;
    }

    return Math.round((totalInteractions / (totalContent * analytics.totalMembers)) * 100);
  }

  /**
   * 获取存储使用趋势
   */
  getStorageTrend(familyId: string): {
    current: number;
    previous: number;
    trend: number; // 百分比变化
  } {
    const stats = this.getStorageStats(familyId);
    if (!stats) {
      return { current: 0, previous: 0, trend: 0 };
    }

    // 模拟之前的数据
    const previous = stats.totalUsed * 0.85;
    const trend = ((stats.totalUsed - previous) / previous) * 100;

    return {
      current: stats.totalUsed,
      previous,
      trend,
    };
  }

  /**
   * 获取成员增长趋势
   */
  getMemberGrowthTrend(familyId: string): {
    current: number;
    previous: number;
    trend: number;
  } {
    const analytics = this.getFamilyAnalytics(familyId);
    if (!analytics) {
      return { current: 0, previous: 0, trend: 0 };
    }

    // 模拟之前的数据
    const previous = Math.max(1, analytics.totalMembers - 1);
    const trend = ((analytics.totalMembers - previous) / previous) * 100;

    return {
      current: analytics.totalMembers,
      previous,
      trend,
    };
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    familiesTracked: number;
    totalStorageTracked: number;
    totalMembersTracked: number;
  } {
    let totalStorage = 0;
    let totalMembers = 0;

    for (const stats of this.storageStats.values()) {
      totalStorage += stats.totalUsed;
    }

    for (const activities of this.memberActivities.values()) {
      totalMembers += activities.length;
    }

    return {
      familiesTracked: this.familyAnalytics.size,
      totalStorageTracked: totalStorage,
      totalMembersTracked: totalMembers,
    };
  }

  /**
   * 清空数据
   */
  clearData(): void {
    this.storageStats.clear();
    this.memberActivities.clear();
    this.shareMetrics.clear();
    this.familyAnalytics.clear();
    this.activityTimeSeries.clear();
    console.log("Analytics data cleared");
  }
}

// 导出单例
export const analyticsDashboard = new AnalyticsDashboard();
