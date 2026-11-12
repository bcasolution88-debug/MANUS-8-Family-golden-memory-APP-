import AsyncStorage from "@react-native-async-storage/async-storage";
import { rem } from "nativewind";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

/**
 * Elder Mode (长辈模式) — global accessibility mode for senior users.
 *
 * Two independent knobs are exposed:
 *  - fontScale   : 1 / 1.25 / 1.5  → rescales NativeWind's rem unit so every
 *                  text-*, p-*, gap-* utility grows together (default rem = 14).
 *  - simplified  : hides advanced controls (filters, transitions, …) and
 *                  trims the Tab bar to Home / Album / Messages.
 *
 * `enabled` is a convenience switch that turns both on (1.25 + simplified).
 * Values persist to AsyncStorage under `elderMode`.
 */

export type FontScale = 1 | 1.25 | 1.5;

export const FONT_SCALE_OPTIONS: { value: FontScale; labelZh: string; labelEn: string; px: number }[] = [
  { value: 1, labelZh: "标准", labelEn: "Standard", px: 16 },
  { value: 1.25, labelZh: "较大", labelEn: "Large", px: 20 },
  { value: 1.5, labelZh: "特大", labelEn: "Extra Large", px: 24 },
];

/** Minimum touch target recommended by Material / WCAG 2.5.5 (dp). */
export const MIN_TOUCH_TARGET = 48;

const BASE_REM = 14; // matches withNativeWind({ inlineRem }) default in metro.config.js
const STORAGE_KEY = "elderMode";

interface ElderModeState {
  enabled: boolean;
  fontScale: FontScale;
  simplified: boolean;
}

interface ElderModeContextValue extends ElderModeState {
  /** Toggle the whole mode (sets fontScale 1.25 + simplified on, or resets). */
  setEnabled: (enabled: boolean) => void;
  setFontScale: (scale: FontScale) => void;
  setSimplified: (simplified: boolean) => void;
  /** Multiply a dp value by the current scale – for icon sizes / hit-slops that are not rem-based. */
  scaled: (value: number) => number;
  /** Ready flag so screens can avoid a flash of un-scaled UI on cold start. */
  hydrated: boolean;
}

const DEFAULT_STATE: ElderModeState = { enabled: false, fontScale: 1, simplified: false };

const ElderModeContext = createContext<ElderModeContextValue | null>(null);

function applyRem(scale: FontScale) {
  const px = BASE_REM * scale;
  // Native: NativeWind observable. Web: also update <html> font-size for CSS rem.
  try {
    rem.set(px);
  } catch {
    // rem.set is not available in some test environments; ignore.
  }
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.style.fontSize = `${px}px`;
  }
}

export function ElderModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ElderModeState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from storage once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw) as Partial<ElderModeState>;
          const next: ElderModeState = {
            enabled: !!parsed.enabled,
            fontScale: ([1, 1.25, 1.5] as FontScale[]).includes(parsed.fontScale as FontScale)
              ? (parsed.fontScale as FontScale)
              : 1,
            simplified: !!parsed.simplified,
          };
          setState(next);
        }
      } catch (error) {
        console.error("Failed to load elder mode preference:", error);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply rem whenever scale changes and persist state.
  useEffect(() => {
    applyRem(state.fontScale);
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error) =>
      console.error("Failed to save elder mode preference:", error),
    );
  }, [state, hydrated]);

  const setEnabled = useCallback((enabled: boolean) => {
    setState((prev) =>
      enabled
        ? { enabled: true, fontScale: prev.fontScale === 1 ? 1.25 : prev.fontScale, simplified: true }
        : { enabled: false, fontScale: 1, simplified: false },
    );
  }, []);

  const setFontScale = useCallback((fontScale: FontScale) => {
    setState((prev) => ({ ...prev, fontScale, enabled: prev.enabled || fontScale > 1 }));
  }, []);

  const setSimplified = useCallback((simplified: boolean) => {
    setState((prev) => ({ ...prev, simplified, enabled: prev.enabled || simplified }));
  }, []);

  const scaled = useCallback((value: number) => Math.round(value * state.fontScale), [state.fontScale]);

  const value = useMemo<ElderModeContextValue>(
    () => ({ ...state, setEnabled, setFontScale, setSimplified, scaled, hydrated }),
    [state, setEnabled, setFontScale, setSimplified, scaled, hydrated],
  );

  return <ElderModeContext.Provider value={value}>{children}</ElderModeContext.Provider>;
}

export function useElderMode(): ElderModeContextValue {
  const ctx = useContext(ElderModeContext);
  if (!ctx) {
    throw new Error("useElderMode must be used within ElderModeProvider");
  }
  return ctx;
}
