/** @type {const} */
const themeColors = {
  primary: { light: '#D4AF37', dark: '#D4AF37' },  // Golden color for brand
  background: { light: '#ffffff', dark: '#1A1A1A' },
  surface: { light: '#f5f5f5', dark: '#2A2A2A' },
  foreground: { light: '#333333', dark: '#F0F0F0' },
  muted: { light: '#666666', dark: '#B0B0B0' },
  border: { light: '#E5E7EB', dark: '#404040' },
  success: { light: '#22C55E', dark: '#4ADE80' },
  warning: { light: '#F59E0B', dark: '#FBBF24' },
  error: { light: '#EF4444', dark: '#F87171' },
  accent: { light: '#7C3AED', dark: '#A78BFA' },  // Purple accent
  // --- Semantic tokens added for P1 accessibility / consistency ---
  // Text/icon colour placed ON top of primary gold. White on #D4AF37 is only 2.1:1;
  // this deep brown reaches ~8.9:1 and satisfies WCAG AA for the main CTA.
  onPrimary: { light: '#3D2E00', dark: '#3D2E00' },
  // Soft gold tint used for highlight chips / badges (replaces bg-yellow-100 etc.)
  primarySoft: { light: '#FBF3DA', dark: '#3A3220' },
  onPrimarySoft: { light: '#92400E', dark: '#F5D77A' },
  // Informational blue (replaces bg-blue-500)
  info: { light: '#3B82F6', dark: '#60A5FA' },
  // Secondary amber action (replaces bg-amber-600)
  secondary: { light: '#D97706', dark: '#F59E0B' },
};

module.exports = { themeColors };
