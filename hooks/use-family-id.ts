import { useFamily } from "@/lib/family-provider";

/**
 * Active family for the signed-in user. Backed by <FamilyProvider> (P6), which
 * persists the selection and exposes `switchFamily`. Kept as a thin alias so
 * existing callers (Home, Album, Upload, …) need no changes.
 */
export function useFamilyId() {
  const { familyId, family, families, isLoading, isAuthenticated, switchFamily } = useFamily();
  return { familyId, family, families, isLoading, isAuthenticated, switchFamily };
}
