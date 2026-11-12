import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { reapInterruptedStudioJobs, startStudioWorker } from "../studioRouter";
import { startBackupScheduler } from "../backupService";
import { startReminderScheduler } from "../reminderService";
import { schedulerLeader } from "./coordination";
import { prunePushTokens } from "./push";
import { startMetricsScheduler } from "./metrics";
import { startDigestScheduler } from "./pushDigest";
import { startMergePurgeScheduler } from "../mergeService";
import { startRemoteSyncScheduler } from "../backupService";
import { reapRestoreJobs, startRestoreWorker } from "../restoreService";
import { startOrphanScanScheduler } from "../storageOrphans";
import { startCopyWorker } from "../targetCopyService";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { assertSecureRuntimeConfig, ENV } from "./env";
import { authLimiter, globalLimiter, storageProxyLimiter } from "./rateLimit";

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

  // P3: per-IP rate limiting. Global bucket on everything under /api and the
  // storage proxy, plus stricter buckets for auth callbacks and signed-URL
  // redirects (each of which costs an upstream call).
  app.use(["/api", "/manus-storage"], globalLimiter);
  app.use("/api/oauth", authLimiter);
  app.use("/manus-storage", storageProxyLimiter);

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, timestamp: Date.now() }),
  );
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext }),
  );

  // P8: any Studio render that was mid-flight when the last process died can
  // never finish — mark it failed so clients stop polling forever.
  reapInterruptedStudioJobs().catch((error) => console.error("[studio] reap failed", error));
  // P9: DB-backed render queue — claims jobs atomically, STUDIO_CONCURRENCY per process.
  startStudioWorker();
  // P10: one scheduler leader per cluster (Redis lease; memory mode = always leader).
  schedulerLeader.start();
  // P9: weekly backups for users who opted in (hourly tick; BACKUP_SCHEDULER=0 disables).
  startBackupScheduler();
  // P10: anniversary reminders (in-app + Expo Push), leader-only.
  startReminderScheduler();
  // P12: background restore queue (atomic claim; RESTORE_CONCURRENCY per process).
  reapRestoreJobs().catch((error) => console.error("[restore] reap failed", error));
  startRestoreWorker();
  // P12: hourly metrics prune + success-rate alerts (leader-only).
  startMetricsScheduler();
  // P13: daily / weekly push digests, remote-upload retries + target health probes, merge undo-window purge (all leader-only)
  startDigestScheduler();
  startRemoteSyncScheduler();
  startMergePurgeScheduler();
  startOrphanScanScheduler();
  startCopyWorker();
  // P10: drop push tokens that died or went silent.
  setTimeout(() => void prunePushTokens().catch(() => undefined), 60_000).unref?.();

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
