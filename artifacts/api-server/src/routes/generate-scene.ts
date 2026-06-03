import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile, readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import ffmpegPath from "ffmpeg-static";
import { requireAuth } from "../middlewares/requireAuth";
import { isBaselineMode, baselineDisabledResponse } from "../lib/baseline-mode";
import { resolveFfmpegBin } from "../lib/ffmpeg";
import {
  chargeCredits,
  refundCredits,
  costForSceneEngine,
  insufficientCreditsResponse,
} from "../lib/credits";
import { normalizeRunwayGen45Input, RUNWAY_GEN_45_MODEL } from "../lib/replicate-video";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const VIDEOS_DIR  = path.join(__dirname, "../public/videos");
const THUMBS_DIR  = path.join(__dirname, "../public/thumbs");
const execAsync   = promisify(exec);

const router = Router();

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (file.mimetype.startsWith("image/") || IMAGE_EXTS.has(ext)) cb(null, true);
    else cb(new Error("Only image files are accepted (PNG, JPG, WebP)"));
  },
});

// ---------------------------------------------------------------------------
// Engine catalog — Replicate-hosted models via REPLICATE_API_TOKEN.
//
// `needsImage` = the model cannot run without a still image input.
// `build()`    = constructs the Replicate input payload from our normalized
//                request body.
// ---------------------------------------------------------------------------
type EngineId =
  | "runway-gen-4.5"
  | "kling-2.1"
  | "hailuo-02"
  | "pixverse-4.5"
  | "wan-2.2-i2v";

type ScenePayload = {
  prompt: string;
  imageUrl?: string;
  duration?: number;
  aspectRatio?: string;
  negativePrompt?: string;
};

type EngineSpec = {
  model: `${string}/${string}`;
  label: string;
  needsImage: boolean;
  build: (p: ScenePayload) => Record<string, unknown>;
};

const ENGINES: Record<EngineId, EngineSpec> = {
  "runway-gen-4.5": {
    model: RUNWAY_GEN_45_MODEL,
    label: "Runway Gen-4.5",
    needsImage: false,
    build: (p) =>
      normalizeRunwayGen45Input({
        prompt: p.prompt,
        durationSeconds: p.duration ?? 5,
        aspectRatio: p.aspectRatio ?? "16:9",
        imageReferenceUrl: p.imageUrl,
      }),
  },
  "kling-2.1": {
    model: "kwaivgi/kling-v2.1",
    label: "Kling 2.1",
    needsImage: true,
    build: (p) => ({
      prompt: p.prompt,
      start_image: p.imageUrl,
      duration: p.duration ?? 5,
      mode: "standard",
      ...(p.negativePrompt ? { negative_prompt: p.negativePrompt } : {}),
    }),
  },
  "hailuo-02": {
    model: "minimax/hailuo-02",
    label: "Hailuo 02",
    needsImage: false,
    build: (p) => ({
      prompt: p.prompt,
      duration: p.duration ?? 6,
      resolution: "768p",
      prompt_optimizer: true,
      ...(p.imageUrl ? { first_frame_image: p.imageUrl } : {}),
    }),
  },
  "pixverse-4.5": {
    model: "pixverse/pixverse-v4.5",
    label: "Pixverse 4.5",
    needsImage: false,
    build: (p) => ({
      prompt: p.prompt,
      quality: "720p",
      duration: p.duration ?? 5,
      aspect_ratio: p.aspectRatio ?? "16:9",
      motion_mode: "normal",
      ...(p.imageUrl ? { image: p.imageUrl } : {}),
      ...(p.negativePrompt ? { negative_prompt: p.negativePrompt } : {}),
    }),
  },
  "wan-2.2-i2v": {
    model: "wan-video/wan-2.2-i2v-a14b",
    label: "Wan 2.2 i2v",
    needsImage: true,
    build: (p) => ({
      prompt: p.prompt,
      image: p.imageUrl,
      num_frames: 81,
      resolution: "720p",
      frames_per_second: 24,
    }),
  },
};

function isEngineId(v: unknown): v is EngineId {
  return typeof v === "string" && v in ENGINES;
}

function resolveUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof (output as any).url === "function") return (output as any).url().href;
  if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    return typeof item === "string" ? item : item.url().href;
  }
  throw new Error("Unexpected output format from Replicate model");
}

async function makeThumbnail(videoPath: string, outPath: string) {
  const bin = resolveFfmpegBin(ffmpegPath);
  // Use exec with quoted args already; keep as-is for minimal changes, but
  // ensure we reference the bundled binary path on Windows.
  const q = (s: string) => `"${s.replaceAll('"', '\\"')}"`;
  await execAsync(`${q(bin)} -y -i ${q(videoPath)} -ss 0.5 -frames:v 1 -q:v 3 ${q(outPath)}`);
}

async function downloadToFile(url: string, filePath: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to download ${url}: ${r.status}`);
  await writeFile(filePath, Buffer.from(await r.arrayBuffer()));
}

function getDomain(): string | null {
  return process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0] ?? null;
}

// Same friendly mapping used by bg-replace so users get a clear message on
// 402 / 401 / model-specific failures instead of a raw stack trace.
function friendlyReplicateError(err: any): { status: number; message: string } {
  const raw: string = err?.message ?? String(err ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("402") || lower.includes("insufficient") || lower.includes("payment required")) {
    return { status: 402, message: "Your Replicate account is out of credit. Top up at https://replicate.com/account/billing then try again." };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("authentication")) {
    return { status: 401, message: "Replicate API key was rejected. Check the REPLICATE_API_TOKEN secret." };
  }
  if (lower.includes("e006") || lower.includes("input was invalid")) {
    return { status: 400, message: "The model rejected the input. Try a simpler prompt or a different image." };
  }
  return { status: 500, message: raw.slice(0, 240) };
}

// ---------------------------------------------------------------------------
// GET /api/scene/engines
// Lightweight catalog the frontend can render in its engine tab strip.
// ---------------------------------------------------------------------------
router.get("/scene/engines", requireAuth, (_req, res) => {
  res.json({
    engines: (Object.keys(ENGINES) as EngineId[]).map((id) => ({
      id,
      label: ENGINES[id].label,
      needsImage: ENGINES[id].needsImage,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/scene/generate
//
// Generate a short video from a still image and/or a prompt using one of the
// four supported Replicate engines. Returns the saved videoUrl + thumbnail.
//
// Form fields:
//   engine          (required) scene engine id (see ENGINES in generate-scene.ts)
//   prompt          (required)
//   duration        (optional, seconds; engine-specific)
//   aspectRatio     (optional; only respected by engines that take it)
//   negativePrompt  (optional)
//   image           (optional file upload — required for engines where needsImage=true)
// ---------------------------------------------------------------------------
router.post("/scene/generate", requireAuth, upload.single("image"), async (req, res) => {
  if (isBaselineMode()) {
    return res.status(503).json(baselineDisabledResponse("/scene/generate"));
  }

  const engineId = (req.body?.engine as string | undefined)?.trim();
  if (!isEngineId(engineId)) {
    return res.status(400).json({ error: `Unknown engine. Pick one of: ${Object.keys(ENGINES).join(", ")}` });
  }

  const prompt = (req.body?.prompt as string | undefined)?.trim();
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const spec = ENGINES[engineId];
  if (spec.needsImage && !req.file) {
    return res.status(400).json({ error: `${spec.label} requires a starting image. Upload one and try again.` });
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const replicate = new Replicate({ auth: token });
  const domain = getDomain();

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(VIDEOS_DIR,  { recursive: true });
  await mkdir(THUMBS_DIR,  { recursive: true });

  const jobId = `scn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 1. If an image was uploaded, persist it and build a URL the
  //    Replicate worker can fetch. If no public HTTPS domain is available,
  //    upload the file to Replicate's temporary storage.
  let imageUrl: string | undefined;
  if (req.file) {
    const ext = "." + (req.file.originalname.split(".").pop() ?? "png").toLowerCase();
    const safeExt = IMAGE_EXTS.has(ext) ? ext : ".png";
    const imgPath = path.join(UPLOADS_DIR, `${jobId}-img${safeExt}`);
    await writeFile(imgPath, req.file.buffer);
    if (domain) {
      imageUrl = `https://${domain}/api/uploads/${jobId}-img${safeExt}`;
    } else {
      try {
        const buf = await readFile(imgPath);
        const uploaded = await replicate.files.create(buf, { jobId, kind: "scene-input", route: "scene/generate" });
        const getUrl = (uploaded as { urls?: { get?: string } })?.urls?.get;
        if (typeof getUrl === "string" && getUrl.startsWith("http")) {
          imageUrl = getUrl;
        }
      } catch (err: any) {
        return res.status(500).json({ error: `Failed to upload image: ${err.message}` });
      }
    }
  }

  const duration       = req.body?.duration       ? Number(req.body.duration) : undefined;
  const aspectRatio    = req.body?.aspectRatio    as string | undefined;
  const negativePrompt = req.body?.negativePrompt as string | undefined;

  // Charge credits BEFORE the Replicate call so two parallel requests can't
  // both overspend a near-empty balance. Refund on any failure path below.
  const cost = costForSceneEngine(engineId, duration);
  const charge = await chargeCredits(req.session.userId!, cost, `scene/${engineId}`, req.log);
  if (!charge.ok) {
    return res.status(402).json(insufficientCreditsResponse(charge.have, charge.needed));
  }

  const input = spec.build({ prompt, imageUrl, duration, aspectRatio, negativePrompt });

  req.log.info({ jobId, engine: engineId, prompt, cost }, "scene/generate: calling model");
  let resultUrl: string;
  try {
    const output = await replicate.run(spec.model, { input });
    resultUrl = resolveUrl(output);
  } catch (err: any) {
    req.log.error({ err: err.message, engine: engineId }, "scene/generate: model failed");
    await refundCredits(req.session.userId!, cost, `scene/${engineId} failed`, req.log);
    const f = friendlyReplicateError(err);
    return res.status(f.status).json({ error: `${spec.label} — ${f.message}` });
  }

  // 2. Persist the output so the frontend can stream from our own domain
  //    (Replicate URLs expire after a few minutes).
  const outPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
  try {
    await downloadToFile(resultUrl, outPath);
  } catch (err: any) {
    await refundCredits(req.session.userId!, cost, `scene/${engineId} download failed`, req.log);
    return res.status(500).json({ error: `Failed to save generated video: ${err.message}` });
  }

  try {
    await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
  } catch (err: any) {
    req.log.warn({ err: err.message }, "scene/generate: thumbnail failed");
  }

  return res.json({
    videoUrl:     `/api/videos-files/${jobId}-out.mp4`,
    thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
    engine:       engineId,
    engineLabel:  spec.label,
    jobId,
    creditsCharged: cost,
    creditsRemaining: charge.newBalance,
  });
});

export default router;
