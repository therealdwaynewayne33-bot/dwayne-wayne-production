import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "dreamframe-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// Serve AI-generated thumbnails
app.use("/api/thumbs", express.static(path.join(__dirname, "../public/thumbs")));
// Serve generated video files
app.use("/api/videos-files", express.static(path.join(__dirname, "../public/videos")));
// Serve character reference images
app.use("/api/char-files", express.static(path.join(__dirname, "../public/chars")));
// Serve uploaded source videos (needed for Replicate to access them)
app.use("/api/uploads", express.static(path.join(__dirname, "../public/uploads")));
// Serve face-swap result images
app.use("/api/swaps", express.static(path.join(__dirname, "../public/swaps")));

// API routers (includes GET /api/stock-images/search → routes/stock-images.ts; GET /api/stock-videos/search → routes/stock-videos.ts)
app.use("/api", router);

// ---------------------------------------------------------------------------
// API fallbacks: ALWAYS return JSON for /api/*
// ---------------------------------------------------------------------------
app.use("/api", (_req, res) => {
  return res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: any, res: any, _next: any) => {
  const message =
    typeof err?.message === "string" && err.message.trim()
      ? err.message
      : "Internal server error";

  // Log full error to terminal/logger for debugging
  try {
    req?.log?.error?.({ err }, "Unhandled API error");
  } catch {
    // fall back to console if logger isn't available for some reason
    // (e.g. thrown before pino-http attaches req.log)
    console.error("Unhandled API error:", err);
  }

  if (res.headersSent) return;
  const status = typeof err?.status === "number" ? err.status : 500;
  return res.status(status).json({ error: message });
});

export default app;
