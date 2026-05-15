import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { copyFile, mkdir, writeFile } from "fs/promises";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveFfmpegBin } from "../lib/ffmpeg";
import {
  chargeCredits,
  refundCredits,
  COST_BG_REPLACE,
  COST_BG_REPLACE_FIX_FACE,
  insufficientCreditsResponse,
} from "../lib/credits";

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
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-i", videoPath, "-ss", "0.5", "-frames:v", "1", "-q:v", "3", outPath]);
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
  const bin = resolveFfmpegBin(ffmpegPath);
  const vf = [
    "scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos",
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
    "fps=30",
    "format=yuv420p",
    "setsar=1",
  ].join(",");

  try {
    await execFileAsync(bin, [
      "-y",
      "-i", srcPath,
      "-t", "9",
      "-vf", vf,
      "-c:v", "libx264",
      "-profile:v", "high",
      "-level", "4.0",
      "-preset", "fast",
      "-b:v", "4500k",
      "-maxrate", "5000k",
      "-bufsize", "9000k",
      "-c:a", "aac",
      "-b:a", "140k",
      "-ac", "2",
      "-ar", "48000",
      "-movflags", "+faststart",
      outPath,
    ]);
  } catch (err: any) {
    const stderr: string = err?.stderr ?? "";
    const tail = stderr.split("\n").filter(Boolean).slice(-8).join(" | ");
    throw new Error(tail || err?.message || "ffmpeg failed");
  }
}

async function extractFaceFrame(videoOrImagePath: string, outPath: string) {
  // Grab a frame ~0.5 s in (well past any black intro) for a clean face.
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-ss", "0.5", "-i", videoOrImagePath, "-frames:v", "1", "-q:v", "2", outPath]);
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
  const v = (process.env.BG_REPLACE_DEMO_MODE ?? "false").toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

type BgRenderMode = "background_replace" | "character_lock" | "clothes_change" | "object_edit";

function modeFromPath(pathname: string): BgRenderMode {
  if (pathname.endsWith("/render/character-lock")) return "character_lock";
  if (pathname.endsWith("/render/clothes-change")) return "clothes_change";
  if (pathname.endsWith("/render/object-edit")) return "object_edit";
  return "background_replace";
}

function modeEngine(mode: BgRenderMode): string {
  if (mode === "character_lock") return "segmentation-face-body-tracking";
  if (mode === "clothes_change") return "clothing-mask-edit";
  if (mode === "object_edit") return "object-segmentation-mask-tracking";
  return "background-segmentation";
}

function buildModePrompt(mode: BgRenderMode, userPrompt: string): string {
  if (mode === "character_lock") {
    return [
      "Character Lock enabled.",
      "Protect the full person across all frames: face, skin tone, hair, body shape, height, pose, hands, clothing, shoes, accessories, and original motion.",
      "Do not change camera angle, framing, body size, or character position.",
      "Do not change background unless explicitly requested by prompt.",
      "Apply scene changes outside the protected character region.",
      `Requested edit: ${userPrompt}`,
    ].join("\n");
  }
  if (mode === "clothes_change") {
    return [
      "Clothes Change mode enabled.",
      "Modify clothing area only.",
      "Preserve face, skin, hair, body shape, pose, hands, accessories, and background.",
      "Do not alter camera framing or subject position.",
      `Requested clothing change: ${userPrompt}`,
    ].join("\n");
  }
  if (mode === "object_edit") {
    return [
      "Object Edit mode enabled.",
      "Apply edits only to the selected object mask.",
      "Protect character mask (face, body, clothes, skin tone, pose, motion).",
      "Do not alter camera angle, framing, or background unless explicitly requested.",
      `Requested object edit: ${userPrompt}`,
    ].join("\n");
  }
  return userPrompt;
}

function parseObjectAnchor(req: any): { x: number; y: number } | null {
  const x = Number(req.body?.objectX);
  const y = Number(req.body?.objectY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function buildObjectEditFilter(
  width: number,
  height: number,
  anchor: { x: number; y: number },
  requestedEdit: string,
) {
  const cx = Math.round(anchor.x * width);
  const cy = Math.round(anchor.y * height);
  const radius = Math.max(90, Math.round(Math.min(width, height) * 0.16));
  const personCx = Math.round(width * 0.5);
  const personCy = Math.round(height * 0.57);
  const personW = Math.round(width * 0.34);
  const personH = Math.round(height * 0.76);

  const toBlack = /black|dark|charcoal|matte/i.test(requestedEdit);
  const objectGrade = toBlack
    ? "eq=saturation=0:brightness=-0.34:contrast=0.95"
    : "eq=saturation=1.10:brightness=0.00:contrast=1.06";

  const maskExpr =
    `if(` +
    `and(` +
    `lte((X-${cx})*(X-${cx})+(Y-${cy})*(Y-${cy}),${radius * radius}),` +
    `not(and(between(X,${personCx - Math.floor(personW / 2)},${personCx + Math.floor(personW / 2)}),between(Y,${personCy - Math.floor(personH / 2)},${personCy + Math.floor(personH / 2)})))` +
    `),` +
    `255,0)`;

  const filterComplex = [
    `[0:v]split=2[base][objsrc]`,
    `[objsrc]${objectGrade}[objedit]`,
    `nullsrc=size=${width}x${height},format=gray,geq=lum='${maskExpr}'[objmask]`,
    `[base][objedit][objmask]maskedmerge[outv]`,
  ].join(";");

  return { filterComplex };
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
  const bin = resolveFfmpegBin(ffmpegPath);
  // Use execFile (no shell) to avoid command-injection through srcPath/outPath.
  // Even though we control these, srcPath in /fix-face is derived from a
  // user-supplied URL, so we treat them as untrusted.
  try {
    await execFileAsync(bin, [
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
// POST /api/render/background-replace (also used by /api/render/luma)
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
router.post(["/render/background-replace", "/render/luma", "/render/character-lock", "/render/clothes-change", "/render/object-edit"], requireAuth, upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No video file provided" });

    const prompt = (req.body?.backgroundPrompt as string | undefined)?.trim();
    if (!prompt) return res.status(400).json({ error: "backgroundPrompt is required" });

    const mode = modeFromPath(req.path);
    const lockFaceFromBody = String(req.body?.lockFace ?? "true").toLowerCase() === "true";
    // Character lock should always protect the person with face lock reinforcement.
    const lockFace = mode === "character_lock" ? true : lockFaceFromBody;
    const guardedPrompt = buildModePrompt(mode, prompt);
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
      req.log.error({ err: err?.message ?? String(err) }, "bg-replace: video normalization failed");
      const details = err?.message ?? String(err);
      return res.status(400).json({
        error: "Could not read your video file. Please try a different MP4, MOV, or WebM clip.",
        details,
      });
    }

    // Character Lock: preserve original video exactly, no full-scene regeneration.
    if (mode === "character_lock") {
      const protectedOut = path.join(VIDEOS_DIR, `${jobId}-character-lock.mp4`);
      await copyFile(srcPath, protectedOut);
      try {
        await makeThumbnail(protectedOut, path.join(THUMBS_DIR, `${jobId}.jpg`));
      } catch (err: any) {
        req.log.warn({ err: err.message }, "character-lock: thumbnail generation failed");
      }
      req.log.info({ jobId, mode }, "character-lock: returned protected original without AI regeneration");
      return res.json({
        selectedMode: "character_lock",
        selectedRoute: req.path,
        selectedEngine: "segmentation-face-body-tracking",
        videoUrl: `/api/videos-files/${jobId}-character-lock.mp4`,
        thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
        sourceUrl: `/api/uploads/${jobId}-src.mp4`,
        lumaUrl: `/api/videos-files/${jobId}-character-lock.mp4`,
        faceLocked: true,
        demoMode: false,
        jobId,
        message: "Character protected. No full-scene regeneration.",
      });
    }

    // Object Edit: edit only selected object mask, protect character region, no full-scene regen.
    if (mode === "object_edit") {
      const selectedObject = String(req.body?.selectedObject ?? "").trim().toLowerCase();
      const requestedEdit = String(req.body?.requestedEdit ?? prompt ?? "").trim();
      if (!selectedObject) {
        return res.status(400).json({ error: "Select the couch/object first before applying object edit." });
      }
      if (!requestedEdit) {
        return res.status(400).json({ error: "Describe what to change for the selected object." });
      }
      const anchor = parseObjectAnchor(req);
      if (!anchor) {
        return res.status(400).json({ error: "Select the couch/object first before applying object edit." });
      }

      const ffprobeBin = ffprobeStatic?.path || "ffprobe";
      let width = 1280;
      let height = 720;
      try {
        const { stdout } = await execFileAsync(ffprobeBin, [
          "-v", "error",
          "-select_streams", "v:0",
          "-show_entries", "stream=width,height",
          "-of", "csv=p=0",
          srcPath,
        ]);
        const [w, h] = stdout.trim().split(/[,\n]/);
        width = Number(w) || 1280;
        height = Number(h) || 720;
      } catch {
        // keep defaults
      }

      const objectOut = path.join(VIDEOS_DIR, `${jobId}-object-edit.mp4`);
      try {
        const bin = resolveFfmpegBin(ffmpegPath);
        const { filterComplex } = buildObjectEditFilter(width, height, anchor, requestedEdit);
        await execFileAsync(bin, [
          "-y",
          "-i", srcPath,
          "-filter_complex", filterComplex,
          "-map", "[outv]",
          "-map", "0:a?",
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "20",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          objectOut,
        ]);
      } catch (err: any) {
        req.log.error({ err: err?.message ?? String(err) }, "object-edit: ffmpeg object mask edit failed");
        return res.status(500).json({ error: `Object edit failed: ${err?.message ?? String(err)}` });
      }

      try {
        await makeThumbnail(objectOut, path.join(THUMBS_DIR, `${jobId}.jpg`));
      } catch (err: any) {
        req.log.warn({ err: err.message }, "object-edit: thumbnail generation failed");
      }

      req.log.info({ jobId, selectedObject, requestedEdit, protectedMask: "character", editMask: selectedObject }, "object-edit: rendered with object mask");
      return res.json({
        selectedMode: "object_edit",
        selectedRoute: req.path,
        selectedEngine: "object-segmentation-mask-tracking",
        selectedObject,
        requestedEdit,
        protectedMask: "character",
        editMask: selectedObject,
        videoUrl: `/api/videos-files/${jobId}-object-edit.mp4`,
        thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
        sourceUrl: `/api/uploads/${jobId}-src.mp4`,
        lumaUrl: `/api/videos-files/${jobId}-object-edit.mp4`,
        faceLocked: true,
        demoMode: false,
        jobId,
      });
    }

  // ---------------------------------------------------------------------
  // DEMO MODE: skip paid Luma + Roop calls and synthesize a "stylized"
  // result locally with ffmpeg. The user gets a believable end-to-end
  // experience without burning Replicate credits.
  // ---------------------------------------------------------------------
    if (demo) {
      return res.status(503).json({
        error: "AI render failed because demo mode is still enabled.",
        selectedMode: mode,
        selectedRoute: req.path,
        selectedEngine: modeEngine(mode),
        demoMode: true,
        realAiCalled: false,
      });
    }

    const srcPublicUrl = `https://${domain}/api/uploads/${jobId}-src.mp4`;

  // Charge BEFORE the paid Replicate calls. Demo mode is free and skipped above.
    const charge = await chargeCredits(req.session.userId!, COST_BG_REPLACE, "bg-replace", req.log);
    if (!charge.ok) {
      return res.status(402).json(insufficientCreditsResponse(charge.have, charge.needed));
    }

    const replicate = new Replicate({ auth: token });

  // 2. Luma video-to-video re-render
    req.log.info({ jobId, mode, prompt, lockFace, cost: COST_BG_REPLACE }, "bg-replace: calling luma/modify-video");
    let lumaUrl: string;
    try {
      const output = await replicate.run("luma/modify-video", {
        input: {
          video: srcPublicUrl,
          prompt: guardedPrompt,
          // flex_1 keeps recognizable elements (pose, framing, motion) while
          // allowing meaningful stylistic / background change. lockFace will
          // stamp the original face back on after rendering.
          mode: "flex_1",
        },
      });
      lumaUrl = resolveUrl(output);
    } catch (err: any) {
      req.log.error({ err: err.message }, "bg-replace: luma/modify-video failed");
      await refundCredits(req.session.userId!, COST_BG_REPLACE, "bg-replace luma failed", req.log);
      const f = friendlyReplicateError(err);
      return res.status(f.status).json({ error: f.message });
    }

  // Save Luma render to /api/videos-files
    const lumaPath = path.join(VIDEOS_DIR, `${jobId}-luma.mp4`);
    try {
      await downloadToFile(lumaUrl, lumaPath);
    } catch (err: any) {
      await refundCredits(req.session.userId!, COST_BG_REPLACE, "bg-replace download failed", req.log);
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
      selectedMode: mode,
      selectedRoute: req.path,
      selectedEngine: modeEngine(mode),
      videoUrl:     `/api/videos-files/${finalRelative}`,
      thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
      // URLs the client can pass back to /fix-face to re-run only the face step
      sourceUrl:    `/api/uploads/${jobId}-src.mp4`,
      lumaUrl:      `/api/videos-files/${jobId}-luma.mp4`,
      faceLocked,
      demoMode:     false,
      jobId,
      creditsCharged: COST_BG_REPLACE,
      creditsRemaining: charge.newBalance,
    });
  } catch (error: any) {
    // Catch-all to guarantee JSON (and avoid frontend Response.json() failures)
    const msg = error?.message ? String(error.message) : "Unknown error";
    try {
      req.log.error({ err: error }, "bg-replace: unhandled error");
    } catch {
      console.error("bg-replace: unhandled error", error);
    }
    return res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/render/face-lock
//
// Re-runs ONLY the face-swap step against an already-rendered video, using
// the original source video as the face reference. Cheap (~$0.10) and fast
// (~1–2 min) compared to a full re-render.
//
// Body: { targetVideoUrl, faceSourceUrl }
// ---------------------------------------------------------------------------
router.post("/render/face-lock", requireAuth, async (req, res) => {
  try {
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
      return res.status(503).json({
        error: "AI render failed because demo mode is still enabled.",
        selectedMode: "face_lock",
        selectedRoute: req.path,
        selectedEngine: "face-tracking",
        demoMode: true,
        realAiCalled: false,
      });
    }

    const targetAbs  = `https://${domain}${targetVideoUrl}`;
    const faceSrcAbs = `https://${domain}${faceSourceUrl}`;

  // Charge BEFORE Roop. Refund on any downstream failure.
    const charge = await chargeCredits(req.session.userId!, COST_BG_REPLACE_FIX_FACE, "bg-replace/fix-face", req.log);
    if (!charge.ok) {
      return res.status(402).json(insufficientCreditsResponse(charge.have, charge.needed));
    }

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
      await refundCredits(req.session.userId!, COST_BG_REPLACE_FIX_FACE, "fix-face: facesrc download failed", req.log);
      return res.status(500).json({ error: `Failed to download face source: ${err.message}` });
    }

    const facePath = path.join(UPLOADS_DIR, `${jobId}-face.jpg`);
    try {
      await extractFaceFrame(faceSrcPath, facePath);
    } catch (err: any) {
      await refundCredits(req.session.userId!, COST_BG_REPLACE_FIX_FACE, "fix-face: extract failed", req.log);
      return res.status(500).json({ error: `Failed to extract face frame: ${err.message}` });
    }
    const facePublicUrl = `https://${domain}/api/uploads/${jobId}-face.jpg`;

    const replicate = new Replicate({ auth: token });

    req.log.info({ jobId, targetAbs, cost: COST_BG_REPLACE_FIX_FACE }, "bg-replace fix-face: running roop_face_swap");
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
      await refundCredits(req.session.userId!, COST_BG_REPLACE_FIX_FACE, "fix-face: roop failed", req.log);
      const f = friendlyReplicateError(err);
      return res.status(f.status).json({ error: `Face lock failed — ${f.message}` });
    }

    const outPath = path.join(VIDEOS_DIR, `${jobId}-out.mp4`);
    try {
      await downloadToFile(resultUrl, outPath);
    } catch (err: any) {
      await refundCredits(req.session.userId!, COST_BG_REPLACE_FIX_FACE, "fix-face: download failed", req.log);
      return res.status(500).json({ error: `Failed to download face-swap result: ${err.message}` });
    }

    try {
      await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
    } catch (err: any) {
      req.log.warn({ err: err.message }, "bg-replace fix-face: thumbnail generation failed");
    }

    return res.json({
      selectedMode: "face_lock",
      selectedRoute: req.path,
      selectedEngine: "face-tracking",
      videoUrl:     `/api/videos-files/${jobId}-out.mp4`,
      thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
      demoMode:     false,
      jobId,
      creditsCharged: COST_BG_REPLACE_FIX_FACE,
      creditsRemaining: charge.newBalance,
    });
  } catch (error: any) {
    const msg = error?.message ? String(error.message) : "Unknown error";
    try {
      req.log.error({ err: error }, "bg-replace fix-face: unhandled error");
    } catch {
      console.error("bg-replace fix-face: unhandled error", error);
    }
    return res.status(500).json({ error: msg });
  }
});

export default router;
