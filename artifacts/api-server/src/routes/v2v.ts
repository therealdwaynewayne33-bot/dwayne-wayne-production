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
// TODO(credits): this route is NOT yet gated by the credit system in
// `lib/credits.ts`. Wire `chargeCredits()` / `refundCredits()` here before
// exposing it to public users, otherwise it bypasses the per-user quota.
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

    // 3. Extract REPRESENTATIVE frames.
    //    - target: use ffmpeg's `thumbnail` filter, which analyses batches of
    //      frames and picks the most representative one (skipping blank/black/
    //      blown-out frames — exactly the bug we just hit where the first
    //      frame of a Luma export was pure white).
    //    - reference: if image, just normalise to PNG; if video, same thumbnail
    //      filter as target.
    //
    //    We also seek a small offset (0.5s) past the start to skip any intro
    //    flash, and analyse the next ~3-4 seconds of frames.
    const targetFramePath = path.join(UPLOADS_DIR, `${jobId}-target-frame.png`);
    const refFramePath    = path.join(UPLOADS_DIR, `${jobId}-ref-frame.png`);
    try {
      const refExtractCmd = refIsImage
        // Image reference — just convert/normalise to PNG (handles HEIC, WebP, etc.)
        ? `ffmpeg -y -i "${referencePath}" -frames:v 1 -q:v 2 "${refFramePath}"`
        // Video reference — pick most representative frame
        : `ffmpeg -y -ss 0.5 -i "${referencePath}" -vf "thumbnail=100" -frames:v 1 -q:v 2 "${refFramePath}"`;
      await Promise.all([
        execAsync(`ffmpeg -y -ss 0.5 -i "${targetPath}" -vf "thumbnail=100" -frames:v 1 -q:v 2 "${targetFramePath}"`),
        execAsync(refExtractCmd),
      ]);

      // Sanity-check the extracted target frame: if it's still blown-out
      // (avg lum > 245) or near-black (< 10), fall back to a hard-seek to
      // 25% of the video duration where there's almost certainly real content.
      const lum = await avgLuminance(targetFramePath);
      if (lum > 245 || lum < 10) {
        req.log.warn({ lum: lum.toFixed(1) }, "v2v: thumbnail frame was blank — re-extracting at 25% duration");
        const fallbackSec = Math.max(0.5, vidDuration * 0.25).toFixed(2);
        await execAsync(`ffmpeg -y -ss ${fallbackSec} -i "${targetPath}" -vframes 1 -q:v 2 "${targetFramePath}"`);
      }
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

    // 5. Transfer the AI-edited frame's GRADE onto the target video.
    //
    // The AI edit step (GPT-Image-1) just produced `editedFramePath` — a single
    // frame showing the target with the requested transfer applied. That frame
    // IS the user's desired look. To carry it onto every frame of the video:
    //
    //   per-channel scale = editedWhitePoint[c] / targetWhitePoint[c]
    //   luminance gain    = editedAvgLuminance  / targetAvgLuminance
    //
    // This transfers the AI's colour decision (warmer / cooler / moodier /
    // graded) onto the entire video using a real white-balance/exposure
    // matching pass — not a stylised filter.
    let sR = 1, sG = 1, sB = 1;
    let brightnessGain = 1;
    let satBoost = 1.0;
    try {
      const [tR, tG, tB] = await whitePoint(targetFramePath);
      const [eR, eG, eB] = await whitePoint(editedFramePath);

      // Per-channel scale to push target whites toward edited whites.
      // Clamp wide enough to allow a real grade (warmer/cooler) but not
      // produce wildly tinted output if AI drifted hard.
      const clamp = (v: number) => Math.max(0.55, Math.min(1.85, v));
      sR = clamp(eR / Math.max(1, tR));
      sG = clamp(eG / Math.max(1, tG));
      sB = clamp(eB / Math.max(1, tB));

      // Luminance match (allow both brighten and darken, gently bounded).
      const tLum = await avgLuminance(targetFramePath);
      const eLum = await avgLuminance(editedFramePath);
      brightnessGain = Math.max(0.75, Math.min(1.40, eLum / Math.max(1, tLum)));

      // Saturation match: chroma = avg distance of pixels from neutral grey.
      const targetPx = await samplePixels(targetFramePath, 32);
      const editedPx = await samplePixels(editedFramePath, 32);
      const chroma = (px: { r: number; g: number; b: number }[]) => {
        let s = 0;
        for (const p of px) {
          const m = (p.r + p.g + p.b) / 3;
          s += Math.abs(p.r - m) + Math.abs(p.g - m) + Math.abs(p.b - m);
        }
        return s / px.length;
      };
      const tSat = chroma(targetPx);
      const eSat = chroma(editedPx);
      satBoost = Math.max(0.80, Math.min(1.50, eSat / Math.max(1, tSat)));

      req.log.info(
        {
          target_wp: [Math.round(tR), Math.round(tG), Math.round(tB)],
          edited_wp: [Math.round(eR), Math.round(eG), Math.round(eB)],
          scale: { r: sR.toFixed(3), g: sG.toFixed(3), b: sB.toFixed(3) },
          target_lum: tLum.toFixed(1),
          edited_lum: eLum.toFixed(1),
          brightnessGain: brightnessGain.toFixed(3),
          satBoost: satBoost.toFixed(3),
        },
        "v2v: grade transfer from AI-edited frame"
      );
    } catch (err: any) {
      req.log.warn({ err: err.message }, "v2v: grade extraction failed, falling back to identity");
    }

    // colorchannelmixer: per-channel multiplicative scaling = white balance shift.
    const wb_filter = `colorchannelmixer=rr=${sR}:gg=${sG}:bb=${sB}`;
    // eq: midtone gamma + contrast/saturation match.
    const exposure_filter = `eq=gamma=${brightnessGain.toFixed(3)}:contrast=1.08:saturation=${satBoost.toFixed(3)}`;

    // COLOR-FIELD BLEND of the AI-edited frame on top of the video.
    //
    //   PROBLEM with naive soft-light blend of the AI frame:
    //     The AI frame contains real picture content (people, furniture,
    //     edges). Blending it on top of moving video locks that structure
    //     onto every frame as a static ghost — the silhouettes of the AI's
    //     people appear baked into the user's moving video. Looks awful.
    //
    //   FIX:
    //     Strip the STRUCTURE out of the AI frame, keep only the COLOUR. We
    //     do this by downscaling it to 16×9 (≈ output aspect ratio at tiny
    //     resolution) then upscaling back with bilinear interp. The result
    //     is a smooth gradient colour field that carries the AI's local
    //     hue/tone decisions across the frame WITHOUT any image structure.
    //
    //     A small downscale (16×9) preserves rough left-right/top-bottom
    //     colour zones — e.g. if the AI graded the sky blue and the ground
    //     warm, that vertical gradient is preserved. Going to 1×1 would
    //     give a pure global colour wash; 16×9 is a sweet spot.
    //
    //   With no structure to ghost, we can push opacity higher (0.65) for a
    //   stronger visible grade.
    const BLEND_OPACITY = 0.65;

    const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
    const ffmpegCmd = [
      `ffmpeg -y`,
      `-i "${targetPath}"`,
      `-loop 1 -i "${editedFramePath}"`,
      `-filter_complex`,
      `"[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,` +
      `${wb_filter},` +
      `${exposure_filter}[base];` +
      // 1) downscale AI frame to 16×9 (kills all structure, keeps local colour zones)
      // 2) upscale back to video size with bilinear smoothing → pure colour field
      `[1:v]scale=16:9,scale=${outW}:${outH}:flags=bilinear,format=yuv420p,setsar=1[grade];` +
      `[base][grade]blend=all_mode='softlight':all_opacity=${BLEND_OPACITY},` +
      `noise=alls=2:allf=t+u[out]"`,
      `-map "[out]" -map "0:a?"`,
      `-shortest`,
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
