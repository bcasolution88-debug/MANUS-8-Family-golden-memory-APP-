/**
 * 家庭相册模板库管理模块
 * 支持纪念日主题模板、视频模板、相册排版模板
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  category: "anniversary" | "video" | "layout" | "theme";
  subcategory?: string;
  thumbnail: string;
  preview?: string;
  colors: string[];
  fonts?: string[];
  elements: TemplateElement[];
  metadata: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateElement {
  id: string;
  type: "image" | "text" | "shape" | "video" | "music";
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  properties: Record<string, any>;
  animations?: Animation[];
}

export interface Animation {
  type: "fade" | "slide" | "zoom" | "rotate" | "bounce";
  duration: number;
  delay: number;
  easing: string;
}

export interface AnniversaryTemplate extends Template {
  category: "anniversary";
  subcategory: "golden" | "silver" | "diamond" | "ruby" | "pearl";
  yearsMarked: number;
  specialFeatures: string[];
}

export interface VideoTemplate extends Template {
  category: "video";
  duration: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  transitions: string[];
  musicSuggestions?: string[];
}

export interface LayoutTemplate extends Template {
  category: "layout";
  gridLayout: {
    columns: number;
    rows: number;
    spacing: number;
  };
  supportedMediaCount: number;
}

class TemplateLibrary {
  private templates: Map<string, Template> = new Map();
  private favoriteTemplates: Set<string> = new Set();

  constructor() {
    this.initializeTemplates();
  }

  /**
   * 初始化模板库
   */
  private initializeTemplates(): void {
    // 纪念日模板
    const anniversaryTemplates: AnniversaryTemplate[] = [
      {
        id: "golden_anniversary_1",
        name: "Golden Celebration",
        description: "Elegant golden wedding anniversary template",
        category: "anniversary",
        subcategory: "golden",
        yearsMarked: 50,
        specialFeatures: ["Gold accents", "Elegant typography", "Photo timeline"],
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#FFD700", "#FFFFFF", "#8B7500"],
        elements: [],
        metadata: { style: "elegant", complexity: "medium" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "silver_anniversary_1",
        name: "Silver Memories",
        description: "Sophisticated silver wedding anniversary template",
        category: "anniversary",
        subcategory: "silver",
        yearsMarked: 25,
        specialFeatures: ["Silver elegance", "Photo gallery", "Timeline"],
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#C0C0C0", "#FFFFFF", "#696969"],
        elements: [],
        metadata: { style: "sophisticated", complexity: "medium" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "diamond_anniversary_1",
        name: "Diamond Sparkle",
        description: "Luxurious diamond wedding anniversary template",
        category: "anniversary",
        subcategory: "diamond",
        yearsMarked: 60,
        specialFeatures: ["Diamond patterns", "Luxury design", "Premium fonts"],
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#B9F2FF", "#FFFFFF", "#4A90E2"],
        elements: [],
        metadata: { style: "luxury", complexity: "high" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    // 视频模板
    const videoTemplates: VideoTemplate[] = [
      {
        id: "video_montage_1",
        name: "Family Montage",
        description: "Fast-paced family moments montage",
        category: "video",
        duration: 60,
        aspectRatio: "16:9",
        transitions: ["fade", "slide", "zoom"],
        musicSuggestions: ["upbeat", "cheerful"],
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#FF6B6B", "#4ECDC4", "#FFE66D"],
        elements: [],
        metadata: { style: "modern", pacing: "fast" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "video_slideshow_1",
        name: "Elegant Slideshow",
        description: "Slow, elegant photo slideshow",
        category: "video",
        duration: 120,
        aspectRatio: "16:9",
        transitions: ["fade", "dissolve"],
        musicSuggestions: ["romantic", "classical"],
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#2C3E50", "#ECF0F1", "#3498DB"],
        elements: [],
        metadata: { style: "elegant", pacing: "slow" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    // 相册排版模板
    const layoutTemplates: LayoutTemplate[] = [
      {
        id: "layout_grid_2x2",
        name: "2x2 Grid",
        description: "Simple 2x2 photo grid layout",
        category: "layout",
        gridLayout: {
          columns: 2,
          rows: 2,
          spacing: 8,
        },
        supportedMediaCount: 4,
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#FFFFFF", "#F5F5F5"],
        elements: [],
        metadata: { complexity: "simple" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "layout_grid_3x3",
        name: "3x3 Grid",
        description: "Classic 3x3 photo grid layout",
        category: "layout",
        gridLayout: {
          columns: 3,
          rows: 3,
          spacing: 4,
        },
        supportedMediaCount: 9,
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#FFFFFF", "#F0F0F0"],
        elements: [],
        metadata: { complexity: "simple" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "layout_masonry",
        name: "Masonry Layout",
        description: "Dynamic masonry photo layout",
        category: "layout",
        gridLayout: {
          columns: 3,
          rows: 0,
          spacing: 6,
        },
        supportedMediaCount: 999,
        thumbnail: "https://via.placeholder.com/200",
        colors: ["#FFFFFF", "#FAFAFA"],
        elements: [],
        metadata: { complexity: "medium" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    // 添加所有模板到库
    [...anniversaryTemplates, ...videoTemplates, ...layoutTemplates].forEach(template => {
      this.templates.set(template.id, template);
    });

    console.log(`Template library initialized with ${this.templates.size} templates`);
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): Template[] {
    return Array.from(this.templates.values());
  }

  /**
   * 按类别获取模板
   */
  getTemplatesByCategory(category: Template["category"]): Template[] {
    return Array.from(this.templates.values()).filter(t => t.category === category);
  }

  /**
   * 按子类别获取模板
   */
  getTemplatesBySubcategory(subcategory: string): Template[] {
    return Array.from(this.templates.values()).filter(t => t.subcategory === subcategory);
  }

  /**
   * 获取单个模板
   */
  getTemplate(templateId: string): Template | undefined {
    return this.templates.get(templateId);
  }

  /**
   * 搜索模板
   */
  searchTemplates(query: string): Template[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.templates.values()).filter(
      t =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 添加到收藏
   */
  addToFavorites(templateId: string): void {
    this.favoriteTemplates.add(templateId);
    console.log(`Template added to favorites: ${templateId}`);
  }

  /**
   * 从收藏移除
   */
  removeFromFavorites(templateId: string): void {
    this.favoriteTemplates.delete(templateId);
    console.log(`Template removed from favorites: ${templateId}`);
  }

  /**
   * 获取收藏的模板
   */
  getFavoriteTemplates(): Template[] {
    return Array.from(this.favoriteTemplates)
      .map(id => this.templates.get(id))
      .filter((t): t is Template => t !== undefined);
  }

  /**
   * 检查是否收藏
   */
  isFavorite(templateId: string): boolean {
    return this.favoriteTemplates.has(templateId);
  }

  /**
   * 获取推荐模板
   */
  getRecommendedTemplates(count: number = 5): Template[] {
    const all = Array.from(this.templates.values());
    return all.sort(() => Math.random() - 0.5).slice(0, count);
  }

  /**
   * 获取纪念日模板
   */
  getAnniversaryTemplates(): AnniversaryTemplate[] {
    return this.getTemplatesByCategory("anniversary") as AnniversaryTemplate[];
  }

  /**
   * 获取特定纪念日的模板
   */
  getTemplateForAnniversary(yearsMarked: number): AnniversaryTemplate | undefined {
    const templates = this.getAnniversaryTemplates();

    // 根据年数选择合适的模板
    if (yearsMarked >= 60) {
      return templates.find(t => t.subcategory === "diamond");
    } else if (yearsMarked >= 50) {
      return templates.find(t => t.subcategory === "golden");
    } else if (yearsMarked >= 25) {
      return templates.find(t => t.subcategory === "silver");
    }

    return templates[0];
  }

  /**
   * 克隆模板
   */
  cloneTemplate(templateId: string, newName: string): Template | undefined {
    const original = this.templates.get(templateId);
    if (!original) return undefined;

    const cloned: Template = {
      ...original,
      id: `${templateId}_clone_${Date.now()}`,
      name: newName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.templates.set(cloned.id, cloned);
    return cloned;
  }

  /**
   * 获取模板统计
   */
  getTemplateStats(): {
    totalTemplates: number;
    byCategory: Record<string, number>;
    favoriteCount: number;
  } {
    const byCategory: Record<string, number> = {};

    this.templates.forEach(template => {
      byCategory[template.category] = (byCategory[template.category] || 0) + 1;
    });

    return {
      totalTemplates: this.templates.size,
      byCategory,
      favoriteCount: this.favoriteTemplates.size,
    };
  }
}

// 导出单例
export const templateLibrary = new TemplateLibrary();
