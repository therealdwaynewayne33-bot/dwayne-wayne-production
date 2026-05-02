import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import { requireAuth } from "../middlewares/requireAuth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const VIDEOS_DIR  = path.join(__dirname, "../public/videos");
const THUMBS_DIR  = path.join(__dirname, "../public/thumbs");
const execAsync   = promisify(exec);

const router = Router();

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);

// luma/modify-video accepts up to 100 MB / 30 s source clips
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
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

async function makeThumbnail(videoPath: string, outPath: string) {
  await execAsync(`ffmpeg -y -i "${videoPath}" -ss 0.5 -frames:v 1 -q:v 3 "${outPath}"`);
}

async function extractFaceFrame(videoOrImagePath: string, outPath: string) {
  // Grab a frame ~0.5 s in (well past any black intro) for a clean face.
  await execAsync(`ffmpeg -y -ss 0.5 -i "${videoOrImagePath}" -frames:v 1 -q:v 2 "${outPath}"`);
}

async function downloadToFile(url: string, filePath: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to download ${url}: ${r.status}`);
  await writeFile(filePath, Buffer.from(await r.arrayBuffer()));
}

function getDomain(): string | null {
  return process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0] ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/videos/bg-replace
//
// Pipeline:
//   1. Save uploaded video, expose a public URL
//   2. Call luma/modify-video → re-renders the entire scene from the prompt
//      while preserving motion (this is the same model behind Luma Dream
//      Machine's "Modify" feature)
//   3. If lockFace is true: extract a face frame from the source and run
//      arabyai-replicate/roop_face_swap on the Luma output to stamp the
//      original face back on (hard face lock)
//   4. Generate a thumbnail and return URLs
// ---------------------------------------------------------------------------
router.post("/videos/bg-replace", requireAuth, upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file provided" });

  const prompt = (req.body?.backgroundPrompt as string | undefined)?.trim();
  if (!prompt) return res.status(400).json({ error: "backgroundPrompt is required" });

  const lockFace = String(req.body?.lockFace ?? "true").toLowerCase() === "true";

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const domain = getDomain();
  if (!domain) return res.status(500).json({ error: "Could not determine public domain" });

  const jobId = `bgr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(VIDEOS_DIR,  { recursive: true });
  await mkdir(THUMBS_DIR,  { recursive: true });

  // 1. Save source video to disk and serve publicly so Replicate can fetch it
  const srcPath = path.join(UPLOADS_DIR, `${jobId}-src.mp4`);
  await writeFile(srcPath, req.file.buffer);
  const srcPublicUrl = `https://${domain}/api/uploads/${jobId}-src.mp4`;

  const replicate = new Replicate({ auth: token });

  // 2. Luma video-to-video re-render
  req.log.info({ jobId, prompt, lockFace }, "bg-replace: calling luma/modify-video");
  let lumaUrl: string;
  try {
    const output = await replicate.run("luma/modify-video", {
      input: {
        video: srcPublicUrl,
        prompt,
        // flex_1 keeps recognizable elements (pose, framing, motion) while
        // allowing meaningful stylistic / background change. lockFace will
        // stamp the original face back on after rendering.
        mode: "flex_1",
      },
    });
    lumaUrl = resolveUrl(output);
  } catch (err: any) {
    req.log.error({ err: err.message }, "bg-replace: luma/modify-video failed");
    return res.status(500).json({ error: `Luma video generation failed: ${err.message}` });
  }

  // Save Luma render to /api/videos-files
  const lumaPath = path.join(VIDEOS_DIR, `${jobId}-luma.mp4`);
  try {
    await downloadToFile(lumaUrl, lumaPath);
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to download Luma output: ${err.message}` });
  }

  let finalRelative = `${jobId}-luma.mp4`;
  let finalPath = lumaPath;
  let faceLocked = false;

  // 3. Optional: face lock via Roop video face-swap
  if (lockFace) {
    try {
      const facePath = path.join(UPLOADS_DIR, `${jobId}-face.jpg`);
      await extractFaceFrame(srcPath, facePath);

      const facePublicUrl = `https://${domain}/api/uploads/${jobId}-face.jpg`;
      const lumaPublicUrl = `https://${domain}/api/videos-files/${jobId}-luma.mp4`;

      req.log.info({ jobId }, "bg-replace: locking face via roop_face_swap");
      const swapOut = await replicate.run("arabyai-replicate/roop_face_swap", {
        input: {
          swap_image:   facePublicUrl,
          target_video: lumaPublicUrl,
        },
      });
      const swapUrl = resolveUrl(swapOut);

      const outPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
      await downloadToFile(swapUrl, outPath);
      finalPath = outPath;
      finalRelative = `${jobId}-out.mp4`;
      faceLocked = true;
    } catch (err: any) {
      // Don't fail the whole job — return the Luma render and let the user
      // hit the "Fix face" button on the result if they want to retry.
      req.log.warn({ err: err.message }, "bg-replace: face lock failed; returning Luma render unmodified");
    }
  }

  // 4. Thumbnail
  try {
    await makeThumbnail(finalPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
  } catch (err: any) {
    req.log.warn({ err: err.message }, "bg-replace: thumbnail generation failed");
  }

  return res.json({
    videoUrl:     `/api/videos-files/${finalRelative}`,
    thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
    // URLs the client can pass back to /fix-face to re-run only the face step
    sourceUrl:    `/api/uploads/${jobId}-src.mp4`,
    lumaUrl:      `/api/videos-files/${jobId}-luma.mp4`,
    faceLocked,
    jobId,
  });
});

// ---------------------------------------------------------------------------
// POST /api/videos/bg-replace/fix-face
//
// Re-runs ONLY the face-swap step against an already-rendered video, using
// the original source video as the face reference. Cheap (~$0.10) and fast
// (~1–2 min) compared to a full re-render.
//
// Body: { targetVideoUrl, faceSourceUrl }
// ---------------------------------------------------------------------------
router.post("/videos/bg-replace/fix-face", requireAuth, async (req, res) => {
  const { targetVideoUrl, faceSourceUrl } = req.body as {
    targetVideoUrl?: string;
    faceSourceUrl?:  string;
  };

  if (!targetVideoUrl || !faceSourceUrl) {
    return res.status(400).json({ error: "targetVideoUrl and faceSourceUrl are required" });
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const domain = getDomain();
  if (!domain) return res.status(500).json({ error: "Could not determine public domain" });

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(VIDEOS_DIR,  { recursive: true });
  await mkdir(THUMBS_DIR,  { recursive: true });

  const jobId = `bgr-fix-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Allow either absolute or app-relative URLs from the client
  const toAbs = (u: string) => (u.startsWith("http") ? u : `https://${domain}${u}`);
  const targetAbs  = toAbs(targetVideoUrl);
  const faceSrcAbs = toAbs(faceSourceUrl);

  // Download the face source (could be a video or an image) so we can extract
  // a single clean face frame from it locally.
  let faceSrcExt = ".mp4";
  try {
    faceSrcExt = path.extname(new URL(faceSrcAbs).pathname).toLowerCase() || ".mp4";
  } catch { /* keep default */ }
  const faceSrcPath = path.join(UPLOADS_DIR, `${jobId}-facesrc${faceSrcExt}`);

  try {
    await downloadToFile(faceSrcAbs, faceSrcPath);
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to download face source: ${err.message}` });
  }

  const facePath = path.join(UPLOADS_DIR, `${jobId}-face.jpg`);
  try {
    await extractFaceFrame(faceSrcPath, facePath);
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to extract face frame: ${err.message}` });
  }
  const facePublicUrl = `https://${domain}/api/uploads/${jobId}-face.jpg`;

  const replicate = new Replicate({ auth: token });

  req.log.info({ jobId, targetAbs }, "bg-replace fix-face: running roop_face_swap");
  let resultUrl: string;
  try {
    const output = await replicate.run("arabyai-replicate/roop_face_swap", {
      input: {
        swap_image:   facePublicUrl,
        target_video: targetAbs,
      },
    });
    resultUrl = resolveUrl(output);
  } catch (err: any) {
    req.log.error({ err: err.message }, "bg-replace fix-face: roop_face_swap failed");
    return res.status(500).json({ error: `Face lock failed: ${err.message}` });
  }

  const outPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
  try {
    await downloadToFile(resultUrl, outPath);
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to download face-swap result: ${err.message}` });
  }

  try {
    await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
  } catch (err: any) {
    req.log.warn({ err: err.message }, "bg-replace fix-face: thumbnail generation failed");
  }

  return res.json({
    videoUrl:     `/api/videos-files/${jobId}-out.mp4`,
    thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
    jobId,
  });
});

export default router;
