import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { assertSecureRuntimeConfig, ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  assertSecureRuntimeConfig();
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", ENV.isProduction ? 1 : false);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const originAllowed =
      typeof origin === "string" && ENV.allowedOrigins.includes(origin);
    if (originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");

    if (req.method === "OPTIONS") {
      if (!originAllowed) return res.sendStatus(403);
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,DELETE,OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-CSRF-Token",
      );
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "256kb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, timestamp: Date.now() }),
  );
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext }),
  );

  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);
  server.listen(port, () =>
    console.log(`[api] server listening on port ${port}`),
  );
}

startServer().catch((error) => {
  console.error("[api] failed to start", error);
  process.exitCode = 1;
});
