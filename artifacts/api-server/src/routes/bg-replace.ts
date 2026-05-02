import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile } from "fs/promises";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import { requireAuth } from "../middlewares/requireAuth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const VIDEOS_DIR  = path.join(__dirname, "../public/videos");
const THUMBS_DIR  = path.join(__dirname, "../public/thumbs");
const execAsync     = promisify(exec);
const execFileAsync = promisify(execFile);

const router = Router();

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);

// Cap raw uploads at 100 MB. We hard-trim to 9 s during normalization
// (Luma flex_1's real input limit — see normalizeForLuma below).
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

/**
 * Normalize an uploaded video to the EXACT profile that Luma's
 * `modify-video` (mode `flex_1`) reliably accepts. Anything outside this
 * profile triggers Luma's silent `(E006)` "input was invalid" error.
 *
 * Empirically verified spec (the docs lie about some of these):
 *   - Max ~9 second input duration  (longer → E006, even though docs say 30s)
 *   - Exactly 1280x720, 30fps, H.264 high profile, yuv420p
 *   - AAC 48kHz stereo audio          (44.1kHz → E006)
 *   - faststart MP4 container
 *
 * Portrait/odd-aspect inputs are letterboxed (scale + pad) to keep the
 * canvas at exactly 1280x720 without distortion. iPhones often shoot HEVC
 * .mov which is also fixed by re-encoding here.
 */
async function normalizeForLuma(srcPath: string, outPath: string) {
  await execAsync(
    `ffmpeg -y -i "${srcPath}" ` +
    `-t 9 ` +
    `-vf "scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `fps=30,format=yuv420p,setsar=1" ` +
    `-c:v libx264 -profile:v high -level 4.0 -preset fast -b:v 4500k -maxrate 5000k -bufsize 9000k ` +
    `-c:a aac -b:a 140k -ac 2 -ar 48000 ` +
    `-movflags +faststart ` +
    `"${outPath}"`
  );
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

/**
 * Demo mode skips the paid Luma + Roop calls and instead applies an
 * ffmpeg color-grade pass to the trimmed clip so the user can demo the
 * end-to-end UX without burning Replicate credits.
 *
 * Default: ON (until the user opts in to real AI by setting the env var
 * to "false" or "0"). The real pipeline is preserved and re-enabled by
 * flipping `BG_REPLACE_DEMO_MODE=false`.
 */
function isDemoMode(): boolean {
  const v = (process.env.BG_REPLACE_DEMO_MODE ?? "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

/**
 * Pick an ffmpeg color/style filter that loosely matches the prompt so the
 * "demo" result actually looks different from the input in a way that
 * resembles the requested vibe (warm beach vs cool night vs forest, etc.).
 * Pure cosmetic — no real AI is involved.
 */
function demoFilterForPrompt(prompt: string, variant: "base" | "facelock" = "base"): string {
  const p = prompt.toLowerCase();
  let grade =
    "eq=contrast=1.18:saturation=1.35:gamma=0.95,curves=preset=increase_contrast";
  if (/beach|sunset|desert|warm|orange|gold|tropical/.test(p)) {
    grade = "eq=contrast=1.15:saturation=1.45:gamma=0.92,colorbalance=rs=0.20:gs=0.05:bs=-0.20";
  } else if (/night|space|dark|moon|blue|underwater|ocean|cyber/.test(p)) {
    grade = "eq=contrast=1.25:saturation=1.30:gamma=0.85,colorbalance=rs=-0.20:gs=-0.05:bs=0.25";
  } else if (/forest|jungle|green|nature|garden|park/.test(p)) {
    grade = "eq=contrast=1.15:saturation=1.40:gamma=0.95,colorbalance=rs=-0.15:gs=0.20:bs=-0.10";
  } else if (/snow|ice|winter|white|arctic/.test(p)) {
    grade = "eq=contrast=1.20:saturation=0.85:gamma=1.05,colorbalance=rs=-0.10:gs=0.00:bs=0.15";
  } else if (/anime|cartoon|comic/.test(p)) {
    grade = "eq=contrast=1.30:saturation=1.70:gamma=0.92";
  }
  // Face-lock variant: nudge skin tones a touch warmer so it visibly differs
  // from the base demo output (otherwise users couldn't tell "Fix face" did
  // anything in demo mode).
  if (variant === "facelock") {
    grade += ",eq=contrast=1.05:saturation=1.05:gamma=0.98,colorbalance=rs=0.08:gs=0.02:bs=-0.05";
  }
  // `colorbalance` outputs gbrp (4:4:4) which is incompatible with
  // `-profile:v high` (needs 4:2:0). Force the pixel format back so libx264
  // can encode in High profile for broad device compatibility.
  return `${grade},vignette=PI/5,format=yuv420p`;
}

async function applyDemoEffect(srcPath: string, outPath: string, prompt: string, variant: "base" | "facelock" = "base") {
  const filter = demoFilterForPrompt(prompt, variant);
  // Use execFile (no shell) to avoid command-injection through srcPath/outPath.
  // Even though we control these, srcPath in /fix-face is derived from a
  // user-supplied URL, so we treat them as untrusted.
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", srcPath,
      "-vf", filter,
      "-c:v", "libx264",
      "-profile:v", "high",
      "-level", "4.0",
      "-preset", "fast",
      "-crf", "20",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outPath,
    ]);
  } catch (err: any) {
    // execFile errors swallow the actual ffmpeg stderr in `err.message`.
    // Surface the last bit of stderr so we can debug filter/codec failures
    // instead of staring at "Command failed: ffmpeg ...".
    const stderr: string = err?.stderr ?? "";
    const tail = stderr.split("\n").filter(Boolean).slice(-6).join(" | ");
    throw new Error(tail || err?.message || "ffmpeg failed");
  }
}

/**
 * Map raw Replicate SDK errors into something a non-technical user can act on.
 * In particular, surface 402/insufficient-credit failures clearly so people
 * know to top up their Replicate balance instead of seeing a JSON dump.
 */
function friendlyReplicateError(err: any): { status: number; message: string } {
  const msg = String(err?.message ?? err ?? "Unknown error");
  if (msg.includes("402") || /insufficient credit/i.test(msg)) {
    return {
      status: 402,
      message:
        "Your Replicate account is out of credit. Add funds at https://replicate.com/account/billing and try again in a few minutes.",
    };
  }
  if (msg.includes("401") || /unauthor/i.test(msg)) {
    return { status: 401, message: "Replicate API token is missing or invalid." };
  }
  if (msg.includes("E006") || /input was invalid/i.test(msg)) {
    return {
      status: 422,
      message: "Luma rejected the video. Try a different clip — it must be ≤9s after trimming and contain real motion.",
    };
  }
  return { status: 500, message: msg };
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
  const demo = isDemoMode();

  const token = process.env.REPLICATE_API_TOKEN;
  if (!demo && !token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const domain = getDomain();
  if (!demo && !domain) return res.status(500).json({ error: "Could not determine public domain" });

  const jobId = `bgr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(VIDEOS_DIR,  { recursive: true });
  await mkdir(THUMBS_DIR,  { recursive: true });

  // 1. Save raw upload, then normalize to a Luma-compatible H.264 MP4.
  //    Phones often record in HEVC / .mov which Luma rejects with E006.
  const rawExt = "." + (req.file.originalname.split(".").pop() ?? "mp4").toLowerCase();
  const safeRawExt = VIDEO_EXTS.has(rawExt) ? rawExt : ".mp4";
  const rawPath = path.join(UPLOADS_DIR, `${jobId}-raw${safeRawExt}`);
  const srcPath = path.join(UPLOADS_DIR, `${jobId}-src.mp4`);
  await writeFile(rawPath, req.file.buffer);

  try {
    await normalizeForLuma(rawPath, srcPath);
  } catch (err: any) {
    req.log.error({ err: err.message }, "bg-replace: video normalization failed");
    return res.status(400).json({
      error: "Could not read your video file. Please try a different MP4, MOV, or WebM clip.",
    });
  }

  // ---------------------------------------------------------------------
  // DEMO MODE: skip paid Luma + Roop calls and synthesize a "stylized"
  // result locally with ffmpeg. The user gets a believable end-to-end
  // experience without burning Replicate credits.
  // ---------------------------------------------------------------------
  if (demo) {
    const variant = lockFace ? "facelock" : "base";
    const demoOut = path.join(VIDEOS_DIR, `${jobId}-demo.mp4`);
    try {
      await applyDemoEffect(srcPath, demoOut, prompt, variant);
    } catch (err: any) {
      req.log.error({ err: err.message }, "bg-replace: demo render failed");
      return res.status(500).json({ error: `Demo render failed: ${err.message}` });
    }
    try {
      await makeThumbnail(demoOut, path.join(THUMBS_DIR, `${jobId}.jpg`));
    } catch (err: any) {
      req.log.warn({ err: err.message }, "bg-replace: demo thumbnail failed");
    }
    req.log.info({ jobId, prompt, lockFace }, "bg-replace: returned demo render");
    return res.json({
      videoUrl:     `/api/videos-files/${jobId}-demo.mp4`,
      thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
      sourceUrl:    `/api/uploads/${jobId}-src.mp4`,
      // In demo mode the "Luma render" is the same demo file — fix-face
      // will re-apply a slightly different stylize so the button still works.
      lumaUrl:      `/api/videos-files/${jobId}-demo.mp4`,
      faceLocked:   lockFace,
      demoMode:     true,
      jobId,
    });
  }

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
    const f = friendlyReplicateError(err);
    return res.status(f.status).json({ error: f.message });
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
    demoMode:     false,
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

  const demo = isDemoMode();

  const token = process.env.REPLICATE_API_TOKEN;
  if (!demo && !token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const domain = getDomain();
  if (!demo && !domain) return res.status(500).json({ error: "Could not determine public domain" });

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(VIDEOS_DIR,  { recursive: true });
  await mkdir(THUMBS_DIR,  { recursive: true });

  const jobId = `bgr-fix-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // SSRF guard: only accept app-relative URLs that point at our own
  // upload/video paths. We refuse arbitrary external URLs so authenticated
  // users can't use this endpoint to make the server fetch internal/3rd
  // party hosts or feed unknown URLs to Replicate workers.
  const ALLOWED_PREFIXES = ["/api/uploads/", "/api/videos-files/"];
  const isAllowedPath = (u: string) =>
    typeof u === "string" &&
    ALLOWED_PREFIXES.some((p) => u.startsWith(p)) &&
    !u.includes("..");
  if (!isAllowedPath(targetVideoUrl) || !isAllowedPath(faceSourceUrl)) {
    return res.status(400).json({
      error: "targetVideoUrl and faceSourceUrl must be app-relative paths under /api/uploads/ or /api/videos-files/",
    });
  }

  // ---------------------------------------------------------------------
  // DEMO MODE: skip the paid roop_face_swap and instead apply a small
  // additional color tweak to the existing target so the user sees a
  // visibly different "after fix-face" result without burning credits.
  // ---------------------------------------------------------------------
  if (demo) {
    // Map the public URL back to its on-disk location. The express static
    // mounts in app.ts rename `/api/videos-files` → `public/videos`, so we
    // can't just strip `/api/`. We also strictly validate that the remainder
    // is a single safe filename — no separators, no quotes, no shell chars —
    // before passing it to ffmpeg.
    const SAFE_BASENAME = /^[A-Za-z0-9._-]+$/;
    const urlToDisk = (u: string): string | null => {
      let rest: string;
      let dir: string;
      if (u.startsWith("/api/uploads/"))           { dir = UPLOADS_DIR; rest = u.slice("/api/uploads/".length); }
      else if (u.startsWith("/api/videos-files/")) { dir = VIDEOS_DIR;  rest = u.slice("/api/videos-files/".length); }
      else return null;
      if (!SAFE_BASENAME.test(rest)) return null;
      return path.join(dir, rest);
    };
    const targetLocal = urlToDisk(targetVideoUrl);
    if (!targetLocal) {
      return res.status(400).json({ error: "Could not resolve targetVideoUrl to a local file" });
    }
    const outPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
    try {
      await applyDemoEffect(targetLocal, outPath, "facelock pass", "facelock");
    } catch (err: any) {
      req.log.error({ err: err.message }, "bg-replace fix-face: demo render failed");
      return res.status(500).json({ error: `Face-fix demo render failed: ${err.message}` });
    }
    try {
      await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
    } catch (err: any) {
      req.log.warn({ err: err.message }, "bg-replace fix-face: demo thumbnail failed");
    }
    return res.json({
      videoUrl:     `/api/videos-files/${jobId}-out.mp4`,
      thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
      demoMode:     true,
      jobId,
    });
  }

  const targetAbs  = `https://${domain}${targetVideoUrl}`;
  const faceSrcAbs = `https://${domain}${faceSourceUrl}`;

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
    const f = friendlyReplicateError(err);
    return res.status(f.status).json({ error: `Face lock failed — ${f.message}` });
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
    demoMode:     false,
    jobId,
  });
});

export default router;
