/**
 * 分享卡片生成和预览系统
 * 实现动态卡片生成、二维码、社交媒体预览、邀请链接
 */

export type SharePlatform = "wechat" | "facebook" | "instagram" | "link" | "qrcode";

export interface ShareCard {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  resourceType: string;
  resourceId: string;
  createdAt: number;
  expiresAt?: number;
  shareUrl: string;
  qrCodeUrl?: string;
  platforms: SharePlatform[];
  metadata?: Record<string, any>;
}

export interface InviteLink {
  id: string;
  code: string;
  familyId: string;
  createdBy: string;
  createdAt: number;
  expiresAt?: number;
  maxUses?: number;
  currentUses: number;
  active: boolean;
  shareUrl: string;
  qrCodeUrl?: string;
}

export interface SocialPreview {
  platform: SharePlatform;
  title: string;
  description: string;
  imageUrl: string;
  url: string;
}

class ShareCardSystem {
  private shareCards: Map<string, ShareCard> = new Map();
  private inviteLinks: Map<string, InviteLink> = new Map();
  private qrCodeCache: Map<string, string> = new Map();
  private baseUrl = "https://golden-memory.app";
  private shareCardTemplate = {
    width: 1200,
    height: 630,
    backgroundColor: "#FDB913",
    textColor: "#1a1a1a",
  };

  /**
   * 生成分享卡片
   */
  async generateShareCard(
    title: string,
    description: string,
    imageUrl: string,
    resourceType: string,
    resourceId: string,
    platforms: SharePlatform[] = ["wechat", "facebook", "instagram"],
    metadata?: Record<string, any>
  ): Promise<ShareCard> {
    const card: ShareCard = {
      id: `card_${Date.now()}`,
      title,
      description,
      imageUrl,
      resourceType,
      resourceId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30天过期
      shareUrl: `${this.baseUrl}/share/${resourceType}/${resourceId}`,
      platforms,
      metadata,
    };

    // 生成二维码
    card.qrCodeUrl = await this.generateQRCode(card.shareUrl);

    this.shareCards.set(card.id, card);
    console.log(`Share card generated: ${card.id}`);

    return card;
  }

  /**
   * 生成邀请链接
   */
  async generateInviteLink(
    familyId: string,
    createdBy: string,
    expiresAt?: number,
    maxUses?: number
  ): Promise<InviteLink> {
    const code = this.generateInviteCode();

    const link: InviteLink = {
      id: `invite_${Date.now()}`,
      code,
      familyId,
      createdBy,
      createdAt: Date.now(),
      expiresAt: expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000, // 7天过期
      maxUses,
      currentUses: 0,
      active: true,
      shareUrl: `${this.baseUrl}/invite/${code}`,
    };

    // 生成二维码
    link.qrCodeUrl = await this.generateQRCode(link.shareUrl);

    this.inviteLinks.set(link.id, link);
    console.log(`Invite link generated: ${link.id}`);

    return link;
  }

  /**
   * 生成二维码
   */
  private async generateQRCode(url: string): Promise<string> {
    const cacheKey = `qr_${url}`;

    if (this.qrCodeCache.has(cacheKey)) {
      return this.qrCodeCache.get(cacheKey)!;
    }

    try {
      // 模拟二维码生成
      await new Promise(resolve => setTimeout(resolve, 300));

      const qrCodeUrl = `${this.baseUrl}/qrcode/${Buffer.from(url).toString("base64")}`;
      this.qrCodeCache.set(cacheKey, qrCodeUrl);

      console.log(`QR code generated: ${qrCodeUrl}`);
      return qrCodeUrl;
    } catch (error) {
      console.error("Failed to generate QR code:", error);
      throw error;
    }
  }

  /**
   * 生成邀请码
   */
  private generateInviteCode(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * 获取社交媒体预览
   */
  getSocialPreview(card: ShareCard, platform: SharePlatform): SocialPreview {
    const previews: Record<SharePlatform, Partial<SocialPreview>> = {
      wechat: {
        title: `分享: ${card.title}`,
        description: card.description.substring(0, 100),
        imageUrl: card.imageUrl,
      },
      facebook: {
        title: card.title,
        description: card.description,
        imageUrl: card.imageUrl,
      },
      instagram: {
        title: card.title,
        description: card.description.substring(0, 150),
        imageUrl: card.imageUrl,
      },
      link: {
        title: card.title,
        description: card.description,
        imageUrl: card.imageUrl,
      },
      qrcode: {
        title: `扫描二维码查看: ${card.title}`,
        description: card.description,
        imageUrl: card.qrCodeUrl || card.imageUrl,
      },
    };

    const preview = previews[platform];

    return {
      platform,
      title: preview.title || card.title,
      description: preview.description || card.description,
      imageUrl: preview.imageUrl || card.imageUrl,
      url: card.shareUrl,
    };
  }

  /**
   * 使用邀请链接
   */
  useInviteLink(code: string): InviteLink | null {
    const link = Array.from(this.inviteLinks.values()).find(l => l.code === code);

    if (!link) {
      console.log(`Invite link not found: ${code}`);
      return null;
    }

    if (!link.active) {
      console.log(`Invite link is inactive: ${code}`);
      return null;
    }

    if (link.expiresAt && link.expiresAt < Date.now()) {
      link.active = false;
      console.log(`Invite link expired: ${code}`);
      return null;
    }

    if (link.maxUses && link.currentUses >= link.maxUses) {
      link.active = false;
      console.log(`Invite link max uses reached: ${code}`);
      return null;
    }

    link.currentUses++;
    console.log(`Invite link used: ${code} (${link.currentUses}/${link.maxUses || "unlimited"})`);

    return link;
  }

  /**
   * 获取分享卡片
   */
  getShareCard(cardId: string): ShareCard | undefined {
    return this.shareCards.get(cardId);
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
    return Array.from(this.shareCards.values()).filter(
      card => !card.expiresAt || card.expiresAt > Date.now()
    );
  }

  /**
   * 获取所有邀请链接
   */
  getAllInviteLinks(familyId?: string): InviteLink[] {
    let links = Array.from(this.inviteLinks.values());

    if (familyId) {
      links = links.filter(l => l.familyId === familyId);
    }

    return links.filter(l => l.active && (!l.expiresAt || l.expiresAt > Date.now()));
  }

  /**
   * 撤销分享卡片
   */
  revokeShareCard(cardId: string): void {
    this.shareCards.delete(cardId);
    console.log(`Share card revoked: ${cardId}`);
  }

  /**
   * 撤销邀请链接
   */
  revokeInviteLink(linkId: string): void {
    const link = this.inviteLinks.get(linkId);
    if (link) {
      link.active = false;
      console.log(`Invite link revoked: ${linkId}`);
    }
  }

  /**
   * 获取分享统计
   */
  getStats(): {
    totalCards: number;
    activeCards: number;
    totalInvites: number;
    activeInvites: number;
    totalInviteUses: number;
  } {
    const cards = Array.from(this.shareCards.values());
    const invites = Array.from(this.inviteLinks.values());

    return {
      totalCards: cards.length,
      activeCards: cards.filter(c => !c.expiresAt || c.expiresAt > Date.now()).length,
      totalInvites: invites.length,
      activeInvites: invites.filter(i => i.active && (!i.expiresAt || i.expiresAt > Date.now())).length,
      totalInviteUses: invites.reduce((sum, i) => sum + i.currentUses, 0),
    };
  }

  /**
   * 清空过期的卡片和链接
   */
  cleanup(): void {
    const now = Date.now();

    // 清空过期的分享卡片
    for (const [id, card] of this.shareCards) {
      if (card.expiresAt && card.expiresAt < now) {
        this.shareCards.delete(id);
      }
    }

    // 清空过期的邀请链接
    for (const [id, link] of this.inviteLinks) {
      if (link.expiresAt && link.expiresAt < now) {
        this.inviteLinks.delete(id);
      }
    }

    console.log("Cleanup completed");
  }
}

// 导出单例
export const shareCardSystem = new ShareCardSystem();
