import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile } from "fs/promises";
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (file.mimetype.startsWith("video/") || VIDEO_EXTS.has(ext)) cb(null, true);
    else cb(new Error("Only video files are accepted (MP4, MOV, WebM…)"));
  },
});

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

    // 1. Save both videos
    const targetPath    = path.join(UPLOADS_DIR, `${jobId}-target.mp4`);
    const referencePath = path.join(UPLOADS_DIR, `${jobId}-reference.mp4`);
    await writeFile(targetPath,    targetFile.buffer);
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

    // 3. Extract a mid-point frame from each video
    const targetFramePath = path.join(UPLOADS_DIR, `${jobId}-target-frame.png`);
    const refFramePath    = path.join(UPLOADS_DIR, `${jobId}-ref-frame.png`);
    const midSec = (vidDuration / 2).toFixed(2);
    try {
      await Promise.all([
        execAsync(`ffmpeg -y -ss ${midSec} -i "${targetPath}"    -vframes 1 -q:v 2 "${targetFramePath}"`),
        execAsync(`ffmpeg -y -ss 1.0       -i "${referencePath}" -vframes 1 -q:v 2 "${refFramePath}"`),
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

    // 5. Apply the edited frame's "look" across the whole target video.
    //
    //  Pipeline (single-pass FFmpeg):
    //   - bg_amb = heavy blur of edited frame → carries its colour cast
    //   - softlight blend that ambient onto every target frame at 50%
    //     (higher than bg-replace because here the user explicitly wants the
    //      reference to influence the target, not just match lighting)
    //   - Mild contrast/saturation tweak unifies the look
    //   - Light grain so the AI-derived cast doesn't look digital
    //
    const outputPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
    const ffmpegCmd = [
      `ffmpeg -y`,
      `-i "${targetPath}"`,
      `-loop 1 -i "${editedFramePath}"`,
      `-filter_complex`,
      `"[1:v]scale=${vidWidth}:${vidHeight}:force_original_aspect_ratio=increase,crop=${vidWidth}:${vidHeight},gblur=sigma=70,format=yuv420p[ambient];` +
      `[0:v]format=yuv420p[tgt];` +
      `[tgt][ambient]blend=all_mode=softlight:all_opacity=0.50:shortest=1,` +
      `eq=contrast=1.05:saturation=1.08,` +
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
