import { Pressable, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";

export type ShareLinkStatus = "active" | "expired" | "revoked";

export type ShareLinkItem = {
  id: string;
  shareUrl: string;
  platform: string;
  clicks: number;
  createdAt: Date | string;
  expiresAt: Date | string | null;
  revokedAt: Date | string | null;
  status: ShareLinkStatus;
};

type Props = {
  share: ShareLinkItem;
  selected?: boolean;
  onSelect?: () => void;
  onCopy: () => void;
  onRevoke: () => void;
  onChangeExpiry: () => void;
  busy?: boolean;
};

export const EXPIRY_PRESETS: { key: "7d" | "30d" | "90d" | "never"; days: number | null }[] = [
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
  { key: "90d", days: 90 },
  { key: "never", days: null },
];

/** Human-readable expiry text, i18n-aware. */
export function describeExpiry(
  share: Pick<ShareLinkItem, "expiresAt" | "status">,
  t: (key: any, params?: Record<string, string | number>) => string,
  locale: string,
): string {
  if (share.status === "revoked") return t("share.status.revoked");
  if (!share.expiresAt) return t("share.neverExpires");
  const expires = new Date(share.expiresAt);
  const days = Math.ceil((expires.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return t("share.status.expired");
  if (days <= 90) return t("share.expiresIn", { days });
  return t("share.expiresOn", { date: expires.toLocaleDateString(locale) });
}

/**
 * One row in "My share links" (P3): status chip, expiry, click count and
 * owner actions (copy / change expiry / revoke). Revoked links are read-only.
 */
export function ShareLinkCard({ share, selected, onSelect, onCopy, onRevoke, onChangeExpiry, busy }: Props) {
  const colors = useColors();
  const { t, language } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";

  const statusColor =
    share.status === "active" ? colors.success : share.status === "expired" ? colors.warning : colors.error;
  const inactive = share.status !== "active";

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`mb-3 rounded-2xl p-4 gap-3 ${selected ? "bg-primary/20 border-2 border-primary" : "bg-surface"}`}
      style={inactive ? { opacity: 0.75 } : undefined}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2 flex-1">
          <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${statusColor}22` }}>
            <Text className="text-xs font-bold" style={{ color: statusColor }}>
              {t(`share.status.${share.status}` as any)}
            </Text>
          </View>
          <Text className="text-xs text-muted" numberOfLines={1}>
            {describeExpiry(share, t, locale)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <MaterialIcons name="visibility" size={14} color={colors.muted} />
          <Text className="text-xs text-muted">{share.clicks}</Text>
        </View>
      </View>

      <Text
        className="text-xs text-foreground font-mono"
        numberOfLines={1}
        style={inactive ? { textDecorationLine: "line-through" } : undefined}
      >
        {share.shareUrl}
      </Text>

      <View className="flex-row items-center justify-end gap-1">
        <Pressable
          onPress={onCopy}
          disabled={inactive || busy}
          accessibilityLabel={t("socialShareSheet.copyLink")}
          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
        >
          <MaterialIcons name="content-copy" size={18} color={inactive ? colors.muted : colors.primary} />
        </Pressable>
        <Pressable
          onPress={onChangeExpiry}
          disabled={share.status === "revoked" || busy}
          accessibilityLabel={t("share.expiry")}
          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
        >
          <MaterialIcons name="schedule" size={18} color={share.status === "revoked" ? colors.muted : colors.primary} />
        </Pressable>
        <Pressable
          onPress={onRevoke}
          disabled={share.status === "revoked" || busy}
          accessibilityLabel={t("share.revoke")}
          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
        >
          <MaterialIcons name="link-off" size={18} color={share.status === "revoked" ? colors.muted : colors.error} />
        </Pressable>
      </View>
    </Pressable>
  );
}
