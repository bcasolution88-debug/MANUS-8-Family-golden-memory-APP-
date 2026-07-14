import { useCallback, useState, useEffect } from "react";
import { shareCardSystem, ShareCard, InviteLink, SharePlatform } from "@/lib/share-card-system";

export function useShareCardSystem() {
  const [shareCards, setShareCards] = useState<ShareCard[]>(shareCardSystem.getAllShareCards());
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>(shareCardSystem.getAllInviteLinks());
  const [stats, setStats] = useState(shareCardSystem.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setShareCards(shareCardSystem.getAllShareCards());
      setInviteLinks(shareCardSystem.getAllInviteLinks());
      setStats(shareCardSystem.getStats());
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const generateShareCard = useCallback(
    async (
      title: string,
      description: string,
      imageUrl: string,
      resourceType: string,
      resourceId: string,
      platforms?: SharePlatform[],
      metadata?: Record<string, any>
    ) => {
      const card = await shareCardSystem.generateShareCard(
        title,
        description,
        imageUrl,
        resourceType,
        resourceId,
        platforms,
        metadata
      );
      setShareCards(shareCardSystem.getAllShareCards());
      setStats(shareCardSystem.getStats());
      return card;
    },
    []
  );

  const generateInviteLink = useCallback(
    async (
      familyId: string,
      createdBy: string,
      expiresAt?: number,
      maxUses?: number
    ) => {
      const link = await shareCardSystem.generateInviteLink(
        familyId,
        createdBy,
        expiresAt,
        maxUses
      );
      setInviteLinks(shareCardSystem.getAllInviteLinks());
      setStats(shareCardSystem.getStats());
      return link;
    },
    []
  );

  const getSocialPreview = useCallback(
    (card: ShareCard, platform: SharePlatform) => {
      return shareCardSystem.getSocialPreview(card, platform);
    },
    []
  );

  const useInviteLink = useCallback((code: string) => {
    const link = shareCardSystem.useInviteLink(code);
    setInviteLinks(shareCardSystem.getAllInviteLinks());
    setStats(shareCardSystem.getStats());
    return link;
  }, []);

  const revokeShareCard = useCallback((cardId: string) => {
    shareCardSystem.revokeShareCard(cardId);
    setShareCards(shareCardSystem.getAllShareCards());
    setStats(shareCardSystem.getStats());
  }, []);

  const revokeInviteLink = useCallback((linkId: string) => {
    shareCardSystem.revokeInviteLink(linkId);
    setInviteLinks(shareCardSystem.getAllInviteLinks());
    setStats(shareCardSystem.getStats());
  }, []);

  const cleanup = useCallback(() => {
    shareCardSystem.cleanup();
    setShareCards(shareCardSystem.getAllShareCards());
    setInviteLinks(shareCardSystem.getAllInviteLinks());
    setStats(shareCardSystem.getStats());
  }, []);

  return {
    shareCards,
    inviteLinks,
    stats,
    generateShareCard,
    generateInviteLink,
    getSocialPreview,
    useInviteLink,
    revokeShareCard,
    revokeInviteLink,
    cleanup,
  };
}
