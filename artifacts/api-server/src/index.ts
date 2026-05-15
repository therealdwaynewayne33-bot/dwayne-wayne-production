import "./env-bootstrap";
import http from "node:http";
import type { Express } from "express";
import app from "./app";
import { logger } from "./lib/logger";

/** Retain listener handle so the process stays alive after startup (required on some Windows/concurrently setups). */
let httpServer: http.Server | undefined;

const rawPort = process.env["PORT"] ?? "3001";

const preferredPort = Number(rawPort);

if (Number.isNaN(preferredPort) || preferredPort <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}

function listenHttp(expressApp: Express, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = expressApp.listen(port, () => resolve(server));
    server.once("error", (err: NodeJS.ErrnoException) => {
      server.close(() => reject(err));
    });
  });
}

(async () => {
  try {
    let port = preferredPort;
    try {
      httpServer = await listenHttp(app, port);
    } catch (err) {
      if (isAddrInUse(err) && port === 3001) {
        port = 3002;
        logger.warn(
          {
            attemptedPort: 3001,
            port,
            hint: "If /api proxy fails, point Vite at this port or free 3001.",
          },
          "Port 3001 in use; listening on 3002 instead",
        );
        httpServer = await listenHttp(app, port);
      } else {
        throw err;
      }
    }
    logger.info({ port }, "Server listening");
    // When spawned under supervisers (e.g. concurrently on Windows), stdin may close immediately;
    // Node treats that like EOF and can exit even while the HTTP server is listening.
    try {
      process.stdin.resume();
    } catch {
      /* ignore */
    }
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
})();
