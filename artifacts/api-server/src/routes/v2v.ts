import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import { requireAuth } from "../middlewares/requireAuth";
import { editImages } from "@workspace/integrations-openai-ai-server/image";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { resolveFfmpegBin } from "../lib/ffmpeg";
import { allowsFullSceneVideoTransfer, isSpecificObjectEditIntent } from "../lib/object-edit-intent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const VIDEOS_DIR  = path.join(__dirname, "../public/videos");
const THUMBS_DIR  = path.join(__dirname, "../public/thumbs");
const execFileAsync = promisify(execFile);

const router = Router();

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);

type TransferMode =
  | "fast_color_grade"
  | "luma_style_cinematic_fast"
  | "ai_openai_transfer"
  | "ai_transfer"
  | "ai_luma_rerender";

function requiresOpenAI(mode: TransferMode): boolean {
  return mode === "ai_openai_transfer" || mode === "ai_transfer";
}

function requiresLuma(mode: TransferMode): boolean {
  return mode === "ai_luma_rerender";
}

function requiresFFmpegOnly(mode: TransferMode): boolean {
  return mode === "fast_color_grade" || mode === "luma_style_cinematic_fast";
}

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

const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

function isImageFile(file: Express.Multer.File): boolean {
  const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
  return file.mimetype.startsWith("image/") || IMAGE_EXTS.has(ext);
}

function isAllowedApiAssetPath(value: unknown): value is string {
  return typeof value === "string" &&
    (value.startsWith("/api/uploads/") || value.startsWith("/api/videos-files/")) &&
    !value.includes("..");
}

function apiAssetUrlToLocalPath(assetUrl: string): string {
  if (assetUrl.startsWith("/api/uploads/")) {
    return path.join(UPLOADS_DIR, assetUrl.slice("/api/uploads/".length));
  }
  if (assetUrl.startsWith("/api/videos-files/")) {
    return path.join(VIDEOS_DIR, assetUrl.slice("/api/videos-files/".length));
  }
  throw new Error("Unsupported asset path");
}

function resolveReplicateUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof (output as any).url === "function") return (output as any).url().href;
  if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    if (typeof item === "string") return item;
    if (item && typeof (item as any).url === "function") return (item as any).url().href;
  }
  throw new Error("Unexpected output format from Replicate model");
}

async function downloadToFile(url: string, filePath: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to download ${url}: ${r.status}`);
  await writeFile(filePath, Buffer.from(await r.arrayBuffer()));
}

type VideoProbe = {
  container: string;
  codecName: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  bitrate: number;
};

async function probeVideoStream(inputPath: string): Promise<VideoProbe> {
  const ffprobeBin = ffprobeStatic?.path || "ffprobe";
  const { stdout } = await execFileAsync(ffprobeBin, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "format=format_name,duration,bit_rate:stream=codec_name,width,height,avg_frame_rate",
    "-of", "json",
    inputPath,
  ]);
  const parsed = JSON.parse(stdout || "{}");
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
  if (!stream) throw new Error("No readable video stream found.");
  const width = Number(stream.width ?? 0);
  const height = Number(stream.height ?? 0);
  if (!width || !height) throw new Error("Invalid video dimensions.");
  const avgFrameRate = String(stream.avg_frame_rate ?? "0/1");
  const [numRaw, denRaw] = avgFrameRate.split("/");
  const num = Number(numRaw);
  const den = Number(denRaw || 1);
  const fps = den > 0 ? num / den : 0;
  const format = parsed?.format ?? {};
  const durationSec = Number(format.duration ?? 0);
  const bitrate = Number(format.bit_rate ?? 0);
  return {
    container: String(format.format_name ?? "unknown"),
    codecName: String(stream.codec_name ?? "unknown"),
    width,
    height,
    fps,
    durationSec,
    bitrate,
  };
}

async function validateReadableMedia(inputPath: string, label: string): Promise<VideoProbe> {
  try {
    return await probeVideoStream(inputPath);
  } catch (err: any) {
    throw new Error(`${label} is corrupt or unreadable: ${err?.message ?? String(err)}`);
  }
}

function chooseNormalizedFps(sourceFps: number): 24 | 30 {
  if (sourceFps > 0 && Math.abs(sourceFps - 24) <= 2) return 24;
  return 30;
}

async function validatePreviewPlayback(inputPath: string, label: string) {
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, [
    "-v", "error",
    "-ss", "0",
    "-t", "1.5",
    "-i", inputPath,
    "-an",
    "-f", "null",
    "-",
  ]);
  // If ffmpeg decode fails, execFileAsync throws and caller surfaces friendly error.
}

async function normalizeForLuma(inputPath: string, outputPath: string): Promise<VideoProbe> {
  const source = await validateReadableMedia(inputPath, "Source Luma input");
  const outFps = chooseNormalizedFps(source.fps);
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, [
    "-y",
    "-i", inputPath,
    "-vf", `scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=${outFps},format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-movflags", "+faststart",
    "-c:a", "aac",
    "-b:a", "128k",
    outputPath,
  ]);
  const normalized = await validateReadableMedia(outputPath, "Normalized Luma input");
  await validatePreviewPlayback(outputPath, "Normalized Luma input");
  return normalized;
}

function isBgReplaceDemoMode(): boolean {
  return (process.env.BG_REPLACE_DEMO_MODE ?? "true").toLowerCase() === "true";
}

function resolveReplicateFileGetUrl(fileResource: any): string {
  const getUrl = fileResource?.urls?.get;
  if (typeof getUrl !== "string" || !getUrl.startsWith("http")) {
    throw new Error("Replicate file upload returned an invalid URL.");
  }
  return getUrl;
}

async function uploadLocalAssetForReplicate(
  replicate: Replicate,
  localPath: string,
  metadata: Record<string, string>,
): Promise<string> {
  const buf = await readFile(localPath);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const uploaded = await replicate.files.create(buf, { ...metadata, attempt: String(attempt) });
      return resolveReplicateFileGetUrl(uploaded);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Replicate file upload failed"));
}

router.post("/render/upload-media", requireAuth, uploadSingle.single("file"), async (req, res) => {
  try {
    const kind = req.body?.kind === "reference" ? "reference" : "target";
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const ext = "." + (req.file.originalname.split(".").pop() ?? "").toLowerCase();
    const isVideo = req.file.mimetype.startsWith("video/") || VIDEO_EXTS.has(ext);
    const isImage = req.file.mimetype.startsWith("image/") || IMAGE_EXTS.has(ext);
    if (kind === "target" && !isVideo) {
      return res.status(400).json({ error: "Target must be a video file" });
    }
    if (kind === "reference" && !(isVideo || isImage)) {
      return res.status(400).json({ error: "Reference must be a video or image file" });
    }

    await mkdir(UPLOADS_DIR, { recursive: true });
    const id = `upl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeExt = ext && /^[.a-z0-9]+$/.test(ext) ? ext : isImage ? ".png" : ".mp4";
    const fileName = `${id}-${kind}${safeExt}`;
    const filePath = path.join(UPLOADS_DIR, fileName);
    await writeFile(filePath, req.file.buffer);
    try {
      await validateReadableMedia(filePath, kind === "target" ? "Target upload" : "Reference upload");
    } catch (err: any) {
      await unlink(filePath).catch(() => {});
      return res.status(400).json({ error: err?.message ?? "Uploaded media could not be decoded" });
    }
    return res.json({
      success: true,
      kind,
      fileName,
      url: `/api/uploads/${fileName}`,
      mimeType: req.file.mimetype,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Upload failed" });
  }
});

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
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-i", imagePath, "-vf", `scale=${size}:${size}`, "-frames:v", "1", ppmPath]);
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
 * POST /api/render/ai-video-to-video   (Video → Video transfer)
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
  ["/render/ai-video-to-video", "/render/openai-transfer"],
  requireAuth,
  upload.fields([
    { name: "target",    maxCount: 1 },
    { name: "reference", maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const targetFile    = files?.target?.[0];
    const referenceFile = files?.reference?.[0];
    const inputVideoUrl = req.body?.inputVideoUrl as string | undefined;
    const referenceUrl = req.body?.referenceUrl as string | undefined;
    const hasFilePayload = Boolean(targetFile && referenceFile);
    const hasUrlPayload = isAllowedApiAssetPath(inputVideoUrl) && isAllowedApiAssetPath(referenceUrl);
    if (!hasFilePayload && !hasUrlPayload) {
      return res.status(400).json({
        error: "Target and reference are required as files or uploaded URLs.",
      });
    }

    const transferPrompt = (req.body?.transferPrompt as string | undefined)?.trim();
    if (!transferPrompt) {
      return res.status(400).json({ error: "transferPrompt is required" });
    }
    if (
      !allowsFullSceneVideoTransfer(req.body as Record<string, unknown>) &&
      isSpecificObjectEditIntent(transferPrompt)
    ) {
      return res.status(422).json({
        error:
          "This prompt describes a localized object change. Use targeted object editing (detect mask → track → masked edit → composite) via POST /api/render/production with selectedMode=object_edit instead of full video-to-video.",
        code: "USE_TARGETED_OBJECT_EDIT",
        hint: "Plain video-to-video here is only for full-scene style / grade transfer. Set allowFullSceneVideoTransfer=true if you intentionally want a global pass.",
      });
    }
    const requestedMode = (typeof req.body?.selectedMode === "string" ? req.body.selectedMode : "ai_transfer") as TransferMode;
    const selectedMode: TransferMode =
      requestedMode === "ai_luma_rerender" || requestedMode === "ai_transfer" || requestedMode === "ai_openai_transfer"
        ? requestedMode
        : "ai_transfer";
    const selectedRoute = req.path;
    const selectedEngine = selectedMode === "ai_luma_rerender" ? "luma" : "ai";

    const jobId = `v2v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await mkdir(UPLOADS_DIR, { recursive: true });
    await mkdir(VIDEOS_DIR,  { recursive: true });
    await mkdir(THUMBS_DIR,  { recursive: true });

    // 1. Resolve target and reference from either direct files or prior uploaded URLs.
    let targetPath: string;
    let referencePath: string;
    let refIsImage = false;
    let refExt = ".mp4";
    let debugInputUrl = "";
    let debugReferenceUrl = "";
    if (hasFilePayload) {
      const tFile = targetFile!;
      const rFile = referenceFile!;
      targetPath = path.join(UPLOADS_DIR, `${jobId}-target.mp4`);
      await writeFile(targetPath, tFile.buffer);
      refIsImage = isImageFile(rFile);
      refExt = refIsImage
        ? "." + (rFile.originalname.split(".").pop() ?? "png").toLowerCase()
        : ".mp4";
      referencePath = path.join(UPLOADS_DIR, `${jobId}-reference${refExt}`);
      await writeFile(referencePath, rFile.buffer);
      try {
        await validateReadableMedia(targetPath, "Target upload");
        await validateReadableMedia(referencePath, "Reference upload");
      } catch (err: any) {
        return res.status(400).json({ error: err?.message ?? "Uploaded media could not be decoded" });
      }
      debugInputUrl = `/api/uploads/${jobId}-target.mp4`;
      debugReferenceUrl = `/api/uploads/${jobId}-reference${refExt}`;
    } else {
      targetPath = apiAssetUrlToLocalPath(inputVideoUrl!);
      referencePath = apiAssetUrlToLocalPath(referenceUrl!);
      refExt = path.extname(referencePath).toLowerCase() || ".mp4";
      refIsImage = IMAGE_EXTS.has(refExt);
      debugInputUrl = inputVideoUrl!;
      debugReferenceUrl = referenceUrl!;
      try {
        await validateReadableMedia(targetPath, "Target upload");
        await validateReadableMedia(referencePath, "Reference upload");
      } catch (err: any) {
        return res.status(400).json({ error: err?.message ?? "Uploaded media URL points to unreadable file" });
      }
    }

    if (selectedMode === "ai_luma_rerender") {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) {
        return res.status(500).json({ error: "REPLICATE_API_TOKEN is missing. Add it to .env.local and restart the server." });
      }
      const replicate = new Replicate({ auth: token });
      const normalizedTargetPath = path.join(UPLOADS_DIR, `${jobId}-target-luma.mp4`);
      const normalizedReferencePath = path.join(UPLOADS_DIR, `${jobId}-reference-luma.mp4`);
      try {
        const sourceProbe = await validateReadableMedia(targetPath, "Target upload");
        await normalizeForLuma(targetPath, normalizedTargetPath);
        if (!refIsImage) {
          await normalizeForLuma(referencePath, normalizedReferencePath);
        }
        req.log.info(
          {
            jobId,
            targetCodec: sourceProbe.codecName,
            targetWidth: sourceProbe.width,
            targetHeight: sourceProbe.height,
            normalized: "h264-1920x1080",
          },
          "v2v: normalized target media for Luma",
        );
      } catch (err: any) {
        return res.status(400).json({
          error: `Luma input validation failed before prediction: ${err?.message ?? String(err)}`,
        });
      }
      const domain = process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0] ?? null;
      let targetModelInputUrl = "";
      let referenceModelInputUrl = "";
      if (domain && debugInputUrl && debugReferenceUrl) {
        targetModelInputUrl = `https://${domain}/api/uploads/${jobId}-target-luma.mp4`;
        referenceModelInputUrl = refIsImage
          ? `https://${domain}${debugReferenceUrl}`
          : `https://${domain}/api/uploads/${jobId}-reference-luma.mp4`;
      } else {
        // Local Windows/dev fallback: upload source files to Replicate temporary file URLs.
        // This removes the need for a public localhost domain before calling Luma.
        try {
          targetModelInputUrl = await uploadLocalAssetForReplicate(replicate, normalizedTargetPath, {
            jobId,
            kind: "target-luma-normalized",
            route: "ai_luma_rerender",
          });
          referenceModelInputUrl = refIsImage
            ? await uploadLocalAssetForReplicate(replicate, referencePath, {
                jobId,
                kind: "reference-image",
                route: "ai_luma_rerender",
              })
            : await uploadLocalAssetForReplicate(replicate, normalizedReferencePath, {
                jobId,
                kind: "reference-luma-normalized",
                route: "ai_luma_rerender",
              });
          req.log.info({ jobId, refIsImage }, "v2v: uploaded normalized local media for Luma input");
        } catch (err: any) {
          if (isBgReplaceDemoMode()) {
            return res.status(500).json({
              error:
                `No public domain detected and local fallback upload failed (${err?.message ?? String(err)}). ` +
                "Keep BG_REPLACE_DEMO_MODE=true for local dev bypass or provide REPLIT_DEV_DOMAIN.",
            });
          }
          return res.status(500).json({
            error:
              `Could not prepare Luma input URLs without a public domain (${err?.message ?? String(err)}). ` +
              "Set REPLIT_DEV_DOMAIN or enable BG_REPLACE_DEMO_MODE=true.",
          });
        }
      }
      if (!targetModelInputUrl || !referenceModelInputUrl) {
        return res.status(500).json({ error: "Luma input URL preparation failed." });
      }
      const lumaPrompt =
        transferPrompt ||
        "copy the cinematic film look, lighting, color, contrast, mood, and realistic AI render style from the reference video";

      const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
      try {
        const output = await replicate.run("luma/modify-video", {
          input: {
            video: targetModelInputUrl,
            prompt: `${lumaPrompt}\nReference style source: ${referenceModelInputUrl}`,
            mode: "flex_1",
          },
        });
        const lumaUrl = resolveReplicateUrl(output);
        await downloadToFile(lumaUrl, outputPath);
      } catch (err: any) {
        return res.status(500).json({ error: `AI Luma render failed: ${err?.message ?? String(err)}` });
      }

      const thumbPath = path.join(THUMBS_DIR, `${jobId}-thumb.png`);
      try {
        const bin = resolveFfmpegBin(ffmpegPath);
        await execFileAsync(bin, ["-y", "-i", outputPath, "-vframes", "1", "-q:v", "2", thumbPath]);
      } catch {
        // non-fatal
      }

      const cacheBuster = Date.now();
      return res.json({
        jobId,
        selectedMode: "ai_luma_rerender",
        selectedRoute,
        selectedEngine: "luma",
        inputVideoUrl: debugInputUrl,
        referenceUrl: debugReferenceUrl,
        videoUrl: `/api/videos-files/${jobId}-out.mp4?v=${cacheBuster}`,
        outputUrl: `/api/videos-files/${jobId}-out.mp4?v=${cacheBuster}`,
        thumbnailUrl: `/api/thumbs/${jobId}-thumb.png?v=${cacheBuster}`,
        previewUrl: debugReferenceUrl,
      });
    }

    // 2. Probe target dimensions/duration
    let vidWidth = 1280, vidHeight = 720, vidDuration = 5;
    try {
      const ffprobeBin = ffprobeStatic?.path || "ffprobe";
      const { stdout } = await execFileAsync(ffprobeBin, [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        targetPath,
      ]);
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
      const bin = resolveFfmpegBin(ffmpegPath);
      const refExtractCmd = refIsImage
        // Image reference — just convert/normalise to PNG (handles HEIC, WebP, etc.)
        ? [bin, ["-y", "-i", referencePath, "-frames:v", "1", "-q:v", "2", refFramePath]] as const
        // Video reference — pick most representative frame
        : [bin, ["-y", "-ss", "0.5", "-i", referencePath, "-vf", "thumbnail=100", "-frames:v", "1", "-q:v", "2", refFramePath]] as const;
      await Promise.all([
        execFileAsync(bin, ["-y", "-ss", "0.5", "-i", targetPath, "-vf", "thumbnail=100", "-frames:v", "1", "-q:v", "2", targetFramePath]),
        execFileAsync(refExtractCmd[0], refExtractCmd[1]),
      ]);

      // Sanity-check the extracted target frame: if it's still blown-out
      // (avg lum > 245) or near-black (< 10), fall back to a hard-seek to
      // 25% of the video duration where there's almost certainly real content.
      const lum = await avgLuminance(targetFramePath);
      if (lum > 245 || lum < 10) {
        req.log.warn({ lum: lum.toFixed(1) }, "v2v: thumbnail frame was blank — re-extracting at 25% duration");
        const fallbackSec = Math.max(0.5, vidDuration * 0.25).toFixed(2);
        await execFileAsync(bin, ["-y", "-ss", fallbackSec, "-i", targetPath, "-vframes", "1", "-q:v", "2", targetFramePath]);
      }
    } catch (err: any) {
      return res.status(500).json({ error: `Frame extraction failed: ${err.message}` });
    }

    // 4. Ask GPT-Image-1 to apply the requested transfer
    //    Both images are sent. The order matters: first = target (to modify),
    //    second = reference (source of the look/element).
    const editedFramePath = path.join(UPLOADS_DIR, `${jobId}-edited.png`);
    try {
      if (requiresFFmpegOnly(selectedMode)) {
        return res.status(400).json({ error: "Wrong route for selected transfer mode" });
      }
      if (requiresLuma(selectedMode)) {
        return res.status(501).json({
          error: "AI Luma Re-Render is not configured for /render/ai-video-to-video in this environment.",
        });
      }
      if (requiresOpenAI(selectedMode) && !process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
        return res.status(500).json({
          error: "OpenAI integration is not configured. This is only needed for OpenAI AI transfer, not fast color grading.",
        });
      }
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
      // Wide clamp: allow strong warmer/cooler shifts so a "Warm sunset" or
      // "Cool teal" preset actually looks visibly warm or cool.
      const clamp = (v: number) => Math.max(0.45, Math.min(2.10, v));
      sR = clamp(eR / Math.max(1, tR));
      sG = clamp(eG / Math.max(1, tG));
      sB = clamp(eB / Math.max(1, tB));

      // Luminance match (allow both brighten and darken, generously bounded).
      const tLum = await avgLuminance(targetFramePath);
      const eLum = await avgLuminance(editedFramePath);
      brightnessGain = Math.max(0.65, Math.min(1.55, eLum / Math.max(1, tLum)));

      // Saturation match: chroma = avg distance of pixels from neutral grey.
      // CRITICAL: never desaturate. A colour grade should ADD punch; if the
      // AI's frame is less saturated than the source, fall back to a small
      // default boost (1.10) so the user always sees a visibly graded result.
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
      const ratio = eSat / Math.max(1, tSat);
      satBoost = Math.max(1.10, Math.min(1.70, ratio));

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
    // eq: midtone gamma + contrast/saturation match. Punchier contrast (1.12)
    // makes the grade feel like a real cinematic look, not a flat tint.
    const exposure_filter = `eq=gamma=${brightnessGain.toFixed(3)}:contrast=1.12:saturation=${satBoost.toFixed(3)}`;

    // NOTE: Earlier versions of this route soft-light-blended the AI-edited
    // frame on top of every video frame to "transfer the look". Two failure
    // modes killed that approach:
    //   1. Full-resolution blend ghosted the AI's people/objects onto the user's
    //      moving video as a static silhouette layer.
    //   2. Downscaled-then-upscaled blend produced a near-neutral colour field
    //      (~RGB 128) which under soft-light is mathematically a no-op AND
    //      actively pulled the WB-shifted pixels back toward neutral, undoing
    //      the grade.
    // Conclusion: the right tool for transferring an AI-frame's GRADE onto a
    // video is per-pixel colour-math (WB + exposure + saturation), not pixel
    // blending. The math above already encodes the AI's colour decision into
    // the video deterministically and visibly.

    const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);

    try {
      const bin = resolveFfmpegBin(ffmpegPath);
      const vf =
        `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,` +
        `${wb_filter},` +
        `${exposure_filter},` +
        `noise=alls=2:allf=t+u`;
      await execFileAsync(bin, [
        "-y",
        "-i", targetPath,
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        outputPath,
      ]);
    } catch (err: any) {
      return res.status(500).json({ error: `FFmpeg encode failed: ${err.message}` });
    }

    // 6. Thumbnail
    const thumbPath = path.join(THUMBS_DIR, `${jobId}-thumb.png`);
    try {
      const bin = resolveFfmpegBin(ffmpegPath);
      await execFileAsync(bin, ["-y", "-i", outputPath, "-vframes", "1", "-q:v", "2", thumbPath]);
    } catch { /* non-fatal */ }

    const cacheBuster = Date.now();
    return res.json({
      jobId,
      selectedMode: selectedMode === "ai_openai_transfer" ? "ai_transfer" : selectedMode,
      selectedRoute,
      selectedEngine,
      inputVideoUrl: debugInputUrl,
      referenceUrl: debugReferenceUrl,
      videoUrl:     `/api/videos-files/${jobId}-out.mp4?v=${cacheBuster}`,
      outputUrl:    `/api/videos-files/${jobId}-out.mp4?v=${cacheBuster}`,
      thumbnailUrl: `/api/thumbs/${jobId}-thumb.png?v=${cacheBuster}`,
      previewUrl:   `/api/uploads/${jobId}-edited.png?v=${cacheBuster}`,
    });
  }
);

export default router;
