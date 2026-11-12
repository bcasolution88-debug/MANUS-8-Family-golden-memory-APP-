import { useState } from "react";
import { Image, View, type ImageProps, type StyleProp, type ImageStyle } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

type Props = Omit<ImageProps, "source"> & {
  /** media.id — resolves a short-lived signed URL via media.getSignedUrl. */
  mediaId: number;
  /** Use the thumbnail variant (default true for grids). */
  thumbnail?: boolean;
  /** Shown while loading / on error. Defaults to a muted photo icon. */
  fallbackIcon?: keyof typeof MaterialIcons.glyphMap;
  style?: StyleProp<ImageStyle>;
};

/** Signed URLs live 15 min on the server; refresh a bit earlier. */
const SIGNED_URL_STALE_MS = 12 * 60 * 1000;

/**
 * <Image> for private media (P4). Never embeds a public bucket URL — it asks
 * the API for a signed GET URL (family-membership checked server-side) and
 * refetches before the URL expires. Legacy rows without a storageKey resolve
 * to their stored URL transparently.
 */
export function SignedImage({ mediaId, thumbnail = true, fallbackIcon = "photo", style, className, ...rest }: Props) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const signed = trpc.media.getSignedUrl.useQuery(
    { id: mediaId },
    { staleTime: SIGNED_URL_STALE_MS, refetchInterval: SIGNED_URL_STALE_MS, retry: 1 },
  );

  const uri = thumbnail ? signed.data?.thumbnailUrl : signed.data?.url;

  if (!uri || failed || signed.isError) {
    return (
      <View className={`items-center justify-center bg-surface ${className ?? ""}`} style={style as any}>
        <MaterialIcons name={signed.isError || failed ? "broken-image" : fallbackIcon} size={28} color={colors.muted} />
      </View>
    );
  }

  return (
    <Image
      {...rest}
      className={className}
      style={style}
      source={{ uri }}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}
