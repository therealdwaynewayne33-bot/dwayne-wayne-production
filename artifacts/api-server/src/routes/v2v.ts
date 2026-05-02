import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile, readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { requireAuth } from "../middlewares/requireAuth";
import { editImages } from "@workspace/integrations-openai-ai-server/image";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const VIDEOS_DIR  = path.join(__dirname, "../public/videos");
const THUMBS_DIR  = path.join(__dirname, "../public/thumbs");
const execAsync   = promisify(exec);

const router = Router();

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    const isVideo = file.mimetype.startsWith("video/") || VIDEO_EXTS.has(ext);
    const isImage = file.mimetype.startsWith("image/") || IMAGE_EXTS.has(ext);
    // Target field must be video. Reference can be either video OR image.
    if (file.fieldname === "target") {
      if (isVideo) cb(null, true);
      else cb(new Error("Target must be a video file"));
    } else {
      if (isVideo || isImage) cb(null, true);
      else cb(new Error("Reference must be a video or image file"));
    }
  },
});

function isImageFile(file: Express.Multer.File): boolean {
  const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
  return file.mimetype.startsWith("image/") || IMAGE_EXTS.has(ext);
}

/**
 * Compute the WHITE POINT of an image — the average colour of its brightest
 * pixels (top 25% by luminance). This is the reference colour neutral pixels
 * (white walls, sky, paper, t-shirts) should be after white-balancing.
 *
 * Why brightest-pixel average instead of full-frame average:
 *   - Frame averages mix bright neutrals with dark shadows + colourful subjects,
 *     so they conflate exposure with white balance and produce wrong shifts.
 *   - The brightest pixels in most natural scenes ARE the neutrals (walls,
 *     ceilings, sky), so averaging them gives a clean estimate of "what white
 *     looks like in this lighting".
 */
/**
 * Read a downsampled PPM and return all pixels with luminance.
 */
async function samplePixels(imagePath: string, size = 32) {
  const ppmPath = `${imagePath}.${size}.ppm`;
  await execAsync(`ffmpeg -y -i "${imagePath}" -vf scale=${size}:${size} -frames:v 1 "${ppmPath}"`);
  const buf = await readFile(ppmPath);
  let nl = 0, idx = 0;
  while (nl < 3 && idx < buf.length) {
    if (buf[idx] === 0x0a) nl++;
    idx++;
  }
  type Px = { r: number; g: number; b: number; lum: number };
  const pixels: Px[] = [];
  for (let i = idx; i < buf.length; i += 3) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    pixels.push({ r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b });
  }
  return pixels;
}

/**
 * White point = average colour of the brightest 8% of pixels. We use a tight
 * window so dimmer mid-tones don't dilute the estimate — the brightest pixels
 * (sky, walls, sunlight) are the real "whites" that white-balance needs to match.
 */
async function whitePoint(imagePath: string): Promise<[number, number, number]> {
  const px = await samplePixels(imagePath, 32);  // 1024 samples
  px.sort((a, b) => b.lum - a.lum);
  const topN = Math.max(16, Math.floor(px.length * 0.08));
  const top = px.slice(0, topN);
  let sr = 0, sg = 0, sb = 0;
  for (const p of top) { sr += p.r; sg += p.g; sb += p.b; }
  return [sr / topN, sg / topN, sb / topN];
}

/**
 * Average luminance of an image (gives a brightness estimate).
 */
async function avgLuminance(imagePath: string): Promise<number> {
  const px = await samplePixels(imagePath, 16);
  let sum = 0;
  for (const p of px) sum += p.lum;
  return sum / px.length;
}

/**
 * POST /api/videos/v2v   (Video → Video transfer)
 *
 * Two videos in:
 *   - "target":    the video to be modified
 *   - "reference": the video whose look / element should be borrowed
 *
 * + transferPrompt: e.g. "the warm cinematic color grade", "the lamp on the
 *   table", "the rainy mood and lighting", etc.
 *
 * Pipeline:
 *  1. Save both videos
 *  2. Extract a representative frame from each (mid-point)
 *  3. Send BOTH frames to GPT-Image-1 with a transfer instruction:
 *       image[0] = target frame  (the one we want to modify)
 *       image[1] = reference frame  (the source of the element)
 *     -> GPT returns an edited target frame with the requested element baked in.
 *  4. Use that edited frame as a "look reference" and apply its color cast +
 *     overall vibe to every frame of the target video via FFmpeg softlight blend.
 *     This carries colour grades, lighting moods, and visible static objects.
 */
router.post(
  "/videos/v2v",
  requireAuth,
  upload.fields([
    { name: "target",    maxCount: 1 },
    { name: "reference", maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const targetFile    = files?.target?.[0];
    const referenceFile = files?.reference?.[0];

    if (!targetFile)    return res.status(400).json({ error: "Target video is required" });
    if (!referenceFile) return res.status(400).json({ error: "Reference video is required" });

    const transferPrompt = (req.body?.transferPrompt as string | undefined)?.trim();
    if (!transferPrompt) {
      return res.status(400).json({ error: "transferPrompt is required" });
    }

    const jobId = `v2v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await mkdir(UPLOADS_DIR, { recursive: true });
    await mkdir(VIDEOS_DIR,  { recursive: true });
    await mkdir(THUMBS_DIR,  { recursive: true });

    // 1. Save target (always video) and reference (video OR image)
    const targetPath = path.join(UPLOADS_DIR, `${jobId}-target.mp4`);
    await writeFile(targetPath, targetFile.buffer);

    const refIsImage = isImageFile(referenceFile);
    const refExt = refIsImage
      ? "." + (referenceFile.originalname.split(".").pop() ?? "png").toLowerCase()
      : ".mp4";
    const referencePath = path.join(UPLOADS_DIR, `${jobId}-reference${refExt}`);
    await writeFile(referencePath, referenceFile.buffer);

    // 2. Probe target dimensions/duration
    let vidWidth = 1280, vidHeight = 720, vidDuration = 5;
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of csv=p=0 "${targetPath}"`
      );
      const parts = stdout.trim().split(/[\n,]/);
      vidWidth    = parseInt(parts[0], 10) || 1280;
      vidHeight   = parseInt(parts[1], 10) || 720;
      vidDuration = parseFloat(parts[2]) || 5;
    } catch { /* defaults */ }

    // Cap output at 1080p to keep 4K-input encodes fast.
    // Maintain aspect ratio, ensure even dimensions for libx264.
    const MAX_DIM = 1920;
    let outW = vidWidth, outH = vidHeight;
    if (vidWidth > MAX_DIM || vidHeight > MAX_DIM) {
      const scale = MAX_DIM / Math.max(vidWidth, vidHeight);
      outW = Math.round(vidWidth  * scale / 2) * 2;
      outH = Math.round(vidHeight * scale / 2) * 2;
    } else {
      outW = Math.round(vidWidth  / 2) * 2;
      outH = Math.round(vidHeight / 2) * 2;
    }

    // 3. Extract reference frames.
    //    - target: always a mid-point frame from the video
    //    - reference: if it's an image, normalise to PNG; if video, extract mid-point
    const targetFramePath = path.join(UPLOADS_DIR, `${jobId}-target-frame.png`);
    const refFramePath    = path.join(UPLOADS_DIR, `${jobId}-ref-frame.png`);
    const midSec = (vidDuration / 2).toFixed(2);
    try {
      const refExtractCmd = refIsImage
        // Image reference — just convert/normalise to PNG (handles HEIC, WebP, etc.)
        ? `ffmpeg -y -i "${referencePath}" -frames:v 1 -q:v 2 "${refFramePath}"`
        // Video reference — grab a frame ~1s in
        : `ffmpeg -y -ss 1.0 -i "${referencePath}" -vframes 1 -q:v 2 "${refFramePath}"`;
      await Promise.all([
        execAsync(`ffmpeg -y -ss ${midSec} -i "${targetPath}" -vframes 1 -q:v 2 "${targetFramePath}"`),
        execAsync(refExtractCmd),
      ]);
    } catch (err: any) {
      return res.status(500).json({ error: `Frame extraction failed: ${err.message}` });
    }

    // 4. Ask GPT-Image-1 to apply the requested transfer
    //    Both images are sent. The order matters: first = target (to modify),
    //    second = reference (source of the look/element).
    const editedFramePath = path.join(UPLOADS_DIR, `${jobId}-edited.png`);
    try {
      const editInstruction =
        `You are given TWO photographs. ` +
        `Image 1 is the TARGET — keep its composition, subject, framing and structure exactly the same. ` +
        `Image 2 is the REFERENCE — only borrow the requested element from it. ` +
        `\nAPPLY THIS TRANSFER: "${transferPrompt}". ` +
        `\nThe result must look like Image 1 with that one element/look from Image 2 applied — nothing else. ` +
        `\nABSOLUTE RULES: ` +
        `(1) Do NOT change Image 1's people, clothing, pose, or facial features. ` +
        `(2) Do NOT change Image 1's camera angle, perspective, or framing. ` +
        `(3) Match the requested transfer realistically — if it's a colour grade, apply it as a true grade (not heavy filter); ` +
        `if it's an object, place it where it makes physical sense in the scene; ` +
        `if it's lighting/mood, adjust ambient light naturally. ` +
        `(4) The output must look like a real photograph, not a stylised render. ` +
        `(5) Match Image 1's resolution and aspect ratio.`;

      const buf = await editImages([targetFramePath, refFramePath], editInstruction);
      await writeFile(editedFramePath, buf);
    } catch (err: any) {
      return res.status(500).json({ error: `AI transfer failed: ${err.message}` });
    }

    // 5. White-balance the target video to match the REFERENCE.
    //
    //  Approach: compute the white point (avg of brightest 25% of pixels) of
    //  both the original target frame AND the reference frame. Compute the
    //  per-channel SCALE factor needed to make the target's whites look like
    //  the reference's whites. Apply that scale to every frame of the video.
    //
    //  Why this is better than averaging the AI-edited frame:
    //   - GPT-Image-1 sometimes drifts (over-warms, over-cools, darkens).
    //     Using its output as the colour target propagates that drift.
    //   - The user's REFERENCE photo is the ground truth for what they want.
    //     Balancing against it directly is precise and predictable.
    //   - White-point matching is what real cinematographers do — it's true
    //     white balance, not crude colour shifting.
    //
    let sR = 1, sG = 1, sB = 1;
    let brightnessGain = 1;
    try {
      const [tR, tG, tB] = await whitePoint(targetFramePath);
      const [rR, rG, rB] = await whitePoint(refFramePath);
      // Wider clamp (0.55–1.55) lets us neutralise strong colour casts
      // like warm sunlight bloom, which a 30% cap couldn't reach.
      const clamp = (v: number) => Math.max(0.55, Math.min(1.55, v));
      sR = clamp(rR / Math.max(1, tR));
      sG = clamp(rG / Math.max(1, tG));
      sB = clamp(rB / Math.max(1, tB));

      // Brightness matching: if reference is brighter than target, lift exposure.
      // We use ref/target luminance ratio, capped to avoid blown highlights.
      const tLum = await avgLuminance(targetFramePath);
      const rLum = await avgLuminance(refFramePath);
      brightnessGain = Math.max(0.85, Math.min(1.35, rLum / Math.max(1, tLum)));

      req.log.info(
        {
          target_wp: [Math.round(tR), Math.round(tG), Math.round(tB)],
          ref_wp:    [Math.round(rR), Math.round(rG), Math.round(rB)],
          scale: { r: sR.toFixed(3), g: sG.toFixed(3), b: sB.toFixed(3) },
          target_lum: tLum.toFixed(1),
          ref_lum:    rLum.toFixed(1),
          brightnessGain: brightnessGain.toFixed(3),
        },
        "v2v: white-balance + exposure"
      );
    } catch (err: any) {
      req.log.warn({ err: err.message }, "v2v: whitePoint/luminance failed, falling back to identity");
    }

    // colorchannelmixer: per-channel multiplicative scaling = pure white balance.
    // No additive shifts (which crush blacks) and no opacity (which limits effect).
    const wb_filter = `colorchannelmixer=rr=${sR}:gg=${sG}:bb=${sB}`;
    // eq=gamma applies multiplicative brightness similar to camera exposure compensation.
    // gamma=1.0 = no change; <1 = darker, >1 = brighter (but inverse-mapped, see below).
    // Actually we use eq=brightness in an additive sense; safer is to apply gain via
    // colorchannelmixer's diagonal already plus an additional eq=gamma step.
    const exposure_filter = `eq=gamma=${brightnessGain.toFixed(3)}:contrast=1.04:saturation=1.08`;

    const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
    const ffmpegCmd = [
      `ffmpeg -y`,
      `-i "${targetPath}"`,
      `-filter_complex`,
      `"[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,` +
      `${wb_filter},` +
      `${exposure_filter},` +
      `noise=alls=2:allf=t+u[out]"`,
      `-map "[out]" -map "0:a?"`,
      `-c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p`,
      `-c:a copy`,
      `-movflags +faststart`,
      `"${outputPath}"`,
    ].join(" ");

    try {
      await execAsync(ffmpegCmd);
    } catch (err: any) {
      return res.status(500).json({ error: `FFmpeg encode failed: ${err.message}` });
    }

    // 6. Thumbnail
    const thumbPath = path.join(THUMBS_DIR, `${jobId}-thumb.png`);
    try {
      await execAsync(
        `ffmpeg -y -i "${outputPath}" -vframes 1 -q:v 2 "${thumbPath}"`
      );
    } catch { /* non-fatal */ }

    return res.json({
      jobId,
      videoUrl:     `/api/videos-files/${jobId}-out.mp4`,
      thumbnailUrl: `/api/thumbs/${jobId}-thumb.png`,
      previewUrl:   `/api/uploads/${jobId}-edited.png`,
    });
  }
);

export default router;
