import { LinearGradient, type LinearGradientProps } from "expo-linear-gradient";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { useColors } from "@/hooks/use-colors";

/**
 * Named gradient presets so screens never hand-pick hex values.
 * NativeWind does NOT support `bg-gradient-to-*` on native; this component is the
 * single supported way to render gradients in the app.
 */
export type GradientVariant =
  | "primarySoft" // subtle gold tint → surface (home "happiness" card, splash backdrop)
  | "gold" // solid-feeling gold gradient (anniversary countdown)
  | "goldToInfo" // gold → blue (profile header)
  | "accentToPink"; // purple → pink (Instagram share icon)

export interface GradientCardProps {
  variant?: GradientVariant;
  /** Direction. Defaults to top→bottom. */
  direction?: "vertical" | "horizontal";
  /** Tailwind classes forwarded to LinearGradient (rounded-*, p-*, gap-*, etc.). */
  className?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Escape hatch for a custom pair of colours. */
  colors?: LinearGradientProps["colors"];
}

const DIRECTIONS = {
  vertical: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  horizontal: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
} as const;

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${full}${a}`;
}

export function GradientCard({
  variant = "primarySoft",
  direction = "vertical",
  className,
  style,
  children,
  colors: customColors,
}: GradientCardProps) {
  const theme = useColors();

  const presets: Record<GradientVariant, [string, string]> = {
    primarySoft: [withAlpha(theme.primary, 0.12), theme.surface],
    gold: [theme.primary, "#B8942A"],
    goldToInfo: [theme.primary, theme.info],
    accentToPink: [theme.accent, "#EC4899"],
  };

  const gradientColors = customColors ?? presets[variant];

  return (
    <LinearGradient
      colors={gradientColors}
      {...DIRECTIONS[direction]}
      className={className}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
