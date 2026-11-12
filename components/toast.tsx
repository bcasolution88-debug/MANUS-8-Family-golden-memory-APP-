import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/use-colors";
import { useElderMode } from "@/lib/elder-mode-provider";

/**
 * Non-blocking Toast / Snackbar.
 *
 * Replaces the system `alert()` which (a) looks foreign to the gold theme,
 * (b) blocks the UI and interrupts seniors mid-task, and (c) is not themed
 * for Dark mode. Toasts stack from the bottom above the Tab bar, auto-dismiss,
 * are announced to screen readers via accessibilityLiveRegion, and can carry
 * an optional action (e.g. “撤销”).
 */

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  type?: ToastType;
  /** Auto-dismiss delay in ms. Elder mode multiplies this by 1.5. Default 3000. */
  duration?: number;
  action?: { label: string; onPress: () => void };
}

interface ToastItem extends Required<Pick<ToastOptions, "type" | "duration">> {
  id: number;
  message: string;
  action?: ToastOptions["action"];
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
  success: (message: string, options?: Omit<ToastOptions, "type">) => void;
  error: (message: string, options?: Omit<ToastOptions, "type">) => void;
  info: (message: string, options?: Omit<ToastOptions, "type">) => void;
  warning: (message: string, options?: Omit<ToastOptions, "type">) => void;
  dismiss: (id?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  success: "check-circle",
  error: "error",
  info: "info",
  warning: "warning",
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const { fontScale } = useElderMode();

  const dismiss = useCallback((id?: number) => {
    setToasts((prev) => (id === undefined ? [] : prev.filter((t) => t.id !== id)));
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = ++counter.current;
      const base = options.duration ?? 3000;
      // Seniors need longer to read – scale duration with font scale.
      const duration = Math.round(base * (fontScale > 1 ? 1.5 : 1));
      setToasts((prev) => {
        const next = [...prev, { id, message, type: options.type ?? "info", duration, action: options.action }];
        return next.slice(-MAX_VISIBLE);
      });
    },
    [fontScale],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m, o) => show(m, { ...o, type: "success" }),
      error: (m, o) => show(m, { ...o, type: "error" }),
      info: (m, o) => show(m, { ...o, type: "info" }),
      warning: (m, o) => show(m, { ...o, type: "warning" }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

/* ------------------------------------------------------------------ */

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      // Sit above the 56dp Tab bar + safe-area so toasts never cover navigation.
      style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 56 + 12, gap: 8, paddingHorizontal: 16 }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </View>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const colors = useColors();
  const { scaled } = useElderMode();
  const translate = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translate, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translate, { toValue: 24, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => finished && onDismiss());
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss, translate, opacity]);

  const tint: Record<ToastType, string> = {
    success: colors.success,
    error: colors.error,
    info: colors.primary,
    warning: colors.warning,
  };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        transform: [{ translateY: translate }],
        opacity,
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderLeftWidth: 4,
        borderLeftColor: tint[toast.type],
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <MaterialIcons name={ICONS[toast.type]} size={scaled(22)} color={tint[toast.type]} />
      <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={3}>
        {toast.message}
      </Text>
      {toast.action && (
        <Pressable
          onPress={() => {
            toast.action?.onPress();
            onDismiss();
          }}
          hitSlop={8}
          accessibilityRole="button"
          className="px-3 py-2 rounded-full"
          style={{ backgroundColor: colors.primarySoft }}
        >
          <Text className="text-sm font-bold" style={{ color: colors.onPrimarySoft }}>
            {toast.action.label}
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={onDismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="dismiss"
        // 48dp minimum touch target even though the glyph is 18dp
        style={{ minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" }}
      >
        <MaterialIcons name="close" size={scaled(18)} color={colors.muted} />
      </Pressable>
    </Animated.View>
  );
}
