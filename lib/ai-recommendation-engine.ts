/**
 * AI智能推荐模块
 * 基于相册数据推荐最佳分享时间和热门纪念日
 */

export interface TimeSlot {
  hour: number;
  dayOfWeek: number;
  engagementScore: number;
  recommendedContent: string;
}

export interface AnniversaryRecommendation {
  anniversaryId: string;
  type: string; // "golden" | "silver" | "diamond" | "birthday" | "wedding"
  daysUntil: number;
  urgencyScore: number;
  suggestedActions: string[];
  estimatedEngagement: number;
}

export interface ContentRecommendation {
  photoId: string;
  score: number;
  reason: string;
  suggestedCaption?: string;
  bestShareTime?: TimeSlot;
}

export interface UserBehaviorPattern {
  userId: string;
  activeHours: number[];
  preferredDays: number[];
  engagementPattern: Map<number, number>;
  contentPreferences: string[];
}

class AIRecommendationEngine {
  private timeSlotData: Map<number, TimeSlot> = new Map();
  private anniversaryData: Map<string, AnniversaryRecommendation> = new Map();
  private userBehaviors: Map<string, UserBehaviorPattern> = new Map();
  private contentScores: Map<string, ContentRecommendation> = new Map();

  /**
   * 分析最佳分享时间
   */
  analyzeBestShareTime(familyId: string): TimeSlot[] {
    const slots: TimeSlot[] = [];

    // 模拟分析最佳分享时间
    const bestTimes = [
      { hour: 9, dayOfWeek: 1, score: 0.85 }, // 周一早上9点
      { hour: 12, dayOfWeek: 3, score: 0.82 }, // 周三中午12点
      { hour: 19, dayOfWeek: 5, score: 0.88 }, // 周五晚上7点
      { hour: 10, dayOfWeek: 6, score: 0.90 }, // 周六早上10点
      { hour: 20, dayOfWeek: 0, score: 0.87 }, // 周日晚上8点
    ];

    for (const time of bestTimes) {
      const slot: TimeSlot = {
        hour: time.hour,
        dayOfWeek: time.dayOfWeek,
        engagementScore: time.score,
        recommendedContent: this.getRecommendedContentType(time.hour),
      };
      slots.push(slot);
      this.timeSlotData.set(time.hour * 10 + time.dayOfWeek, slot);
    }

    console.log(`Analyzed best share times for family: ${familyId}`);
    return slots;
  }

  /**
   * 获取推荐的内容类型
   */
  private getRecommendedContentType(hour: number): string {
    if (hour >= 6 && hour < 12) {
      return "早晨问候视频 / Morning greetings";
    } else if (hour >= 12 && hour < 14) {
      return "午间分享 / Lunch time shares";
    } else if (hour >= 14 && hour < 18) {
      return "下午更新 / Afternoon updates";
    } else if (hour >= 18 && hour < 22) {
      return "晚间家庭时光 / Evening family moments";
    } else {
      return "夜间回忆 / Night memories";
    }
  }

  /**
   * 推荐热门纪念日
   */
  recommendAnniversaries(familyId: string): AnniversaryRecommendation[] {
    const recommendations: AnniversaryRecommendation[] = [];

    // 模拟纪念日推荐
    const today = new Date();
    const anniversaries = [
      {
        id: "ann_001",
        type: "golden",
        date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30),
        name: "金婚纪念日",
      },
      {
        id: "ann_002",
        type: "silver",
        date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 15),
        name: "银婚纪念日",
      },
      {
        id: "ann_003",
        type: "birthday",
        date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7),
        name: "生日",
      },
    ];

    for (const ann of anniversaries) {
      const daysUntil = Math.ceil((ann.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const urgencyScore = Math.max(0, 1 - daysUntil / 90); // 90天内逐渐增加紧急度

      const recommendation: AnniversaryRecommendation = {
        anniversaryId: ann.id,
        type: ann.type,
        daysUntil,
        urgencyScore,
        suggestedActions: this.getSuggestedActions(ann.type, daysUntil),
        estimatedEngagement: 0.75 + Math.random() * 0.25,
      };

      recommendations.push(recommendation);
      this.anniversaryData.set(ann.id, recommendation);
    }

    console.log(`Recommended ${recommendations.length} anniversaries for family: ${familyId}`);
    return recommendations.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  /**
   * 获取建议的操作
   */
  private getSuggestedActions(type: string, daysUntil: number): string[] {
    const actions: string[] = [];

    if (daysUntil <= 7) {
      actions.push("制作纪念视频 / Create memorial video");
      actions.push("邀请家庭成员 / Invite family members");
    }

    if (daysUntil <= 14) {
      actions.push("收集照片和视频 / Collect photos and videos");
      actions.push("准备分享内容 / Prepare sharing content");
    }

    if (daysUntil <= 30) {
      actions.push("计划庆祝活动 / Plan celebration");
      actions.push("设置提醒 / Set reminders");
    }

    if (type === "golden" || type === "silver" || type === "diamond") {
      actions.push("制作专题相册 / Create special album");
      actions.push("编写爱情故事 / Write love story");
    }

    return actions;
  }

  /**
   * 推荐分享内容
   */
  recommendContent(familyId: string, limit: number = 5): ContentRecommendation[] {
    const recommendations: ContentRecommendation[] = [];

    // 模拟内容推荐
    for (let i = 0; i < limit; i++) {
      const recommendation: ContentRecommendation = {
        photoId: `photo_${Date.now()}_${i}`,
        score: 0.7 + Math.random() * 0.3,
        reason: this.getRecommendationReason(),
        suggestedCaption: this.generateCaption(),
        bestShareTime: this.getBestTimeSlot(),
      };

      recommendations.push(recommendation);
      this.contentScores.set(recommendation.photoId, recommendation);
    }

    console.log(`Recommended ${recommendations.length} content items for family: ${familyId}`);
    return recommendations.sort((a, b) => b.score - a.score);
  }

  /**
   * 获取推荐原因
   */
  private getRecommendationReason(): string {
    const reasons = [
      "高清晰度和美学评分 / High clarity and aesthetic score",
      "家庭成员互动多 / High family engagement",
      "最近上传的热门内容 / Recently trending content",
      "与纪念日相关 / Related to upcoming anniversary",
      "社交分享潜力高 / High social sharing potential",
    ];

    return reasons[Math.floor(Math.random() * reasons.length)];
  }

  /**
   * 生成建议的标题
   */
  private generateCaption(): string {
    const captions = [
      "美好时光永远值得分享 / Good times are always worth sharing",
      "家庭是最珍贵的回忆 / Family is the most precious memory",
      "让我们一起记录爱 / Let's record love together",
      "这一刻永远属于我们 / This moment belongs to us forever",
      "家庭的温暖在这里 / Family warmth is here",
    ];

    return captions[Math.floor(Math.random() * captions.length)];
  }

  /**
   * 获取最佳分享时间
   */
  private getBestTimeSlot(): TimeSlot {
    const slots = Array.from(this.timeSlotData.values());
    return slots.length > 0
      ? slots[Math.floor(Math.random() * slots.length)]
      : {
          hour: 19,
          dayOfWeek: 5,
          engagementScore: 0.85,
          recommendedContent: "晚间分享 / Evening share",
        };
  }

  /**
   * 分析用户行为模式
   */
  analyzeUserBehavior(userId: string, activities: any[]): UserBehaviorPattern {
    const pattern: UserBehaviorPattern = {
      userId,
      activeHours: [],
      preferredDays: [],
      engagementPattern: new Map(),
      contentPreferences: [],
    };

    // 模拟行为分析
    const hourCounts = new Map<number, number>();
    const dayCounts = new Map<number, number>();

    for (let i = 0; i < 24; i++) {
      hourCounts.set(i, Math.floor(Math.random() * 10));
    }

    for (let i = 0; i < 7; i++) {
      dayCounts.set(i, Math.floor(Math.random() * 20));
    }

    // 获取最活跃的小时
    pattern.activeHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour]) => hour);

    // 获取最活跃的日期
    pattern.preferredDays = Array.from(dayCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([day]) => day);

    pattern.engagementPattern = hourCounts;
    pattern.contentPreferences = ["照片 / Photos", "视频 / Videos", "故事 / Stories"];

    this.userBehaviors.set(userId, pattern);
    console.log(`User behavior analyzed: ${userId}`);

    return pattern;
  }

  /**
   * 获取推荐统计
   */
  getStats(): {
    timeSlots: number;
    anniversaries: number;
    contentRecommendations: number;
    userBehaviors: number;
  } {
    return {
      timeSlots: this.timeSlotData.size,
      anniversaries: this.anniversaryData.size,
      contentRecommendations: this.contentScores.size,
      userBehaviors: this.userBehaviors.size,
    };
  }

  /**
   * 清空数据
   */
  clearData(): void {
    this.timeSlotData.clear();
    this.anniversaryData.clear();
    this.userBehaviors.clear();
    this.contentScores.clear();
    console.log("AI recommendation data cleared");
  }
}

// 导出单例
export const aiRecommendationEngine = new AIRecommendationEngine();
