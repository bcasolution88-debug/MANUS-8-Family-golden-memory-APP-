import { useCallback, useState } from "react";
import {
  analyticsDashboard,
  StorageStats,
  MemberActivity,
  ShareMetrics,
  FamilyAnalytics,
} from "@/lib/analytics-dashboard";

export function useAnalyticsDashboard() {
  const [stats, setStats] = useState(analyticsDashboard.getStats());

  const updateStorageStats = useCallback((familyId: string, storageStats: StorageStats) => {
    analyticsDashboard.updateStorageStats(familyId, storageStats);
    setStats(analyticsDashboard.getStats());
  }, []);

  const getStorageStats = useCallback((familyId: string) => {
    return analyticsDashboard.getStorageStats(familyId);
  }, []);

  const updateMemberActivity = useCallback((familyId: string, activity: MemberActivity) => {
    analyticsDashboard.updateMemberActivity(familyId, activity);
    setStats(analyticsDashboard.getStats());
  }, []);

  const getMemberActivityRanking = useCallback((familyId: string, limit?: number) => {
    return analyticsDashboard.getMemberActivityRanking(familyId, limit);
  }, []);

  const getAllMemberActivities = useCallback((familyId: string) => {
    return analyticsDashboard.getAllMemberActivities(familyId);
  }, []);

  const updateShareMetrics = useCallback((familyId: string, metrics: ShareMetrics) => {
    analyticsDashboard.updateShareMetrics(familyId, metrics);
    setStats(analyticsDashboard.getStats());
  }, []);

  const getTopShareMetrics = useCallback((familyId: string, limit?: number) => {
    return analyticsDashboard.getTopShareMetrics(familyId, limit);
  }, []);

  const getAllShareMetrics = useCallback((familyId: string) => {
    return analyticsDashboard.getAllShareMetrics(familyId);
  }, []);

  const updateFamilyAnalytics = useCallback((analytics: FamilyAnalytics) => {
    analyticsDashboard.updateFamilyAnalytics(analytics);
    setStats(analyticsDashboard.getStats());
  }, []);

  const getFamilyAnalytics = useCallback((familyId: string) => {
    return analyticsDashboard.getFamilyAnalytics(familyId);
  }, []);

  const generateDashboardSummary = useCallback((familyId: string) => {
    return analyticsDashboard.generateDashboardSummary(familyId);
  }, []);

  const calculateEngagementIndex = useCallback((familyId: string) => {
    return analyticsDashboard.calculateEngagementIndex(familyId);
  }, []);

  const getStorageTrend = useCallback((familyId: string) => {
    return analyticsDashboard.getStorageTrend(familyId);
  }, []);

  const getMemberGrowthTrend = useCallback((familyId: string) => {
    return analyticsDashboard.getMemberGrowthTrend(familyId);
  }, []);

  return {
    stats,
    updateStorageStats,
    getStorageStats,
    updateMemberActivity,
    getMemberActivityRanking,
    getAllMemberActivities,
    updateShareMetrics,
    getTopShareMetrics,
    getAllShareMetrics,
    updateFamilyAnalytics,
    getFamilyAnalytics,
    generateDashboardSummary,
    calculateEngagementIndex,
    getStorageTrend,
    getMemberGrowthTrend,
  };
}
