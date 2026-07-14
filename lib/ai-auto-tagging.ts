/**
 * AI自动标签和推荐系统
 * 支持自动识别人物、推荐标签、一键应用建议
 */

export interface AutoTaggingSuggestion {
  id: string;
  mediaId: string;
  detectedPeople: PersonDetection[];
  suggestedTags: SuggestedTag[];
  suggestedCategory: string;
  confidence: number;
  timestamp: number;
}

export interface PersonDetection {
  id: string;
  name?: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  faceEncoding?: string;
}

export interface SuggestedTag {
  tag: string;
  confidence: number;
  category: "person" | "object" | "scene" | "emotion" | "event" | "location";
  icon?: string;
}

export interface TagApplicationResult {
  mediaId: string;
  appliedTags: string[];
  appliedPeople: string[];
  appliedCategory: string;
  timestamp: number;
}

class AIAutoTagging {
  private suggestions: Map<string, AutoTaggingSuggestion> = new Map();
  private appliedTags: Map<string, TagApplicationResult> = new Map();
  private personDatabase: Map<string, string> = new Map(); // faceEncoding -> personName
  private tagPreferences: Map<string, number> = new Map(); // tag -> usage count

  /**
   * 分析上传的媒体并生成建议
   */
  async analyzeMedia(
    mediaId: string,
    mediaUri: string,
    mediaType: "photo" | "video"
  ): Promise<AutoTaggingSuggestion> {
    try {
      console.log(`Analyzing ${mediaType}: ${mediaId}`);

      // 模拟分析过程
      await new Promise(resolve => setTimeout(resolve, 1500));

      const suggestion: AutoTaggingSuggestion = {
        id: `suggestion_${Date.now()}`,
        mediaId,
        detectedPeople: await this.detectPeople(mediaUri),
        suggestedTags: await this.generateSuggestedTags(mediaUri, mediaType),
        suggestedCategory: await this.suggestCategory(mediaUri),
        confidence: 0.87,
        timestamp: Date.now(),
      };

      this.suggestions.set(mediaId, suggestion);
      return suggestion;
    } catch (error) {
      console.error("Failed to analyze media:", error);
      throw error;
    }
  }

  /**
   * 检测媒体中的人物
   */
  private async detectPeople(mediaUri: string): Promise<PersonDetection[]> {
    // 模拟人物检测
    await new Promise(resolve => setTimeout(resolve, 800));

    const mockPeople: PersonDetection[] = [
      {
        id: `person_${Date.now()}_1`,
        name: "Unknown",
        confidence: 0.92,
        boundingBox: {
          x: 100,
          y: 100,
          width: 150,
          height: 200,
        },
      },
      {
        id: `person_${Date.now()}_2`,
        name: "Unknown",
        confidence: 0.85,
        boundingBox: {
          x: 350,
          y: 120,
          width: 140,
          height: 190,
        },
      },
    ];

    return mockPeople;
  }

  /**
   * 生成建议标签
   */
  private async generateSuggestedTags(
    mediaUri: string,
    mediaType: "photo" | "video"
  ): Promise<SuggestedTag[]> {
    // 模拟标签生成
    await new Promise(resolve => setTimeout(resolve, 600));

    const mockTags: SuggestedTag[] = [
      {
        tag: "family",
        confidence: 0.96,
        category: "event",
        icon: "👨‍👩‍👧‍👦",
      },
      {
        tag: "celebration",
        confidence: 0.91,
        category: "event",
        icon: "🎉",
      },
      {
        tag: "outdoor",
        confidence: 0.88,
        category: "scene",
        icon: "🌳",
      },
      {
        tag: "happy",
        confidence: 0.85,
        category: "emotion",
        icon: "😊",
      },
      {
        tag: "sunset",
        confidence: 0.79,
        category: "scene",
        icon: "🌅",
      },
    ];

    return mockTags;
  }

  /**
   * 建议分类
   */
  private async suggestCategory(mediaUri: string): Promise<string> {
    // 模拟分类建议
    await new Promise(resolve => setTimeout(resolve, 300));

    const categories = ["family", "memories", "celebration", "daily"];
    return categories[Math.floor(Math.random() * categories.length)];
  }

  /**
   * 获取建议
   */
  getSuggestion(mediaId: string): AutoTaggingSuggestion | undefined {
    return this.suggestions.get(mediaId);
  }

  /**
   * 一键应用所有建议
   */
  applyAllSuggestions(mediaId: string): TagApplicationResult | null {
    const suggestion = this.suggestions.get(mediaId);
    if (!suggestion) return null;

    const appliedTags = suggestion.suggestedTags.map(t => t.tag);
    const appliedPeople = suggestion.detectedPeople
      .map(p => p.name || `Person ${p.id}`)
      .filter(n => n !== "Unknown");

    const result: TagApplicationResult = {
      mediaId,
      appliedTags,
      appliedPeople,
      appliedCategory: suggestion.suggestedCategory,
      timestamp: Date.now(),
    };

    this.appliedTags.set(mediaId, result);

    // 更新标签偏好
    appliedTags.forEach(tag => {
      this.tagPreferences.set(tag, (this.tagPreferences.get(tag) || 0) + 1);
    });

    console.log(`Applied suggestions for media: ${mediaId}`);
    return result;
  }

  /**
   * 应用部分建议
   */
  applyPartialSuggestions(
    mediaId: string,
    selectedTags: string[],
    selectedPeople: string[]
  ): TagApplicationResult | null {
    const suggestion = this.suggestions.get(mediaId);
    if (!suggestion) return null;

    const result: TagApplicationResult = {
      mediaId,
      appliedTags: selectedTags,
      appliedPeople: selectedPeople,
      appliedCategory: suggestion.suggestedCategory,
      timestamp: Date.now(),
    };

    this.appliedTags.set(mediaId, result);

    // 更新标签偏好
    selectedTags.forEach(tag => {
      this.tagPreferences.set(tag, (this.tagPreferences.get(tag) || 0) + 1);
    });

    console.log(`Applied partial suggestions for media: ${mediaId}`);
    return result;
  }

  /**
   * 拒绝建议
   */
  rejectSuggestion(mediaId: string): void {
    this.suggestions.delete(mediaId);
    console.log(`Rejected suggestion for media: ${mediaId}`);
  }

  /**
   * 关联人物身份
   */
  linkPersonIdentity(faceEncoding: string, personName: string): void {
    this.personDatabase.set(faceEncoding, personName);
    console.log(`Linked person: ${personName}`);
  }

  /**
   * 获取应用结果
   */
  getApplicationResult(mediaId: string): TagApplicationResult | undefined {
    return this.appliedTags.get(mediaId);
  }

  /**
   * 获取常用标签
   */
  getFrequentTags(limit: number = 10): string[] {
    return Array.from(this.tagPreferences.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
  }

  /**
   * 获取所有建议
   */
  getAllSuggestions(): AutoTaggingSuggestion[] {
    return Array.from(this.suggestions.values());
  }

  /**
   * 获取应用统计
   */
  getApplicationStats(): {
    totalSuggestions: number;
    appliedSuggestions: number;
    rejectedSuggestions: number;
    totalTagsApplied: number;
    totalPeopleIdentified: number;
  } {
    const appliedCount = this.appliedTags.size;
    const rejectedCount = this.suggestions.size - appliedCount;
    let totalTagsApplied = 0;
    let totalPeopleIdentified = 0;

    this.appliedTags.forEach(result => {
      totalTagsApplied += result.appliedTags.length;
      totalPeopleIdentified += result.appliedPeople.length;
    });

    return {
      totalSuggestions: this.suggestions.size,
      appliedSuggestions: appliedCount,
      rejectedSuggestions: rejectedCount,
      totalTagsApplied,
      totalPeopleIdentified,
    };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.suggestions.clear();
    this.appliedTags.clear();
    console.log("Auto-tagging cache cleared");
  }
}

// 导出单例
export const aiAutoTagging = new AIAutoTagging();
