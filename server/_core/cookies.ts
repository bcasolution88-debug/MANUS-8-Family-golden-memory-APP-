import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  return req.protocol === "https" || ENV.isProduction;
}

function getParentDomain(hostname: string): string | undefined {
  if (LOCAL_HOSTS.has(hostname) || isIpAddress(hostname)) return undefined;
  const parts = hostname.split(".");
  if (parts.length < 3) return undefined;
  return "." + parts.slice(-2).join(".");
}

export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);
  return {
    // Cross-subdomain sharing is retained for the preview environment, but the
    // domain is never set for localhost/IPs and production cookies are secure.
    domain: getParentDomain(req.hostname),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  };
}
