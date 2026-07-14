import { useCallback } from "react";
import { shareCardGenerator, ShareCard, ShareLink, InviteLink, SocialMediaPreview } from "@/lib/share-card-generator";

export function useShareCardGenerator() {
  const generateShareCard = useCallback(
    (
      type: ShareCard["type"],
      title: string,
      description: string,
      metadata: Record<string, any>,
      coverImage?: string
    ) => {
      return shareCardGenerator.generateShareCard(type, title, description, metadata, coverImage);
    },
    []
  );

  const generateShareLink = useCallback((cardId: string, expiresInDays?: number) => {
    return shareCardGenerator.generateShareLink(cardId, expiresInDays);
  }, []);

  const getSocialMediaPreview = useCallback(
    (cardId: string, platform: SocialMediaPreview["platform"]) => {
      return shareCardGenerator.getSocialMediaPreview(cardId, platform);
    },
    []
  );

  const generateInviteLink = useCallback(
    (familyId: string, createdBy: string, expiresInDays?: number, maxUses?: number) => {
      return shareCardGenerator.generateInviteLink(familyId, createdBy, expiresInDays, maxUses);
    },
    []
  );

  const useInviteLink = useCallback((inviteCode: string) => {
    return shareCardGenerator.useInviteLink(inviteCode);
  }, []);

  const getShareCard = useCallback((cardId: string) => {
    return shareCardGenerator.getShareCard(cardId);
  }, []);

  const getShareLink = useCallback((linkId: string) => {
    return shareCardGenerator.getShareLink(linkId);
  }, []);

  const getInviteLink = useCallback((linkId: string) => {
    return shareCardGenerator.getInviteLink(linkId);
  }, []);

  const getAllShareCards = useCallback(() => {
    return shareCardGenerator.getAllShareCards();
  }, []);

  const getAllShareLinks = useCallback(() => {
    return shareCardGenerator.getAllShareLinks();
  }, []);

  const getAllInviteLinks = useCallback((familyId?: string) => {
    return shareCardGenerator.getAllInviteLinks(familyId);
  }, []);

  const recordShareLinkAccess = useCallback((linkId: string) => {
    shareCardGenerator.recordShareLinkAccess(linkId);
  }, []);

  const revokeShareLink = useCallback((linkId: string) => {
    shareCardGenerator.revokeShareLink(linkId);
  }, []);

  const revokeInviteLink = useCallback((linkId: string) => {
    shareCardGenerator.revokeInviteLink(linkId);
  }, []);

  const getShareStats = useCallback(() => {
    return shareCardGenerator.getShareStats();
  }, []);

  const cleanupExpiredLinks = useCallback(() => {
    shareCardGenerator.cleanupExpiredLinks();
  }, []);

  return {
    generateShareCard,
    generateShareLink,
    getSocialMediaPreview,
    generateInviteLink,
    useInviteLink,
    getShareCard,
    getShareLink,
    getInviteLink,
    getAllShareCards,
    getAllShareLinks,
    getAllInviteLinks,
    recordShareLinkAccess,
    revokeShareLink,
    revokeInviteLink,
    getShareStats,
    cleanupExpiredLinks,
  };
}
