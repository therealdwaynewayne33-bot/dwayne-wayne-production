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
 * Compute the average RGB colour of an image by scaling it to a single pixel
 * and reading the raw bytes from a PPM file.
 *
 * PPM (P6) layout:
 *   "P6\n<width> <height>\n<maxval>\n<raw RGB bytes>"
 */
async function avgRGB(imagePath: string): Promise<[number, number, number]> {
  const ppmPath = `${imagePath}.avg.ppm`;
  await execAsync(`ffmpeg -y -i "${imagePath}" -vf scale=1:1 -frames:v 1 "${ppmPath}"`);
  const buf = await readFile(ppmPath);
  let nl = 0, idx = 0;
  while (nl < 3 && idx < buf.length) {
    if (buf[idx] === 0x0a) nl++;
    idx++;
  }
  return [buf[idx], buf[idx + 1], buf[idx + 2]];
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

    // 5. Compute the colour DELTA between the original target frame and the
    //    AI-edited target frame, then push the entire video toward the AI
    //    look using ffmpeg's `colorbalance` filter.
    //
    //  Why this is better than the old softlight-blend approach:
    //   - softlight blend is opacity-limited; subtle reference colours barely
    //     shift the result.
    //   - colorbalance with computed deltas is a TRUE colour transform: every
    //     pixel gets the exact RGB shift needed to match the AI's intended tone.
    //   - We boost the delta 1.6× so subtle reference looks (e.g. two indoor
    //     videos with similar lighting) still produce a clearly visible grade.
    //
    let cr = 0, cg = 0, cb = 0;
    try {
      const [er, eg, eb] = await avgRGB(editedFramePath);
      const [tr, tg, tb] = await avgRGB(targetFramePath);
      const BOOST = 1.6;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      cr = clamp(((er - tr) / 255) * BOOST);
      cg = clamp(((eg - tg) / 255) * BOOST);
      cb = clamp(((eb - tb) / 255) * BOOST);
      req.log.info({ deltaR: cr.toFixed(3), deltaG: cg.toFixed(3), deltaB: cb.toFixed(3) }, "v2v: colour transfer deltas");
    } catch (err: any) {
      req.log.warn({ err: err.message }, "v2v: avgRGB failed, falling back to no-shift");
    }

    // colorbalance: rs/gs/bs = shadows, rm/gm/bm = midtones, rh/gh/bh = highlights
    // Same delta for all three keeps the shift uniform across the tonal range.
    const cb_filter = `colorbalance=rs=${cr}:gs=${cg}:bs=${cb}:rm=${cr}:gm=${cg}:bm=${cb}:rh=${cr}:gh=${cg}:bh=${cb}`;

    const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
    const ffmpegCmd = [
      `ffmpeg -y`,
      `-i "${targetPath}"`,
      `-filter_complex`,
      `"[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,` +
      `${cb_filter},` +
      `eq=contrast=1.06:saturation=1.12,` +
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
