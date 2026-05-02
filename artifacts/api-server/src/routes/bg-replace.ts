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
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
  fileFilter: (_req, file, cb) => {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (file.mimetype.startsWith("video/") || VIDEO_EXTS.has(ext)) cb(null, true);
    else cb(new Error("Only video files are accepted (MP4, MOV, WebM…)"));
  },
});

// POST /api/videos/bg-replace
// Body: multipart/form-data  { video: File, backgroundPrompt: string }
router.post("/videos/bg-replace", requireAuth, upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file provided" });

  const backgroundPrompt = (req.body?.backgroundPrompt as string | undefined)?.trim();
  if (!backgroundPrompt) return res.status(400).json({ error: "backgroundPrompt is required" });

  const jobId = `bgr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(VIDEOS_DIR,  { recursive: true });
  await mkdir(THUMBS_DIR,  { recursive: true });

  // 1. Save uploaded video locally & serve it so Replicate can fetch it
  const uploadPath = path.join(UPLOADS_DIR, `${jobId}-src.mp4`);
  await writeFile(uploadPath, req.file.buffer);

  const domain = process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) return res.status(500).json({ error: "Could not determine public domain for Replicate access" });

  const publicVideoUrl = `https://${domain}/api/uploads/${jobId}-src.mp4`;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const replicate = new Replicate({ auth: token });

  // 2. Run Robust Video Matting → green-screen output
  let greenScreenUrl: string;
  try {
    const output = await replicate.run("arielreplicate/robust_video_matting", {
      input: { input_video: publicVideoUrl, output_type: "green-screen" },
    }) as unknown;

    if (typeof output === "string") {
      greenScreenUrl = output;
    } else if (output && typeof (output as any).url === "function") {
      greenScreenUrl = (output as any).url().href;
    } else if (Array.isArray(output) && output.length > 0) {
      const item = output[0];
      greenScreenUrl = typeof item === "string" ? item : item.url().href;
    } else {
      throw new Error("Unexpected RVM output format");
    }
  } catch (err: any) {
    return res.status(500).json({ error: `Background removal failed: ${err.message}` });
  }

  // 3. Download the green-screen video
  const gsPath = path.join(UPLOADS_DIR, `${jobId}-gs.mp4`);
  const gsResp = await fetch(greenScreenUrl);
  if (!gsResp.ok) return res.status(500).json({ error: "Failed to download green-screen video" });
  await writeFile(gsPath, Buffer.from(await gsResp.arrayBuffer()));

  // 4. Get original video dimensions via ffprobe
  let vidWidth = 1280, vidHeight = 720;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${gsPath}"`
    );
    const parts = stdout.trim().split(",");
    if (parts.length === 2) {
      vidWidth  = parseInt(parts[0], 10) || 1280;
      vidHeight = parseInt(parts[1], 10) || 720;
    }
  } catch { /* use defaults */ }

  // 5. Generate new background with OpenAI
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

  // 6. FFmpeg: scale bg to match video size, chromakey green → transparent, composite
  const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
  const ffmpegCmd = [
    `ffmpeg -y`,
    `-i "${gsPath}"`,
    `-i "${bgPath}"`,
    `-filter_complex`,
    `"[1:v]scale=${vidWidth}:${vidHeight}:force_original_aspect_ratio=increase,crop=${vidWidth}:${vidHeight}[bg];`,
    `[0:v]chromakey=color=0x00FF00:similarity=0.35:blend=0.08[fg];`,
    `[bg][fg]overlay=shortest=1[out]"`,
    `-map "[out]"`,
    `-c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p`,
    `-movflags +faststart`,
    `"${outputPath}"`,
  ].join(" ");

  try {
    await execAsync(ffmpegCmd);
  } catch (err: any) {
    return res.status(500).json({ error: `Video compositing failed: ${err.message}` });
  }

  // 7. Generate thumbnail from output video
  const thumbPath = path.join(THUMBS_DIR, `${jobId}-thumb.png`);
  try {
    await execAsync(`ffmpeg -y -i "${outputPath}" -vframes 1 -q:v 2 "${thumbPath}"`);
  } catch { /* thumbnail is optional */ }

  return res.json({
    videoUrl:     `/api/videos-files/${jobId}-out.mp4`,
    thumbnailUrl: `/api/thumbs/${jobId}-thumb.png`,
    jobId,
  });
});

export default router;
