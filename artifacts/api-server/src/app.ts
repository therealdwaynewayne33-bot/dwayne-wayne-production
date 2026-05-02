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

app.use("/api", router);

export default app;
