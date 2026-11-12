import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/hooks/use-auth";
import { usePushNavigation } from "@/hooks/use-push-navigation";
import { usePushRegistration } from "@/hooks/use-push-registration";
import { trpc } from "@/lib/trpc";

const STORAGE_KEY = "activeFamilyId";

type Family = { id: number; name: string; description: string | null; createdBy: number };

type FamilyContextValue = {
  /** All families the signed-in user belongs to. */
  families: Family[];
  /** Currently active family (persisted across launches). */
  family: Family | null;
  familyId: number | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Switch the active family; invalidates every family-scoped query. */
  switchFamily: (id: number) => Promise<void>;
  refresh: () => Promise<void>;
  /** P10: Expo Push device registration state + sign-out hook. */
  push: { status: "idle" | "unsupported" | "denied" | "registering" | "registered" | "error"; error: string | null; unregister: () => Promise<void> };
};

const FamilyContext = createContext<FamilyContextValue | null>(null);

/**
 * Active-family selection (P6).
 *
 * Previously every screen took `getUserFamilies()[0]`. Now the chosen family
 * id persists in AsyncStorage; when the stored id is no longer a membership
 * (left / removed) we fall back to the first family. Switching invalidates
 * all family-scoped tRPC queries so screens refetch for the new family.
 */
export function FamilyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.family.getUserFamilies.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });
  const [storedId, setStoredId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // P10: register this device for push as soon as the user is signed in.
  const push = usePushRegistration(isAuthenticated);
  // P11: tap → deep link, foreground → banner + toast.
  usePushNavigation(isAuthenticated);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const n = raw ? Number(raw) : NaN;
        if (Number.isFinite(n) && n > 0) setStoredId(n);
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, []);

  const families = useMemo<Family[]>(() => (query.data as Family[] | undefined) ?? [], [query.data]);

  const family = useMemo(() => {
    if (families.length === 0) return null;
    return families.find((f) => f.id === storedId) ?? families[0];
  }, [families, storedId]);

  // Keep storage in sync when we had to fall back.
  useEffect(() => {
    if (hydrated && family && family.id !== storedId) {
      setStoredId(family.id);
      AsyncStorage.setItem(STORAGE_KEY, String(family.id)).catch(() => undefined);
    }
  }, [hydrated, family, storedId]);

  const switchFamily = useCallback(
    async (id: number) => {
      if (!families.some((f) => f.id === id)) return;
      setStoredId(id);
      await AsyncStorage.setItem(STORAGE_KEY, String(id)).catch(() => undefined);
      await Promise.all([
        utils.album.invalidate(),
        utils.media.invalidate(),
        utils.family.getMembers.invalidate(),
        utils.family.getAnniversaries.invalidate(),
        utils.family.getLoveStories.invalidate(),
        utils.family.listInvitations.invalidate(),
        utils.timeline.invalidate(),
        utils.interaction.getShares.invalidate(),
      ]);
    },
    [families, utils],
  );

  const refresh = useCallback(async () => {
    await utils.family.getUserFamilies.invalidate();
  }, [utils]);

  const value = useMemo<FamilyContextValue>(
    () => ({
      families,
      family,
      familyId: family?.id ?? null,
      isLoading: isAuthenticated && (query.isLoading || !hydrated),
      isAuthenticated,
      switchFamily,
      refresh,
      push: { status: push.status, error: push.error, unregister: push.unregister },
    }),
    [families, family, isAuthenticated, query.isLoading, hydrated, switchFamily, refresh, push.status, push.error, push.unregister],
  );

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyContextValue {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error("useFamily must be used within <FamilyProvider>");
  return ctx;
}
