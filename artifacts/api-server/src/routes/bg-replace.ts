import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import { requireAuth } from "../middlewares/requireAuth";
import { editImages } from "@workspace/integrations-openai-ai-server/image";

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

  // 1. Save original video
  const srcPath = path.join(UPLOADS_DIR, `${jobId}-src.mp4`);
  await writeFile(srcPath, req.file.buffer);

  const domain = process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) return res.status(500).json({ error: "Could not determine public domain" });

  const publicVideoUrl = `https://${domain}/api/uploads/${jobId}-src.mp4`;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const replicate = new Replicate({ auth: token });

  // 2. Run Robust Video Matting to get alpha mask
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

  // 3. Download alpha mask video
  const maskPath = path.join(UPLOADS_DIR, `${jobId}-mask.mp4`);
  const maskResp = await fetch(alphaMaskUrl);
  if (!maskResp.ok) return res.status(500).json({ error: "Failed to download alpha mask" });
  await writeFile(maskPath, Buffer.from(await maskResp.arrayBuffer()));

  // 4. Get video dimensions + duration
  let vidWidth = 1280, vidHeight = 720, vidDuration = 5;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of csv=p=0 "${srcPath}"`
    );
    const parts = stdout.trim().split(/[\n,]/);
    vidWidth    = parseInt(parts[0], 10) || 1280;
    vidHeight   = parseInt(parts[1], 10) || 720;
    vidDuration = parseFloat(parts[2]) || 5;
  } catch { /* use defaults */ }

  // 5. Extract TWO candidate context frames for GPT:
  //    - Very first frame (0.1s): often has least subject overlap, best for bg context
  //    - Near-last frame: fallback if first is too dark/transitional
  //    We pass whichever gives GPT the clearest background.
  const contextFramePath = path.join(UPLOADS_DIR, `${jobId}-context.png`);
  try {
    // Try first frame (0.1s) — before subject has fully entered the scene
    await execAsync(
      `ffmpeg -y -ss 0.1 -i "${srcPath}" -vframes 1 -q:v 2 "${contextFramePath}"`
    );
  } catch (err: any) {
    return res.status(500).json({ error: `Frame extraction failed: ${err.message}` });
  }

  // 6. GPT-Image-1 targeted edit:
  //    We give it the real scene frame and a strict instruction to ONLY change
  //    what was asked — everything architectural (door frames, windows, built-ins)
  //    must stay identical.
  const bgPath = path.join(UPLOADS_DIR, `${jobId}-bg.png`);
  try {
    const editInstruction =
      `You are editing the BACKGROUND ONLY of this real interior photograph. ` +
      `Make ONLY this change: "${backgroundPrompt}". ` +
      `Treat this like a real-world repaint or redecoration job — NOT a stylised render. ` +
      `ABSOLUTE RULES: ` +
      `(1) If the change is a colour (e.g. "white walls", "blue walls"), use REAL MATTE INTERIOR PAINT — low saturation, realistic flat finish, like Dulux/Benjamin Moore wall paint. NEVER use vivid, glossy, or over-saturated colour. ` +
      `(2) NEVER touch door frames, doorways, windows, archways, skirting boards, stairs or any architectural structure — these are FIXED. ` +
      `(3) NEVER change the floor, ceiling, or any surface not mentioned. ` +
      `(4) NEVER add or remove furniture, objects, or decorations unless explicitly requested. ` +
      `(5) Keep the EXACT same camera angle, perspective, lighting direction, shadows, and colour temperature of the original photo. ` +
      `(6) If any people appear, remove them naturally — inpaint the background behind where they stood. ` +
      `(7) Output must look like a normal real-life photo of the same room with one realistic change applied — same exposure, same warmth, same noise level as the input. ` +
      `(8) Change ONLY the specific surface or element named. Nothing else.`;

    const bgBuffer = await editImages([contextFramePath], editInstruction);
    await writeFile(bgPath, bgBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: `Background editing failed: ${err.message}` });
  }

  // 7. FFmpeg composite — color-match pipeline (THIS IS THE KEY TO REALISM):
  //
  //  Why this works: real cameras pick up ambient light from the environment.
  //  When you stand in a blue room, your skin & clothes pick up a blue cast.
  //  When you stand at sunset, you turn warm/orange. Without this, the cutout
  //  always looks "pasted on" — that's the green-screen look.
  //
  //  Pipeline:
  //   1. bg_main      — slight DOF blur (sigma=1) of the background
  //   2. bg_ambient   — heavy blur (sigma=60) of bg → gives the average colour cast
  //   3. mask_soft    — sigma=1 mask blur (tight edges, no halo)
  //   4. comp         — clean composite of fg over bg
  //   5. softlight blend the bg_ambient over the WHOLE comp at 35% — this
  //      shifts the character's tones to match the new environment's lighting,
  //      making them belong in the scene
  //   6. tiny saturation/contrast bump + light grain unifies the layers
  //
  const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
  const ffmpegCmd = [
    `ffmpeg -y`,
    `-i "${srcPath}"`,
    `-i "${maskPath}"`,
    `-loop 1 -i "${bgPath}"`,
    `-filter_complex`,
    `"[2:v]scale=${vidWidth}:${vidHeight}:force_original_aspect_ratio=increase,crop=${vidWidth}:${vidHeight},gblur=sigma=1[bg_dof];` +
    `[bg_dof]split[bg_main][bg_amb_in];` +
    `[bg_amb_in]gblur=sigma=60,format=yuv420p[bg_ambient];` +
    `[1:v]format=gray,gblur=sigma=1[mask_soft];` +
    `[0:v]format=yuva420p[src_rgba];` +
    `[src_rgba][mask_soft]alphamerge[fg];` +
    `[bg_main][fg]overlay=shortest=1[comp];` +
    `[comp][bg_ambient]blend=all_mode=softlight:all_opacity=0.35:shortest=1,` +
    `eq=contrast=1.04:saturation=1.05,` +
    `noise=alls=4:allf=t+u[out]"`,
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

  // 8. Thumbnail
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
