/**
 * 分享卡片生成器模块
 * 支持动态卡片生成、二维码、社交媒体预览、邀请链接
 */

export interface ShareCard {
  id: string;
  type: "album" | "anniversary" | "video" | "memory" | "family";
  title: string;
  description: string;
  coverImage?: string;
  backgroundColor: string;
  textColor: string;
  metadata: Record<string, any>;
  generatedAt: number;
}

export interface ShareLink {
  id: string;
  shortUrl: string;
  fullUrl: string;
  qrCode: string;
  expiresAt?: number;
  accessCount: number;
  createdAt: number;
}

export interface SocialMediaPreview {
  platform: "facebook" | "instagram" | "twitter" | "whatsapp" | "wechat";
  title: string;
  description: string;
  image: string;
  url: string;
}

export interface InviteLink {
  id: string;
  familyId: string;
  inviteCode: string;
  inviteUrl: string;
  qrCode: string;
  expiresAt: number;
  maxUses?: number;
  currentUses: number;
  createdBy: string;
  createdAt: number;
}

class ShareCardGenerator {
  private shareCards: Map<string, ShareCard> = new Map();
  private shareLinks: Map<string, ShareLink> = new Map();
  private inviteLinks: Map<string, InviteLink> = new Map();

  /**
   * 生成分享卡片
   */
  generateShareCard(
    type: ShareCard["type"],
    title: string,
    description: string,
    metadata: Record<string, any>,
    coverImage?: string
  ): ShareCard {
    const card: ShareCard = {
      id: `card_${Date.now()}`,
      type,
      title,
      description,
      coverImage,
      backgroundColor: this.getBackgroundColor(type),
      textColor: "#FFFFFF",
      metadata,
      generatedAt: Date.now(),
    };

    this.shareCards.set(card.id, card);
    console.log(`Share card generated: ${card.id}`);

    return card;
  }

  /**
   * 根据类型获取背景颜色
   */
  private getBackgroundColor(type: ShareCard["type"]): string {
    const colors: Record<ShareCard["type"], string> = {
      album: "#FF6B6B",
      anniversary: "#FFD700",
      video: "#4ECDC4",
      memory: "#95E1D3",
      family: "#C7CEEA",
    };
    return colors[type];
  }

  /**
   * 生成分享链接
   */
  generateShareLink(cardId: string, expiresInDays?: number): ShareLink {
    const link: ShareLink = {
      id: `link_${Date.now()}`,
      shortUrl: `https://gm.app/${Math.random().toString(36).substring(7)}`,
      fullUrl: `https://golden-memory.app/share/${cardId}`,
      qrCode: this.generateQRCode(`https://gm.app/${Math.random().toString(36).substring(7)}`),
      expiresAt: expiresInDays ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000 : undefined,
      accessCount: 0,
      createdAt: Date.now(),
    };

    this.shareLinks.set(link.id, link);
    console.log(`Share link generated: ${link.id}`);

    return link;
  }

  /**
   * 生成二维码
   */
  private generateQRCode(url: string): string {
    // 模拟二维码生成
    return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`;
  }

  /**
   * 获取社交媒体预览
   */
  getSocialMediaPreview(cardId: string, platform: SocialMediaPreview["platform"]): SocialMediaPreview {
    const card = this.shareCards.get(cardId);
    if (!card) throw new Error("Card not found");

    return {
      platform,
      title: card.title,
      description: card.description,
      image: card.coverImage || "",
      url: `https://gm.app/${cardId}`,
    };
  }

  /**
   * 生成邀请链接
   */
  generateInviteLink(
    familyId: string,
    createdBy: string,
    expiresInDays: number = 30,
    maxUses?: number
  ): InviteLink {
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const link: InviteLink = {
      id: `invite_${Date.now()}`,
      familyId,
      inviteCode,
      inviteUrl: `https://gm.app/join/${inviteCode}`,
      qrCode: this.generateQRCode(`https://gm.app/join/${inviteCode}`),
      expiresAt: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
      maxUses,
      currentUses: 0,
      createdBy,
      createdAt: Date.now(),
    };

    this.inviteLinks.set(link.id, link);
    console.log(`Invite link generated: ${link.id}`);

    return link;
  }

  /**
   * 使用邀请链接
   */
  useInviteLink(inviteCode: string): InviteLink | null {
    const link = Array.from(this.inviteLinks.values()).find(l => l.inviteCode === inviteCode);

    if (!link) {
      console.error("Invite link not found");
      return null;
    }

    if (link.expiresAt < Date.now()) {
      console.error("Invite link expired");
      return null;
    }

    if (link.maxUses && link.currentUses >= link.maxUses) {
      console.error("Invite link usage limit reached");
      return null;
    }

    link.currentUses++;
    console.log(`Invite link used: ${inviteCode}`);

    return link;
  }

  /**
   * 获取分享卡片
   */
  getShareCard(cardId: string): ShareCard | undefined {
    return this.shareCards.get(cardId);
  }

  /**
   * 获取分享链接
   */
  getShareLink(linkId: string): ShareLink | undefined {
    return this.shareLinks.get(linkId);
  }

  /**
   * 获取邀请链接
   */
  getInviteLink(linkId: string): InviteLink | undefined {
    return this.inviteLinks.get(linkId);
  }

  /**
   * 获取所有分享卡片
   */
  getAllShareCards(): ShareCard[] {
    return Array.from(this.shareCards.values());
  }

  /**
   * 获取所有分享链接
   */
  getAllShareLinks(): ShareLink[] {
    return Array.from(this.shareLinks.values());
  }

  /**
   * 获取所有邀请链接
   */
  getAllInviteLinks(familyId?: string): InviteLink[] {
    const links = Array.from(this.inviteLinks.values());
    return familyId ? links.filter(l => l.familyId === familyId) : links;
  }

  /**
   * 记录分享链接访问
   */
  recordShareLinkAccess(linkId: string): void {
    const link = this.shareLinks.get(linkId);
    if (link) {
      link.accessCount++;
      console.log(`Share link accessed: ${linkId} (${link.accessCount} times)`);
    }
  }

  /**
   * 撤销分享链接
   */
  revokeShareLink(linkId: string): void {
    this.shareLinks.delete(linkId);
    console.log(`Share link revoked: ${linkId}`);
  }

  /**
   * 撤销邀请链接
   */
  revokeInviteLink(linkId: string): void {
    this.inviteLinks.delete(linkId);
    console.log(`Invite link revoked: ${linkId}`);
  }

  /**
   * 获取分享统计
   */
  getShareStats(): {
    totalCards: number;
    totalLinks: number;
    totalInvites: number;
    totalAccess: number;
    activeInvites: number;
  } {
    const now = Date.now();
    const activeInvites = Array.from(this.inviteLinks.values()).filter(
      l => l.expiresAt > now
    ).length;

    const totalAccess = Array.from(this.shareLinks.values()).reduce(
      (sum, link) => sum + link.accessCount,
      0
    );

    return {
      totalCards: this.shareCards.size,
      totalLinks: this.shareLinks.size,
      totalInvites: this.inviteLinks.size,
      totalAccess,
      activeInvites,
    };
  }

  /**
   * 清空过期链接
   */
  cleanupExpiredLinks(): void {
    const now = Date.now();

    // 清理过期分享链接
    Array.from(this.shareLinks.entries()).forEach(([id, link]) => {
      if (link.expiresAt && link.expiresAt < now) {
        this.shareLinks.delete(id);
      }
    });

    // 清理过期邀请链接
    Array.from(this.inviteLinks.entries()).forEach(([id, link]) => {
      if (link.expiresAt < now) {
        this.inviteLinks.delete(id);
      }
    });

    console.log("Expired links cleaned up");
  }
}

// 导出单例
export const shareCardGenerator = new ShareCardGenerator();
