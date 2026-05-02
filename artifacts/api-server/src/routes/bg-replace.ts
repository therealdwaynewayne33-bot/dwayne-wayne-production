import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import { requireAuth } from "../middlewares/requireAuth";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const VIDEOS_DIR  = path.join(__dirname, "../public/videos");
const THUMBS_DIR  = path.join(__dirname, "../public/thumbs");
const execAsync   = promisify(exec);

const router = Router();

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (file.mimetype.startsWith("video/") || VIDEO_EXTS.has(ext)) cb(null, true);
    else cb(new Error("Only video files are accepted (MP4, MOV, WebM…)"));
  },
});

function resolveUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof (output as any).url === "function") return (output as any).url().href;
  if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    return typeof item === "string" ? item : item.url().href;
  }
  throw new Error("Unexpected output format from Replicate model");
}

// POST /api/videos/bg-replace
router.post("/videos/bg-replace", requireAuth, upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file provided" });

  const backgroundPrompt = (req.body?.backgroundPrompt as string | undefined)?.trim();
  if (!backgroundPrompt) return res.status(400).json({ error: "backgroundPrompt is required" });

  const jobId = `bgr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(VIDEOS_DIR,  { recursive: true });
  await mkdir(THUMBS_DIR,  { recursive: true });

  // 1. Save original video — we need it for the final composite
  const srcPath = path.join(UPLOADS_DIR, `${jobId}-src.mp4`);
  await writeFile(srcPath, req.file.buffer);

  const domain = process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) return res.status(500).json({ error: "Could not determine public domain" });

  const publicVideoUrl = `https://${domain}/api/uploads/${jobId}-src.mp4`;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const replicate = new Replicate({ auth: token });

  // 2. Get alpha-mask from Robust Video Matting
  //    White = character (keep), Black = background (remove)
  //    This avoids chromakey color-spill that was turning her into a shadow
  let alphaMaskUrl: string;
  try {
    const output = await replicate.run(
      "arielreplicate/robust_video_matting:73d2128a371922d5d1abf0712a1d974be0e4e2358cc1218e4e34714767232bac",
      { input: { input_video: publicVideoUrl, output_type: "alpha-mask" } },
    );
    alphaMaskUrl = resolveUrl(output);
  } catch (err: any) {
    return res.status(500).json({ error: `Background removal failed: ${err.message}` });
  }

  // 3. Download the alpha mask video
  const maskPath = path.join(UPLOADS_DIR, `${jobId}-mask.mp4`);
  const maskResp = await fetch(alphaMaskUrl);
  if (!maskResp.ok) return res.status(500).json({ error: "Failed to download alpha mask" });
  await writeFile(maskPath, Buffer.from(await maskResp.arrayBuffer()));

  // 4. Get original video dimensions
  let vidWidth = 1280, vidHeight = 720;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${srcPath}"`
    );
    const parts = stdout.trim().split(",");
    if (parts.length === 2) {
      vidWidth  = parseInt(parts[0], 10) || 1280;
      vidHeight = parseInt(parts[1], 10) || 720;
    }
  } catch { /* use defaults */ }

  // 5. Generate new AI background image
  const bgPath = path.join(UPLOADS_DIR, `${jobId}-bg.png`);
  try {
    const bgBuffer = await generateImageBuffer(
      `${backgroundPrompt}. Cinematic, high quality background scene, no people, wide shot.`,
      "1536x1024"
    );
    await writeFile(bgPath, bgBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: `Background generation failed: ${err.message}` });
  }

  // 6. FFmpeg composite using alphamerge (no chromakey — preserves real colors)
  //
  //   Pipeline:
  //     [bg image]   → looped + scaled to video size                  → [bg]
  //     [original]   → format yuva420p (adds alpha channel slot)      → [src_rgba]
  //     [src_rgba] + [alpha-mask] → alphamerge (mask drives alpha)    → [fg]
  //     [bg] + [fg]  → overlay (shortest=src video)                   → [out]
  //
  //   Key fix: -loop 1 on the PNG so it repeats for the full video duration
  //   instead of stopping after frame 1 (which produced a 0:00 output).
  //
  const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
  const ffmpegCmd = [
    `ffmpeg -y`,
    `-i "${srcPath}"`,
    `-i "${maskPath}"`,
    `-loop 1 -i "${bgPath}"`,
    `-filter_complex`,
    `"[2:v]scale=${vidWidth}:${vidHeight}:force_original_aspect_ratio=increase,crop=${vidWidth}:${vidHeight}[bg];` +
    `[0:v]format=yuva420p[src_rgba];` +
    `[1:v]format=gray[mask];` +
    `[src_rgba][mask]alphamerge[fg];` +
    `[bg][fg]overlay=shortest=1[comp];` +
    // ── Cinematic color grade ──────────────────────────────────────────────
    // 1. eq: slight contrast boost + desaturate to ~85% (film doesn't pop like digital)
    // 2. curves: lifted blacks (shadow raise) + compressed highlights → film look
    // 3. colorchannelmixer: teal shadows / warm highlights (classic Hollywood grade)
    // 4. vignette: subtle edge darkening to pull eye to center
    `[comp]eq=contrast=1.08:brightness=0.0:saturation=0.82,` +
    `curves=all='0/0.05 0.25/0.27 0.75/0.78 1/0.96',` +
    `colorchannelmixer=rr=1.0:rg=0.01:rb=-0.03:gr=-0.01:gg=0.95:gb=0.06:br=-0.07:bg=0.07:bb=1.0,` +
    `vignette=PI/5[out]"`,
    `-map "[out]" -map "0:a?"`,
    `-c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p`,
    `-c:a copy`,
    `-movflags +faststart`,
    `"${outputPath}"`,
  ].join(" ");

  try {
    await execAsync(ffmpegCmd);
  } catch (err: any) {
    return res.status(500).json({ error: `Video compositing failed: ${err.message}` });
  }

  // 7. Generate thumbnail
  const thumbPath = path.join(THUMBS_DIR, `${jobId}-thumb.png`);
  try {
    await execAsync(`ffmpeg -y -i "${outputPath}" -vframes 1 -q:v 2 "${thumbPath}"`);
  } catch { /* optional */ }

  return res.json({
    videoUrl:     `/api/videos-files/${jobId}-out.mp4`,
    thumbnailUrl: `/api/thumbs/${jobId}-thumb.png`,
    jobId,
  });
});

export default router;
