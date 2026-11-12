import { useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";

/**
 * Intercept the Android hardware / gesture back button while `enabled`.
 *
 * Return `true` from `handler` to consume the event (e.g. leave an in-page
 * edit mode or close a sheet) or `false` to let navigation handle it.
 *
 * No-op on iOS/web where there is no hardware back button; Modals should
 * additionally pass `onRequestClose` so the same handler runs there.
 *
 * Example:
 * ```tsx
 * useBackHandler(editMode, () => { setEditMode(false); return true; });
 * ```
 */
export function useBackHandler(enabled: boolean, handler: () => boolean): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () =>
      handlerRef.current(),
    );
    return () => subscription.remove();
  }, [enabled]);
}
