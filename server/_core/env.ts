const csv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  jwtIssuer: process.env.JWT_ISSUER ?? "golden-memory",
  jwtAudience: process.env.JWT_AUDIENCE ?? "golden-memory-client",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  allowedOrigins: csv(
    process.env.ALLOWED_ORIGINS ??
      (process.env.NODE_ENV === "production"
        ? ""
        : "http://localhost:8081,http://localhost:3000"),
  ),
};

export function assertSecureRuntimeConfig() {
  if (!ENV.isProduction) return;

  const required: Array<[string, string]> = [
    ["VITE_APP_ID", ENV.appId],
    ["JWT_SECRET", ENV.cookieSecret],
    ["DATABASE_URL", ENV.databaseUrl],
    ["OAUTH_SERVER_URL", ENV.oAuthServerUrl],
    ["ALLOWED_ORIGINS", ENV.allowedOrigins.join(",")],
  ];
  const missing = required
    .filter(([, value]) => value.length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }
  if (ENV.cookieSecret.length < 32) {
    throw new Error(
      "JWT_SECRET must contain at least 32 characters in production",
    );
  }
  if (ENV.allowedOrigins.some((origin) => origin === "*")) {
    throw new Error("ALLOWED_ORIGINS must not contain * in production");
  }
}
