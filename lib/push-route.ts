/** P11 — pure helper shared by the push navigation hook and tests (no RN imports). */
export function isSafeInternalRoute(route: unknown): route is string {
  return typeof route === "string" && route.startsWith("/") && !route.startsWith("//") && !/^\/\s*javascript:/i.test(route) && route.length < 512;
}
