import { useState } from "react";
import { Image, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { trpc } from "@/lib/trpc";

type Props = {
  /** users.avatar — external http(s) URL, `/manus-storage/users/…/avatar/…` proxy path, or null. */
  avatar?: string | null;
  /** Used for the initials fallback. */
  name?: string | null;
  /** Diameter in dp. */
  size?: number;
  /** Tailwind classes for the wrapper (border, ring…). */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Initials colours (defaults suit a gold gradient header). */
  bgClassName?: string;
  textClassName?: string;
};

/** Signed URLs live 15 min on the server; refresh a bit earlier. */
const SIGNED_URL_STALE_MS = 12 * 60 * 1000;

/**
 * P7 — avatar that understands private storage. Pictures uploaded through
 * `profile.initAvatarUpload` are stored as a proxy path; we exchange it for a
 * short-lived signed URL (any signed-in user may view avatars). External URLs
 * (OAuth providers, legacy seed data) are used as-is. Falls back to the first
 * character of the name when there is no picture or loading fails.
 */
export function UserAvatar({
  avatar,
  name,
  size = 40,
  className = "",
  style,
  bgClassName = "bg-primary/15",
  textClassName = "text-primary",
}: Props) {
  const [failed, setFailed] = useState(false);
  const isProxy = !!avatar && avatar.startsWith("/manus-storage/");
  const signed = trpc.profile.avatarUrl.useQuery(
    { avatar: avatar ?? "" },
    { enabled: isProxy, staleTime: SIGNED_URL_STALE_MS, refetchInterval: SIGNED_URL_STALE_MS },
  );
  const uri = isProxy ? signed.data?.url : avatar || undefined;
  const initial = (name ?? "").trim().charAt(0) || "?";
  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (uri && !failed && !(isProxy && signed.isError)) {
    return (
      <Image
        source={{ uri }}
        style={[dim, style as any]}
        className={className}
        onError={() => setFailed(true)}
        accessibilityLabel={name ?? undefined}
      />
    );
  }
  return (
    <View style={[dim, style]} className={`items-center justify-center ${bgClassName} ${className}`}>
      <Text className={`font-bold ${textClassName}`} style={{ fontSize: size * 0.42 }}>
        {initial}
      </Text>
    </View>
  );
}
