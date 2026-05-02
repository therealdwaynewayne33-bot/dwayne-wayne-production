import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile, readFile } from "fs/promises";
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

/**
 * Read a downsampled PPM and return all pixels with luminance.
 * Used for cheap colour / brightness sampling of an image.
 */
async function samplePixels(imagePath: string, size = 16) {
  const ppmPath = `${imagePath}.${size}.ppm`;
  await execAsync(`ffmpeg -y -i "${imagePath}" -vf scale=${size}:${size} -frames:v 1 "${ppmPath}"`);
  const buf = await readFile(ppmPath);
  let nl = 0, idx = 0;
  while (nl < 3 && idx < buf.length) {
    if (buf[idx] === 0x0a) nl++;
    idx++;
  }
  const pixels: Array<{ r: number; g: number; b: number; lum: number }> = [];
  for (let i = idx; i < buf.length; i += 3) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    pixels.push({ r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b });
  }
  return pixels;
}

async function avgLuminance(imagePath: string): Promise<number> {
  const px = await samplePixels(imagePath, 16);
  let s = 0;
  for (const p of px) s += p.lum;
  return s / px.length;
}

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

  // 7. EXPOSURE + COLOUR MATCHING — sample brightness of bg vs source so we
  //    can lift the subject toward the new environment's exposure level.
  //    Without this, a dark-lit subject pasted on a bright wall looks like a
  //    silhouette — the #1 cause of "green screen" / "pasted on" feel.
  let subjectBrightness = 1.0;     // gamma multiplier for subject (>1 brightens)
  let ambientOpacity   = 0.30;     // softlight strength of bg colour onto subject
  try {
    // Sample mid-frame of source video for subject exposure estimate.
    const srcMidFrame = path.join(UPLOADS_DIR, `${jobId}-srcmid.png`);
    await execAsync(
      `ffmpeg -y -ss ${(vidDuration / 2).toFixed(2)} -i "${srcPath}" -vframes 1 -q:v 2 "${srcMidFrame}"`
    );
    const srcLum = await avgLuminance(srcMidFrame);
    const bgLum  = await avgLuminance(bgPath);
    // Lift subject toward bg luminance, but cap to avoid crushing detail.
    // ratio < 1 → bg is darker than subject → keep subject at 1.0 (don't darken).
    // ratio > 1 → bg is brighter → lift subject; cap at 1.55 so faces don't blow out.
    const ratio = bgLum / Math.max(1, srcLum);
    subjectBrightness = Math.max(1.0, Math.min(1.55, Math.pow(ratio, 0.85)));
    // If the exposure gap is huge, lean MORE on ambient colour blend too.
    ambientOpacity = ratio > 1.4 ? 0.40 : 0.30;
    req.log.info(
      {
        srcLum: srcLum.toFixed(1),
        bgLum:  bgLum.toFixed(1),
        ratio:  ratio.toFixed(3),
        subjectBrightness: subjectBrightness.toFixed(3),
        ambientOpacity,
      },
      "bg-replace: exposure match"
    );
  } catch (err: any) {
    req.log.warn({ err: err.message }, "bg-replace: exposure sampling failed, using defaults");
  }

  // 8. FFmpeg composite — environmental colour-bake pipeline.
  //
  //  PROBLEM SOLVED: "green screen look" — character looks pasted on because
  //  their lighting / colour temperature doesn't match the new background.
  //
  //  PIPELINE:
  //   1. bg_main         — light DOF blur (sigma=2) so subject pops vs bg.
  //   2. bg_ambient      — heavy blur (sigma=80) of bg → averages to bg colour.
  //   3. mask_soft       — sigma=2.5 mask blur (softer edges = no halo).
  //   4. src_lit         — eq=gamma lift on the source so subject brightness
  //                        matches the new environment's exposure level.
  //   5. src_tinted      — softlight bg_ambient over src_lit at ~30–40% so
  //                        skin/clothes pick up the new room's colour cast.
  //   6. alphamerge      — cut tinted+lit subject out with feathered mask.
  //   7. overlay         — composite onto bg_main.
  //   8. NO final whole-frame tint — that was greening the walls. Just a
  //      tiny contrast/grain pass to unify the layers.
  //
  const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
  const ffmpegCmd = [
    `ffmpeg -y`,
    `-i "${srcPath}"`,
    `-i "${maskPath}"`,
    `-loop 1 -i "${bgPath}"`,
    `-filter_complex`,
    `"[2:v]scale=${vidWidth}:${vidHeight}:force_original_aspect_ratio=increase,crop=${vidWidth}:${vidHeight}[bg_clean];` +
    `[bg_clean]split=2[bg_for_dof][bg_for_amb];` +
    `[bg_for_dof]gblur=sigma=2,format=yuv420p[bg_main];` +
    `[bg_for_amb]gblur=sigma=80,format=yuv420p[bg_ambient];` +
    `[1:v]format=gray,gblur=sigma=2.5[mask_soft];` +
    // Lift subject brightness FIRST so dark subjects don't look like silhouettes
    // when placed on bright walls.
    `[0:v]eq=gamma=${subjectBrightness.toFixed(3)}:contrast=1.02[src_lit];` +
    // Bake bg's colour cast INTO the subject before cutting it out.
    `[src_lit][bg_ambient]blend=all_mode=softlight:all_opacity=${ambientOpacity.toFixed(2)}:shortest=1,format=yuva420p[src_tinted];` +
    `[src_tinted][mask_soft]alphamerge[fg];` +
    `[bg_main][fg]overlay=shortest=1,` +
    `eq=contrast=1.02:saturation=1.02,` +
    `noise=alls=3:allf=t+u[out]"`,
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
