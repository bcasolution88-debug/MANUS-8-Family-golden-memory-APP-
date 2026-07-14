/**
 * 社交媒体分享管理模块
 * 支持微信、Facebook、Instagram的分享卡片生成和深度链接
 */

export interface ShareCard {
  title: string;
  description: string;
  image: string;
  url: string;
  type: "album" | "video" | "memory" | "anniversary";
}

export interface ShareLink {
  platform: "wechat" | "facebook" | "instagram";
  url: string;
  qrCode?: string;
  expiresAt?: number;
}

class SocialShareManager {
  private baseUrl = process.env.EXPO_PUBLIC_APP_URL || "https://golden-memory.app";
  private shareLinks: Map<string, ShareLink> = new Map();

  /**
   * 生成分享卡片
   */
  generateShareCard(
    type: "album" | "video" | "memory" | "anniversary",
    data: {
      id: string;
      title: string;
      description: string;
      image: string;
      participants?: string[];
    }
  ): ShareCard {
    const shareCard: ShareCard = {
      title: data.title,
      description: data.description,
      image: data.image,
      url: `${this.baseUrl}/share/${type}/${data.id}`,
      type,
    };

    return shareCard;
  }

  /**
   * 生成微信分享链接
   */
  generateWeChatShareLink(card: ShareCard): ShareLink {
    const linkId = `wechat_${Date.now()}`;
    const shareLink: ShareLink = {
      platform: "wechat",
      url: this.generateDeepLink("wechat", card),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7天过期
    };

    this.shareLinks.set(linkId, shareLink);
    return shareLink;
  }

  /**
   * 生成Facebook分享链接
   */
  generateFacebookShareLink(card: ShareCard): ShareLink {
    const linkId = `facebook_${Date.now()}`;

    // Facebook分享链接格式
    const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
      card.url
    )}&quote=${encodeURIComponent(card.title)}&picture=${encodeURIComponent(
      card.image
    )}`;

    const shareLink: ShareLink = {
      platform: "facebook",
      url: facebookShareUrl,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30天过期
    };

    this.shareLinks.set(linkId, shareLink);
    return shareLink;
  }

  /**
   * 生成Instagram分享链接
   */
  generateInstagramShareLink(card: ShareCard): ShareLink {
    const linkId = `instagram_${Date.now()}`;

    // Instagram通常通过深度链接或复制到剪贴板
    const instagramShareUrl = `https://instagram.com/`;

    const shareLink: ShareLink = {
      platform: "instagram",
      url: instagramShareUrl,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30天过期
    };

    this.shareLinks.set(linkId, shareLink);
    return shareLink;
  }

  /**
   * 生成深度链接
   */
  private generateDeepLink(platform: string, card: ShareCard): string {
    const params = new URLSearchParams({
      title: card.title,
      description: card.description,
      image: card.image,
      url: card.url,
      platform,
    });

    return `${this.baseUrl}/share?${params.toString()}`;
  }

  /**
   * 生成二维码
   */
  async generateQRCode(url: string): Promise<string> {
    try {
      // 模拟生成二维码
      console.log(`Generating QR code for: ${url}`);

      // 实际实现中会使用QR码生成库
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
        url
      )}`;

      return qrCodeUrl;
    } catch (error) {
      console.error("Failed to generate QR code:", error);
      throw error;
    }
  }

  /**
   * 分享到微信
   */
  async shareToWeChat(card: ShareCard): Promise<void> {
    try {
      const shareLink = this.generateWeChatShareLink(card);

      console.log("Sharing to WeChat:", {
        title: card.title,
        description: card.description,
        image: card.image,
        url: shareLink.url,
      });

      // 模拟分享
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error("Failed to share to WeChat:", error);
      throw error;
    }
  }

  /**
   * 分享到Facebook
   */
  async shareToFacebook(card: ShareCard): Promise<void> {
    try {
      const shareLink = this.generateFacebookShareLink(card);

      console.log("Sharing to Facebook:", {
        title: card.title,
        description: card.description,
        image: card.image,
        url: shareLink.url,
      });

      // 实际实现中会打开Facebook分享对话框
      // window.open(shareLink.url, '_blank', 'width=600,height=400');

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error("Failed to share to Facebook:", error);
      throw error;
    }
  }

  /**
   * 分享到Instagram
   */
  async shareToInstagram(card: ShareCard): Promise<void> {
    try {
      const shareLink = this.generateInstagramShareLink(card);

      console.log("Sharing to Instagram:", {
        title: card.title,
        description: card.description,
        image: card.image,
      });

      // Instagram不支持直接分享，需要用户手动操作
      // 可以复制链接到剪贴板或打开Instagram应用

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error("Failed to share to Instagram:", error);
      throw error;
    }
  }

  /**
   * 复制分享链接到剪贴板
   */
  async copyShareLink(url: string): Promise<void> {
    try {
      // 实际实现中会使用Clipboard API或expo-clipboard
      console.log("Copied to clipboard:", url);

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error("Failed to copy share link:", error);
      throw error;
    }
  }

  /**
   * 获取分享统计
   */
  getShareStats(): {
    totalShares: number;
    weChatShares: number;
    facebookShares: number;
    instagramShares: number;
  } {
    let weChatCount = 0;
    let facebookCount = 0;
    let instagramCount = 0;

    this.shareLinks.forEach(link => {
      if (link.platform === "wechat") weChatCount++;
      else if (link.platform === "facebook") facebookCount++;
      else if (link.platform === "instagram") instagramCount++;
    });

    return {
      totalShares: this.shareLinks.size,
      weChatShares: weChatCount,
      facebookShares: facebookCount,
      instagramShares: instagramCount,
    };
  }

  /**
   * 清理过期的分享链接
   */
  cleanupExpiredLinks(): void {
    const now = Date.now();
    const expiredLinks: string[] = [];

    this.shareLinks.forEach((link, id) => {
      if (link.expiresAt && link.expiresAt < now) {
        expiredLinks.push(id);
      }
    });

    expiredLinks.forEach(id => this.shareLinks.delete(id));

    console.log(`Cleaned up ${expiredLinks.length} expired share links`);
  }
}

// 导出单例
export const socialShareManager = new SocialShareManager();
