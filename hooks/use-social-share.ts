import { useCallback } from "react";
import { socialShareManager, ShareCard } from "@/lib/social-share-manager";

export function useSocialShare() {
  const generateShareCard = useCallback(
    (
      type: "album" | "video" | "memory" | "anniversary",
      data: {
        id: string;
        title: string;
        description: string;
        image: string;
        participants?: string[];
      }
    ) => {
      return socialShareManager.generateShareCard(type, data);
    },
    []
  );

  const shareToWeChat = useCallback(async (card: ShareCard) => {
    return socialShareManager.shareToWeChat(card);
  }, []);

  const shareToFacebook = useCallback(async (card: ShareCard) => {
    return socialShareManager.shareToFacebook(card);
  }, []);

  const shareToInstagram = useCallback(async (card: ShareCard) => {
    return socialShareManager.shareToInstagram(card);
  }, []);

  const generateQRCode = useCallback(async (url: string) => {
    return socialShareManager.generateQRCode(url);
  }, []);

  const copyShareLink = useCallback(async (url: string) => {
    return socialShareManager.copyShareLink(url);
  }, []);

  const getShareStats = useCallback(() => {
    return socialShareManager.getShareStats();
  }, []);

  return {
    generateShareCard,
    shareToWeChat,
    shareToFacebook,
    shareToInstagram,
    generateQRCode,
    copyShareLink,
    getShareStats,
  };
}
