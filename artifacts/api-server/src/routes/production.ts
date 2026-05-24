import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { access, mkdir, open, readFile, stat, unlink, writeFile } from "fs/promises";
import { statSync } from "fs";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createHash, randomUUID } from "crypto";
import Replicate from "replicate";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveFfmpegBin, ffmpegVideoPassthrough } from "../lib/ffmpeg";
import { allowsFullSceneVideoTransfer, isSpecificObjectEditIntent } from "../lib/object-edit-intent";
import { runTargetedObjectEdit, type TargetedEditRunMeta } from "../lib/targeted-object-edit";
import { getPublicTargetedMaskStatus } from "../lib/targeted-mask-status";
import { getSegmentTrackJob } from "../lib/segment-track-jobs";
import { sam2MaskEngineRequested } from "../lib/object-mask-engine";
import { generateRunwayVideoFromOptions, resolveRunwayVideoOutput } from "../lib/replicate-video";
import { applyFluxKontextColor } from "../lib/kontext-color";
import { isFalConfigured } from "../lib/fal-kontext";
import { isBaselineMode } from "../lib/baseline-mode";
import { baselineProductionPassthrough } from "../lib/baseline-passthrough";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const VIDEOS_DIR = path.join(__dirname, "../public/videos");
const THUMBS_DIR = path.join(__dirname, "../public/thumbs");
const SWAPS_DIR = path.join(__dirname, "../public/swaps");
const execFileAsync = promisify(execFile);

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);

type ProductionMode =
  | "face_swap"
  | "background_replace"
  | "object_edit"
  | "color_grade"
  | "locked_reference_color_match"
  | "image_generate"
  | "video_generate"
  | "audio_cleanup"
  | "full_production";

type RenderMode = "mock" | "local" | "production";

const DEFAULT_COLOR_INSTRUCTION =
  "Apply cinematic movie color grading with natural skin tones, correct white balance, clean contrast, realistic lighting, balanced shadows, and professional film look. Do not make it black and white. Do not add yellow, green, gray, or washed-out color cast. Preserve the character exactly.";

const CHARACTER_LOCK_INSTRUCTION = [
  "Preserve character identity exactly at every step.",
  "Do not change face, skin tone, body type, clothing, pose, hair, or style.",
  "Do not replace, remove, or alter the person.",
  "Keep original composition unless explicitly requested.",
].join(" ");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

const router = Router();

const DW_PIPELINE_TAG = "[Dwayne Wayne Production / pipeline]";
function prodPipelineLog(message: string, detail: Record<string, unknown>): void {
  console.info(`${DW_PIPELINE_TAG} ${message}`, JSON.stringify(detail));
}

/** FFmpeg chain deliberately extreme — proves `-vf` is applied to the COLOR INPUT clip (short proof encode). */
const LOCKED_COLOR_PROOF_VF = "hue=s=0,colorbalance=rs=1:gs=-1:bs=-1,format=yuv420p";
/** If proof preview before/after is below this (% mean abs diff @ 160 px), FFmpeg output is effectively passthrough/wrong clip. */
const LOCKED_COLOR_PROOF_MIN_PIXEL_DIFF_PERCENT = 5;
/** If first frames are below this (%), treat as identical — output not color-graded vs input at t=0. */
const LOCKED_COLOR_FRAME0_IDENTICAL_MAX_PERCENT = 0.65;

type LockedColorJobState = {
  jobId: string;
  status: "queued" | "validating" | "uploading" | "processing" | "encoding" | "verifying" | "complete" | "failed";
  currentStep: string;
  progressPercent: number;
  lastProgressAt: string;
  targetVideoUrl: string;
  referenceVideoUrl: string;
  referenceImageUrl: string;
  targetFileExists: boolean;
  referenceFileExists: boolean;
  targetDuration: number | null;
  referenceDuration: number | null;
  targetCodec: string | null;
  referenceCodec: string | null;
  ffmpegStarted: boolean;
  ffmpegCommand: string;
  ffmpegLastLog: string;
  ffmpegProgressPercent: number;
  ffmpegElapsedSeconds: number;
  ffmpegExitCode: number | null;
  framesExtracted: number;
  referenceFramesExtracted: number;
  colorStatsComputed: boolean;
  colorTransferStarted: boolean;
  colorTransferCompleted: boolean;
  encodeStarted: boolean;
  encodeCompleted: boolean;
  finalOutputUrl: string;
  outputFileExists: boolean;
  outputFileSize: number;
  inputFileSize: number;
  inputFileHash: string;
  outputFileHash: string;
  inputOutputHashesDifferent: boolean;
  inputDurationSeconds: number;
  outputDurationSeconds: number;
  warning: string | null;
  realTargetUrlReady: boolean;
  realReferenceUrlReady: boolean;
  startedBeforeUploadFinished: boolean;
  usedPlaceholderUrl: boolean;
  usedOldOutputUrl: boolean;
  actualInputVideoUrl: string;
  actualReferenceUrl: string;
  actualFinalOutputUrl: string;
  targetFrameSampleBefore: string;
  referenceFrameSample: string;
  processedFrameSampleAfter: string;
  contactSheetUrl: string;
  beforeColorStats: Record<string, unknown> | null;
  referenceColorStats: Record<string, unknown> | null;
  afterColorStats: Record<string, unknown> | null;
  colorDeltaBeforeToReference: number | null;
  colorDeltaAfterToReference: number | null;
  transformStrength: number;
  exposureMatchStrength: number;
  contrastMatchStrength: number;
  saturationMatchStrength: number;
  whiteBalanceStrength: number;
  toneCurveStrength: number;
  filterGraphUsed: string;
  processedFramesUsedInEncode: boolean;
  referenceFrameExtracted: boolean;
  targetFrameExtracted: boolean;
  colorTransformApplied: boolean;
  processedFramesCreated: boolean;
  ffmpegUsedOriginalVideoCopy: boolean;
  averagePixelDifferencePercent: number;
  sampledFrameDiffs: Array<{
    timestamp: number;
    inputFrameUrl: string;
    outputFrameUrl: string;
    referenceFrameUrl: string;
    averagePixelDifferencePercent: number;
  }>;
  visibleChangeDetected: boolean;
  error: string | null;
  analyzeReferenceComplete: boolean;
  thumbnailUrl?: string;
  /** Mock-only: production color pipeline was not run. */
  heavyColorTransferSkipped?: boolean;
  debugProof?: Record<string, unknown>;
  /** FFmpeg-only locked reference path (never Luma for this mode). */
  actualEngineUsed: string;
  preserveTargetLuminance: boolean;
  /** Always true for this pipeline — limits copying absolute WB casts. */
  whiteBalanceProtection: boolean;
  yellowCastReduction: number;
  greenCastReduction: number;
  brightnessShift: number;
  saturationShift: number;
  contrastShift: number;
  rerenderedBecauseTooStrong: boolean;
};

const lockedColorJobs = new Map<string, LockedColorJobState>();

function isDemoModeEnabled(): boolean {
  if (isBaselineMode()) return false;
  const v = (process.env.BG_REPLACE_DEMO_MODE ?? "false").toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

function getRenderMode(): RenderMode {
  if (isBaselineMode()) return "local";
  // Default "local" runs the real FFmpeg locked-reference color pipeline (no paid AI for that mode).
  // RENDER_MODE=mock still labels the server tier (UI / billing); locked-reference jobs always use the full pipeline.
  const raw = String(process.env.RENDER_MODE ?? "local").trim().toLowerCase();
  if (raw === "production" || raw === "local" || raw === "mock") return raw;
  return "local";
}

function assertPaidAiAllowed() {
  if (getRenderMode() !== "production") {
    throw new Error("Paid AI calls are blocked outside production mode.");
  }
}

/** Locked-reference mock jobs only — matches mock FFmpeg contract (AAC re-encode, ultrafast). */
const MOCK_FAST_EQ_FILTER = "eq=contrast=1.15:saturation=1.25:brightness=0.02";

async function runMockLockedColorFfmpeg(
  inputPath: string,
  outputPath: string,
  opts: { maxSeconds: number; timeoutMs: number },
): Promise<void> {
  const bin = resolveFfmpegBin(ffmpegPath);
  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    MOCK_FAST_EQ_FILTER,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
  if (opts.maxSeconds > 0) {
    args.splice(1, 0, "-t", String(opts.maxSeconds));
  }
  const execOnce = () => execFileAsync(bin, args);
  prodPipelineLog("mock_locked_color_ffmpeg", {
    inputPath,
    outputPath,
    vf: MOCK_FAST_EQ_FILTER,
    argsJoined: [bin, ...args].join(" "),
    maxSeconds: opts.maxSeconds,
    timeoutMs: opts.timeoutMs,
  });
  await withTimeout(execOnce(), opts.timeoutMs, "Mock FFmpeg render timed out.");
}

const MOCK_VISIBLE_FILTER = MOCK_FAST_EQ_FILTER;

function parseEnvMs(key: string, defaultMs: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

function getMockRenderTimeoutMs(): number {
  return parseEnvMs("MOCK_RENDER_TIMEOUT_MS", 60_000);
}

function getMockEncodeMaxSeconds(): number {
  const raw = Number(process.env.MOCK_RENDER_MAX_INPUT_SECONDS ?? "12");
  if (!Number.isFinite(raw) || raw <= 0) return 12;
  return Math.min(raw, 120);
}

function getDomain(): string | null {
  return process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0] ?? null;
}

function resolveReplicateUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof (output as any).url === "function") return (output as any).url().href;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === "string") return first;
    if (first && typeof (first as any).url === "function") return (first as any).url().href;
  }
  throw new Error("Unexpected output format from Replicate model");
}

async function downloadToFile(url: string, outPath: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to download ${url}: ${r.status}`);
  await writeFile(outPath, Buffer.from(await r.arrayBuffer()));
}

async function makeThumbnail(videoPath: string, outPath: string) {
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-i", videoPath, "-ss", "0.5", "-frames:v", "1", "-q:v", "3", outPath]);
}

async function extractFaceFrame(videoPath: string, outPath: string) {
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-ss", "0.5", "-i", videoPath, "-frames:v", "1", "-q:v", "2", outPath]);
}

function envValue(key: string): string {
  return String(process.env[key] ?? "").trim();
}

function missingKeysForMode(mode: ProductionMode): string[] {
  const missing: string[] = [];
  const replicateToken = envValue("REPLICATE_API_TOKEN");
  const lumaKey = envValue("LUMA_API_KEY");

  const needsReplicate = [
    "face_swap",
    "background_replace",
    "image_generate",
    "video_generate",
    "full_production",
  ].includes(mode);
  if (needsReplicate && !replicateToken) {
    missing.push("REPLICATE_API_TOKEN");
  }

  // Luma operations are currently executed through Replicate models in this app.
  // Accept either LUMA_API_KEY (direct) OR REPLICATE_API_TOKEN (proxy path).
  const needsLuma = ["background_replace", "full_production"].includes(mode);
  if (needsLuma && !lumaKey && !replicateToken) {
    missing.push("LUMA_API_KEY");
  }

  if (mode === "image_generate" && !envValue("GOOGLE_API_KEY")) {
    missing.push("GOOGLE_API_KEY");
  }

  return missing;
}

function parseMode(value: unknown): ProductionMode {
  const mode = String(value ?? "").trim() as ProductionMode;
  const valid: ProductionMode[] = [
    "face_swap",
    "background_replace",
    "object_edit",
    "color_grade",
    "locked_reference_color_match",
    "image_generate",
    "video_generate",
    "audio_cleanup",
    "full_production",
  ];
  if (!valid.includes(mode)) throw new Error("Invalid selectedMode for production render");
  return mode;
}

function parseAssetPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/") || value.includes("..")) return null;
  if (value.startsWith("/api/uploads/")) return path.join(UPLOADS_DIR, value.slice("/api/uploads/".length));
  if (value.startsWith("/api/videos-files/")) return path.join(VIDEOS_DIR, value.slice("/api/videos-files/".length));
  if (value.startsWith("/api/swaps/")) return path.join(SWAPS_DIR, value.slice("/api/swaps/".length));
  return null;
}

function isUnresolvedUrl(value: unknown): boolean {
  if (value == null) return true;
  const v = String(value).trim();
  if (!v) return true;
  if (v.includes("pending upload")) return true;
  if (v === "null" || v === "undefined") return true;
  if (v.startsWith("blob:") || v.startsWith("data:")) return true;
  return false;
}

async function uploadLocalFileToReplicate(replicate: Replicate, localPath: string, name: string): Promise<string> {
  const buf = await readFile(localPath);
  const uploaded = await replicate.files.create(buf, { filename: name });
  const getUrl = uploaded?.urls?.get;
  if (typeof getUrl !== "string" || !getUrl.startsWith("http")) {
    throw new Error("Replicate file upload returned an invalid URL");
  }
  return getUrl;
}

type VisibleTestRenderOpts = {
  maxInputSeconds?: number;
  timeoutMs?: number;
  /** Mock mode only — applies a visible EQ filter so test renders are obviously different. */
  applyMockColorFilter?: boolean;
};

async function applyVisibleTestRender(inputPath: string, outputPath: string, opts?: VisibleTestRenderOpts) {
  if (!opts?.applyMockColorFilter) {
    prodPipelineLog("ffmpeg_local_passthrough", { inputPath, outputPath });
    await ffmpegVideoPassthrough(inputPath, outputPath, {
      maxInputSeconds: opts?.maxInputSeconds,
    });
    return;
  }

  const bin = resolveFfmpegBin(ffmpegPath);
  const buildArgs = (audioMode: "copy" | "aac"): string[] => {
    const args = ["-y"];
    if (opts?.maxInputSeconds != null && opts.maxInputSeconds > 0) {
      args.push("-t", String(opts.maxInputSeconds));
    }
    args.push(
      "-i",
      inputPath,
      "-vf",
      MOCK_VISIBLE_FILTER,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
    );
    if (audioMode === "copy") {
      args.push("-c:a", "copy");
    } else {
      args.push("-c:a", "aac", "-b:a", "96k");
    }
    args.push("-movflags", "+faststart", outputPath);
    return args;
  };
  const run = () =>
    execFileAsync(bin, buildArgs("copy")).catch(() => execFileAsync(bin, buildArgs("aac")));
  if (opts?.timeoutMs != null && opts.timeoutMs > 0) {
    return withTimeout(run(), opts.timeoutMs, "Mock FFmpeg render timed out.");
  }
  return run();
}

type FrameStats = {
  rgbMean: { r: number; g: number; b: number };
  rgbStd: { r: number; g: number; b: number };
  labMean: { l: number; a: number; b: number };
  labStd: { l: number; a: number; b: number };
  saturation: number;
  luminance: number;
  contrast: number;
  blackPoint: number;
  whitePoint: number;
  shadowTint: { r: number; g: number; b: number };
  highlightTint: { r: number; g: number; b: number };
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function tailLog(raw: string, lines = 8): string {
  return raw.split("\n").filter(Boolean).slice(-lines).join(" | ");
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type MediaInfo = { duration: number; codec: string };

async function probeMedia(inputPath: string): Promise<MediaInfo> {
  const ffprobeBin = ffprobeStatic?.path || "ffprobe";
  const { stdout } = await execFileAsync(ffprobeBin, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name:format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const parts = stdout.split("\n").map((v) => v.trim()).filter(Boolean);
  const codec = parts[0] ?? "unknown";
  const duration = Number(parts[1] ?? "0");
  return { codec, duration: Number.isFinite(duration) ? duration : 0 };
}



function updateJob(job: LockedColorJobState, patch: Partial<LockedColorJobState>) {
  Object.assign(job, patch, { lastProgressAt: new Date().toISOString() });
}

function parseFfmpegTimeToSeconds(line: string): number | null {
  const m = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  return hh * 3600 + mm * 60 + ss;
}

function encodeTimeoutMsForDuration(durationSec: number): number {
  if (durationSec < 15) return 15 * 60_000;
  if (durationSec <= 60) return 30 * 60_000;
  if (durationSec <= 5 * 60) return 60 * 60_000;
  return 90 * 60_000;
}

async function runFfmpegEncodeWithProgress(params: {
  job: LockedColorJobState;
  args: string[];
  timeoutMs: number;
  totalDurationSec: number;
  progressStart: number;
  progressEnd: number;
}) {
  const { job, args, timeoutMs, totalDurationSec, progressStart, progressEnd } = params;
  const bin = resolveFfmpegBin(ffmpegPath);
  const commandText = `${bin} ${args.join(" ")}`;
  updateJob(job, {
    ffmpegStarted: true,
    ffmpegCommand: commandText,
    ffmpegLastLog: "FFmpeg encode started.",
    ffmpegProgressPercent: 0,
    ffmpegElapsedSeconds: 0,
    ffmpegExitCode: null,
  });
  prodPipelineLog("ffmpeg_spawn", {
    ffmpegBin: bin,
    argsJoined: args.join(" "),
    timeoutMs,
    progressRange: [progressStart, progressEnd],
    inferredDurationSec: totalDurationSec,
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let lastLog = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      updateJob(job, {
        ffmpegLastLog: "Timed out during final FFmpeg encode.",
        ffmpegExitCode: -1,
      });
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 3000);
      reject(new Error("Timed out during final FFmpeg encode."));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      lastLog = text.trim() || lastLog;
      const elapsed = parseFfmpegTimeToSeconds(text);
      if (elapsed !== null) {
        const frac = totalDurationSec > 0 ? clamp(elapsed / totalDurationSec, 0, 1) : 0;
        const percent = Math.round(progressStart + frac * (progressEnd - progressStart));
        updateJob(job, {
          ffmpegElapsedSeconds: elapsed,
          ffmpegProgressPercent: Math.round(frac * 100),
          progressPercent: clamp(percent, progressStart, progressEnd),
          ffmpegLastLog: tailLog(text, 3),
        });
      } else if (text.trim()) {
        updateJob(job, { ffmpegLastLog: tailLog(text, 3) });
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      updateJob(job, { ffmpegExitCode: 1, ffmpegLastLog: err.message });
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const exitCode = typeof code === "number" ? code : 1;
      updateJob(job, {
        ffmpegExitCode: exitCode,
        ffmpegLastLog: lastLog ? tailLog(lastLog, 3) : "FFmpeg exited.",
      });
      if (exitCode === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${exitCode}. ${lastLog}`));
    });
  });
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  const xr = x / 0.95047;
  const yr = y / 1.0;
  const zr = z / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xr);
  const fy = f(yr);
  const fz = f(zr);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

async function extractRepresentativeFrames(inputPath: string, outputPrefix: string, isImage: boolean): Promise<string[]> {
  const bin = resolveFfmpegBin(ffmpegPath);
  if (isImage) {
    const p = `${outputPrefix}-0.png`;
    await execFileAsync(bin, ["-y", "-i", inputPath, "-vf", "scale=160:160:force_original_aspect_ratio=decrease,pad=160:160:(ow-iw)/2:(oh-ih)/2", "-frames:v", "1", p]);
    return [p];
  }
  const ffprobeBin = ffprobeStatic?.path || "ffprobe";
  let durationSec = 6;
  try {
    const { stdout } = await execFileAsync(ffprobeBin, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath]);
    durationSec = Math.max(1, Number(stdout.trim()) || 6);
  } catch {
    // keep default
  }
  /** More samples so reference/target “look” isn’t averaged away from a single mid clip frame. */
  const times = [0.08, 0.28, 0.5, 0.72, 0.92].map((ratio) =>
    clamp(durationSec * ratio, 0.15, Math.max(0.15, durationSec - 0.15)),
  );
  const out: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const p = `${outputPrefix}-${i}.png`;
    out.push(p);
    await execFileAsync(bin, [
      "-y",
      "-ss", times[i].toFixed(2),
      "-i", inputPath,
      "-vf", "thumbnail=40,scale=160:160:force_original_aspect_ratio=decrease,pad=160:160:(ow-iw)/2:(oh-ih)/2",
      "-frames:v", "1",
      p,
    ]);
  }
  return out;
}

async function analyzeFrame(framePath: string): Promise<FrameStats> {
  const ppmPath = `${framePath}.ppm`;
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-i", framePath, "-f", "image2", "-vcodec", "ppm", ppmPath]);
  const buf = await readFile(ppmPath);
  let idx = 0;
  let nls = 0;
  while (idx < buf.length && nls < 3) {
    if (buf[idx] === 0x0a) nls++;
    idx++;
  }
  const px: Array<{ r: number; g: number; b: number; lum: number; sat: number; labL: number; labA: number; labB: number }> = [];
  for (let i = idx; i + 2 < buf.length; i += 3) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lab = rgbToLab(r, g, b);
    px.push({ r, g, b, lum, sat, labL: lab.l, labA: lab.a, labB: lab.b });
  }
  const n = Math.max(1, px.length);
  let sr = 0, sg = 0, sb = 0, sl = 0, ss = 0, sll = 0, sla = 0, slb = 0;
  for (const p of px) {
    sr += p.r; sg += p.g; sb += p.b; sl += p.lum; ss += p.sat; sll += p.labL; sla += p.labA; slb += p.labB;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n, ml = sl / n, ms = ss / n, mll = sll / n, mla = sla / n, mlb = slb / n;
  let vr = 0, vg = 0, vb = 0, vl = 0, vll = 0, vla = 0, vlb = 0;
  for (const p of px) {
    vr += Math.pow(p.r - mr, 2);
    vg += Math.pow(p.g - mg, 2);
    vb += Math.pow(p.b - mb, 2);
    vl += Math.pow(p.lum - ml, 2);
    vll += Math.pow(p.labL - mll, 2);
    vla += Math.pow(p.labA - mla, 2);
    vlb += Math.pow(p.labB - mlb, 2);
  }
  const sorted = [...px].sort((a, b) => a.lum - b.lum);
  const low = sorted.slice(0, Math.max(1, Math.floor(n * 0.08)));
  const high = sorted.slice(Math.max(0, Math.floor(n * 0.92)));
  const avgRgb = (items: typeof px) => {
    let r = 0, g = 0, b = 0;
    for (const p of items) { r += p.r; g += p.g; b += p.b; }
    const d = Math.max(1, items.length);
    return { r: r / d, g: g / d, b: b / d };
  };
  const shadowTint = avgRgb(low);
  const highlightTint = avgRgb(high);
  return {
    rgbMean: { r: mr, g: mg, b: mb },
    rgbStd: { r: Math.sqrt(vr / n), g: Math.sqrt(vg / n), b: Math.sqrt(vb / n) },
    labMean: { l: mll, a: mla, b: mlb },
    labStd: { l: Math.sqrt(vll / n), a: Math.sqrt(vla / n), b: Math.sqrt(vlb / n) },
    saturation: ms,
    luminance: ml,
    contrast: Math.sqrt(vl / n),
    blackPoint: low.reduce((acc, p) => acc + p.lum, 0) / Math.max(1, low.length),
    whitePoint: high.reduce((acc, p) => acc + p.lum, 0) / Math.max(1, high.length),
    shadowTint,
    highlightTint,
  };
}

async function averagePixelDifferencePercent(imageAPath: string, imageBPath: string): Promise<number> {
  const ffmpegBin = resolveFfmpegBin(ffmpegPath);
  const aPpm = `${imageAPath}.cmp.ppm`;
  const bPpm = `${imageBPath}.cmp.ppm`;
  const scale = "scale=160:160:force_original_aspect_ratio=decrease,pad=160:160:(ow-iw)/2:(oh-ih)/2";
  await execFileAsync(ffmpegBin, ["-y", "-i", imageAPath, "-vf", scale, "-frames:v", "1", aPpm]);
  await execFileAsync(ffmpegBin, ["-y", "-i", imageBPath, "-vf", scale, "-frames:v", "1", bPpm]);
  const [aBuf, bBuf] = await Promise.all([readFile(aPpm), readFile(bPpm)]);
  const skipHeader = (buf: Buffer) => {
    let idx = 0;
    let nls = 0;
    while (idx < buf.length && nls < 3) {
      if (buf[idx] === 0x0a) nls++;
      idx++;
    }
    return idx;
  };
  const aStart = skipHeader(aBuf);
  const bStart = skipHeader(bBuf);
  const length = Math.min(aBuf.length - aStart, bBuf.length - bStart);
  if (length <= 0) return 0;
  let diff = 0;
  for (let i = 0; i < length; i++) {
    diff += Math.abs(aBuf[aStart + i] - bBuf[bStart + i]);
  }
  const max = length * 255;
  return (diff / max) * 100;
}

async function sha256ForFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/** Fast content fingerprint for mock mode — avoids reading multi‑GB uploads. */
async function sha256PrefixForFile(filePath: string, maxBytes = 512 * 1024): Promise<string> {
  const st = await stat(filePath);
  const toRead = Math.min(maxBytes, st.size);
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(buf, 0, toRead, 0);
    const body = bytesRead === toRead ? buf : buf.subarray(0, bytesRead);
    return createHash("sha256").update(`size:${st.size}:`).update(body).digest("hex");
  } finally {
    await fh.close();
  }
}

async function extractFrameAtTime(inputPath: string, timeSec: number, outPath: string): Promise<void> {
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, [
    "-y",
    "-ss", Math.max(0, timeSec).toFixed(3),
    "-i", inputPath,
    "-vf", "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2",
    "-frames:v", "1",
    outPath,
  ]);
}

function averageStats(samples: FrameStats[]): FrameStats {
  const c = Math.max(1, samples.length);
  const sum = samples.reduce((acc, s) => ({
    rgbMean: { r: acc.rgbMean.r + s.rgbMean.r, g: acc.rgbMean.g + s.rgbMean.g, b: acc.rgbMean.b + s.rgbMean.b },
    rgbStd: { r: acc.rgbStd.r + s.rgbStd.r, g: acc.rgbStd.g + s.rgbStd.g, b: acc.rgbStd.b + s.rgbStd.b },
    labMean: { l: acc.labMean.l + s.labMean.l, a: acc.labMean.a + s.labMean.a, b: acc.labMean.b + s.labMean.b },
    labStd: { l: acc.labStd.l + s.labStd.l, a: acc.labStd.a + s.labStd.a, b: acc.labStd.b + s.labStd.b },
    saturation: acc.saturation + s.saturation,
    luminance: acc.luminance + s.luminance,
    contrast: acc.contrast + s.contrast,
    blackPoint: acc.blackPoint + s.blackPoint,
    whitePoint: acc.whitePoint + s.whitePoint,
    shadowTint: { r: acc.shadowTint.r + s.shadowTint.r, g: acc.shadowTint.g + s.shadowTint.g, b: acc.shadowTint.b + s.shadowTint.b },
    highlightTint: { r: acc.highlightTint.r + s.highlightTint.r, g: acc.highlightTint.g + s.highlightTint.g, b: acc.highlightTint.b + s.highlightTint.b },
  }), {
    rgbMean: { r: 0, g: 0, b: 0 },
    rgbStd: { r: 0, g: 0, b: 0 },
    labMean: { l: 0, a: 0, b: 0 },
    labStd: { l: 0, a: 0, b: 0 },
    saturation: 0,
    luminance: 0,
    contrast: 0,
    blackPoint: 0,
    whitePoint: 0,
    shadowTint: { r: 0, g: 0, b: 0 },
    highlightTint: { r: 0, g: 0, b: 0 },
  });
  return {
    rgbMean: { r: sum.rgbMean.r / c, g: sum.rgbMean.g / c, b: sum.rgbMean.b / c },
    rgbStd: { r: sum.rgbStd.r / c, g: sum.rgbStd.g / c, b: sum.rgbStd.b / c },
    labMean: { l: sum.labMean.l / c, a: sum.labMean.a / c, b: sum.labMean.b / c },
    labStd: { l: sum.labStd.l / c, a: sum.labStd.a / c, b: sum.labStd.b / c },
    saturation: sum.saturation / c,
    luminance: sum.luminance / c,
    contrast: sum.contrast / c,
    blackPoint: sum.blackPoint / c,
    whitePoint: sum.whitePoint / c,
    shadowTint: { r: sum.shadowTint.r / c, g: sum.shadowTint.g / c, b: sum.shadowTint.b / c },
    highlightTint: { r: sum.highlightTint.r / c, g: sum.highlightTint.g / c, b: sum.highlightTint.b / c },
  };
}

type LockedRefFilterBuild = {
  filter: string;
  yellowCastReduction: number;
  greenCastReduction: number;
  brightnessShift: number;
  saturationShift: number;
  contrastShift: number;
  whiteBalanceProtection: boolean;
};

/** Push reference RGB tint vs target (scaled for FFmpeg colorbalance-style offsets). */
function tintRgbPush(
  ref: { r: number; g: number; b: number },
  tgt: { r: number; g: number; b: number },
  scale: number,
): { r: number; g: number; b: number } {
  const lim = 0.38;
  return {
    r: clamp((ref.r / Math.max(12, tgt.r) - 1) * scale, -lim, lim),
    g: clamp((ref.g / Math.max(12, tgt.g) - 1) * scale, -lim, lim),
    b: clamp((ref.b / Math.max(12, tgt.b) - 1) * scale, -lim, lim),
  };
}

/** Lab chroma angle (degrees). Undefined/neutral → 0 so atan2 noise doesn’t spin hue. */
function labChromaHueDeg(stats: FrameStats): number {
  const a = stats.labMean.a;
  const b = stats.labMean.b;
  if (Math.hypot(a, b) < 2.5) return 0;
  return Math.atan2(b, a) * (180 / Math.PI);
}

function shortestSignedAngleDeg(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * FFmpeg `-vf` from reference vs target frame stats: global gains + shadow/mid/highlight
 * colour borrowed from the reference clip (plus Lab chroma alignment on mids/highlights).
 */
function buildLockedReferenceFilter(
  target: FrameStats,
  reference: FrameStats,
  strength: number,
  exposureStrength: number,
  contrastStrength: number,
  saturationStrength: number,
  whiteBalanceStrength: number,
  toneCurveStrength: number,
  preserveSkinTone: boolean,
  preserveTargetLuminance: boolean,
): LockedRefFilterBuild {
  const s = clamp(strength, 0.05, 1.25);
  const ew = clamp(exposureStrength, 0, 1.25);
  const cw = clamp(contrastStrength, 0, 1.25);
  const satw = clamp(saturationStrength, 0, 1.25);
  const wbw = clamp(whiteBalanceStrength, 0, 1.25);
  const tw = clamp(toneCurveStrength, 0, 1.25);

  const tr = Math.max(10, target.rgbMean.r);
  const tg = Math.max(10, target.rgbMean.g);
  const tb = Math.max(10, target.rgbMean.b);
  const rr = Math.max(1, reference.rgbMean.r);
  const rg = Math.max(1, reference.rgbMean.g);
  const rb = Math.max(1, reference.rgbMean.b);

  let gR = 1 + (rr / tr - 1) * s * wbw * 1.12;
  let gG = 1 + (rg / tg - 1) * s * wbw * 1.12;
  let gB = 1 + (rb / tb - 1) * s * wbw * 1.12;

  /** Lab b* delta (reference − target). Positive ⇒ reference is yellower — match weakly so exports don’t pick up yellow mud. */
  const dbRaw = reference.labMean.b - target.labMean.b;
  const dbMatch = dbRaw > 0 ? dbRaw * 0.24 : dbRaw;

  if (preserveSkinTone) {
    const skinDamp = 0.78;
    gR = 1 + (gR - 1) * skinDamp;
    gG = 1 + (gG - 1) * skinDamp;
    gB = 1 + (gB - 1) * skinDamp;
  }
  gR = clamp(gR, 0.48, 1.92);
  gG = clamp(gG, 0.48, 1.92);
  gB = clamp(gB, 0.48, 1.92);

  /** Warm RGB bias (reference vs target) — damp shifts that add yellow via R+G vs B. */
  const warmBias =
    (rr + rg) / Math.max(35, rb + 15) - (tr + tg) / Math.max(35, tb + 15);
  if (warmBias > 0.04 && dbRaw > 1) {
    const chill = clamp(1 + warmBias * s * wbw * 0.12, 1, 1.22);
    gB = clamp(gB * chill, 0.48, 1.92);
    gR = clamp(gR / Math.sqrt(chill), 0.48, 1.92);
    gG = clamp(gG / Math.sqrt(chill), 0.48, 1.92);
  }

  if (preserveTargetLuminance) {
    const avgGain = (gR + gG + gB) / 3;
    const norm = 1 / Math.max(0.35, avgGain);
    const dampPreserve = 0.55;
    gR = clamp(1 + (gR * norm - 1) * dampPreserve, 0.48, 1.92);
    gG = clamp(1 + (gG * norm - 1) * dampPreserve, 0.48, 1.92);
    gB = clamp(1 + (gB * norm - 1) * dampPreserve, 0.48, 1.92);
  }

  let dSh = tintRgbPush(reference.shadowTint, target.shadowTint, s * wbw * 0.52);
  let dMid = tintRgbPush(reference.rgbMean, target.rgbMean, s * wbw * 0.58);
  let dHi = tintRgbPush(reference.highlightTint, target.highlightTint, s * wbw * 0.5);

  const da = reference.labMean.a - target.labMean.a;
  const labPush = s * wbw * 0.38;
  const cbLim = 0.42;
  dMid.r = clamp(dMid.r + clamp((da / 62) * labPush, -0.18, 0.18), -cbLim, cbLim);
  dMid.g = clamp(dMid.g + clamp((-da / 95) * labPush, -0.18, 0.18), -cbLim, cbLim);
  dMid.b = clamp(dMid.b + clamp((-dbMatch / 78) * labPush, -0.18, 0.18), -cbLim, cbLim);
  dHi.r = clamp(dHi.r + clamp((dbMatch / 88) * labPush * 0.62, -0.16, 0.16), -cbLim, cbLim);
  dHi.b = clamp(dHi.b + clamp((-dbMatch / 88) * labPush * 0.62, -0.16, 0.16), -cbLim, cbLim);

  /** Rotate global hue toward reference chroma; backing off when reference is much yellower avoids green→yellow swings. */
  let hueShiftDeg = shortestSignedAngleDeg(labChromaHueDeg(target), labChromaHueDeg(reference)) * s * wbw * 0.48;
  if (dbRaw > 5) hueShiftDeg *= 0.42;
  else if (dbRaw > 2) hueShiftDeg *= 0.68;
  hueShiftDeg = clamp(hueShiftDeg, -42, 42);
  if (preserveSkinTone) {
    hueShiftDeg *= 0.68;
    const dampCb = 0.72;
    dSh = { r: dSh.r * dampCb, g: dSh.g * dampCb, b: dSh.b * dampCb };
    dMid = { r: dMid.r * dampCb, g: dMid.g * dampCb, b: dMid.b * dampCb };
    dHi = { r: dHi.r * dampCb, g: dHi.g * dampCb, b: dHi.b * dampCb };
  }

  /** Final anti-yellow nudge in mids (bm↑) when reference is materially yellower than target. */
  if (dbRaw > 4) {
    const guard = clamp(0.024 * s * wbw * Math.min(1.5, dbRaw / 18), 0.004, 0.055);
    dMid.b = clamp(dMid.b + guard, -cbLim, cbLim);
  }

  const colorbalance = [
    `rs=${dSh.r.toFixed(5)}`,
    `gs=${dSh.g.toFixed(5)}`,
    `bs=${dSh.b.toFixed(5)}`,
    `rm=${dMid.r.toFixed(5)}`,
    `gm=${dMid.g.toFixed(5)}`,
    `bm=${dMid.b.toFixed(5)}`,
    `rh=${dHi.r.toFixed(5)}`,
    `gh=${dHi.g.toFixed(5)}`,
    `bh=${dHi.b.toFixed(5)}`,
  ].join(":");

  const lumT = Math.max(1, target.luminance);
  const lumR = Math.max(1, reference.luminance);
  let brightness = clamp((lumR / lumT - 1) * 0.11 * s * ew, -0.095, 0.095);
  if (dbRaw > 4) brightness = clamp(brightness * 0.55, -0.095, 0.095);

  const satT = Math.max(0.015, target.saturation);
  const satR = Math.max(0.015, reference.saturation);
  let saturation = 1 + (satR / satT - 1) * 1.05 * s * satw;
  saturation = clamp(saturation, 0.82, 1.72);
  if (saturation < 1.03 && s >= 0.15) {
    saturation = Math.min(1.72, saturation + 0.045 * s * satw);
  }
  if (dbRaw > 6) saturation = clamp(1 + (saturation - 1) * 0.78, 0.82, 1.72);

  const conT = Math.max(0.5, target.contrast);
  const conR = Math.max(0.5, reference.contrast);
  let contrast = 1 + (conR / conT - 1) * 0.72 * s * cw;
  contrast = clamp(contrast, 0.84, 1.45);
  if (contrast < 1.025 && s >= 0.15) {
    contrast = Math.min(1.45, contrast + 0.028 * s * cw);
  }

  const dL = reference.labMean.l - target.labMean.l;
  const gamma = clamp(1 + (dL / 100) * 0.16 * s * ew, 0.9, 1.12);

  const curveAmt = tw * s;
  const liftIn = 0.12 + 0.03 * (1 - curveAmt);
  const liftOut = 0.08 + 0.025 * (1 - curveAmt);
  const curves = `curves=all='0/0 ${liftIn.toFixed(3)}/${liftOut.toFixed(3)} 0.50/0.53 0.88/0.94 1/1'`;

  const filter =
    `colorchannelmixer=rr=${gR.toFixed(5)}:gg=${gG.toFixed(5)}:bb=${gB.toFixed(5)},` +
    `colorbalance=${colorbalance},` +
    `hue=h=${hueShiftDeg.toFixed(3)},` +
    `eq=contrast=${contrast.toFixed(5)}:brightness=${brightness.toFixed(5)}:saturation=${saturation.toFixed(5)}:gamma=${gamma.toFixed(5)},` +
    `${curves},format=yuv420p`;

  prodPipelineLog("locked_reference_filter_coefficients", {
    colorchannelmixer: { rr: gR, gg: gG, bb: gB },
    colorbalance: { shadows: dSh, mids: dMid, highlights: dHi },
    hueShiftDegrees: hueShiftDeg,
    eq: { contrast, brightness, saturation, gamma },
    curvesLiftInOut: [liftIn, liftOut],
    strengths: { overall: s, exposure: ew, contrast: cw, saturation: satw, whiteBalance: wbw, toneCurve: tw },
    preserveSkinTone,
    preserveTargetLuminance,
    labDeltaReferenceMinusTarget: { dL, da, db: dbRaw },
    yellowAxisGuard: { dbRaw, dbMatchFactor: dbRaw > 0 ? dbMatch / Math.max(1e-6, dbRaw) : 1 },
  });

  return {
    filter,
    yellowCastReduction: clamp(target.labMean.b - reference.labMean.b, -40, 40),
    greenCastReduction: clamp(target.labMean.a - reference.labMean.a, -40, 40),
    brightnessShift: brightness,
    saturationShift: saturation - 1,
    contrastShift: contrast - 1,
    whiteBalanceProtection: preserveSkinTone,
  };
}

type LockedRefPassResult = {
  avgDiffPercent: number;
  /** Mean abs pixel diff (%), first decoded frame (~t=0) input vs COLOR OUTPUT. */
  frame0PixelDifferencePercent: number;
  /** Mean abs pixel diff (%), ~0.45s proof clip before vs after extreme -vf proof. */
  proofPixelDifferencePercent: number;
  afterStats: FrameStats;
  filterComplex: string;
  filterMeta: LockedRefFilterBuild;
  outputStat: Awaited<ReturnType<typeof stat>>;
  outputInfo: MediaInfo;
  outputFileHash: string;
  inputOutputHashesDifferent: boolean;
  sampledFrameDiffs: LockedColorJobState["sampledFrameDiffs"];
  sampleFrames: Array<{ target: string; reference: string; output: string }>;
  colorDeltaBeforeToReference: number;
  colorDeltaAfterToReference: number;
};

async function runLockedReferenceEncodeSamplePass(params: {
  job: LockedColorJobState;
  jobId: string;
  resolvedInputPath: string;
  safeReferencePath: string;
  refIsImage: boolean;
  trimSeconds: number;
  outputPath: string;
  encodeTimeoutMs: number;
  effectiveDuration: number;
  preserveOriginalAudio: boolean;
  targetStats: FrameStats;
  referenceStats: FrameStats;
  targetInfo: MediaInfo;
  passStrength: number;
  exposureMatchStrength: number;
  contrastMatchStrength: number;
  saturationMatchStrength: number;
  whiteBalanceStrength: number;
  toneCurveStrength: number;
  preserveSkinTone: boolean;
  preserveTargetLuminance: boolean;
  inputFileHash: string;
}): Promise<LockedRefPassResult> {
  const {
    job,
    jobId,
    resolvedInputPath,
    safeReferencePath,
    refIsImage,
    trimSeconds,
    outputPath,
    encodeTimeoutMs,
    effectiveDuration,
    preserveOriginalAudio,
    targetStats,
    referenceStats,
    targetInfo,
    passStrength,
    exposureMatchStrength,
    contrastMatchStrength,
    saturationMatchStrength,
    whiteBalanceStrength,
    toneCurveStrength,
    preserveSkinTone,
    preserveTargetLuminance,
    inputFileHash,
  } = params;

  const ffmpegBin = resolveFfmpegBin(ffmpegPath);

  console.info(`${DW_PIPELINE_TAG} COLOR INPUT: ${resolvedInputPath}`);
  console.info(`${DW_PIPELINE_TAG} COLOR REFERENCE (media path): ${safeReferencePath}`);
  prodPipelineLog("locked_reference_paths", {
    colorInputResolved: resolvedInputPath,
    colorReferenceResolved: safeReferencePath,
    refIsImage,
  });

  /** ~2 s clip with unmistakable grading — if before/after still match, the encode path ignores -vf or reads the wrong stream. */
  const proofClipPath = path.join(VIDEOS_DIR, `${jobId}-color-transfer-proof.mp4`);
  const proofProbeSec = Math.min(0.45, Math.max(effectiveDuration * 0.1, 0.06));
  const proofCmd = [
    "-y",
    "-i",
    resolvedInputPath,
    "-t",
    "2",
    "-vf",
    LOCKED_COLOR_PROOF_VF,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    proofClipPath,
  ].join(" ");
  prodPipelineLog("locked_color_proof_encode", {
    ffmpegCommand: `ffmpeg ${proofCmd}`,
    proofClipOut: proofClipPath,
    vf: LOCKED_COLOR_PROOF_VF,
    proofProbeSec,
  });
  await execFileAsync(ffmpegBin, [
    "-y",
    "-i",
    resolvedInputPath,
    "-t",
    "2",
    "-vf",
    LOCKED_COLOR_PROOF_VF,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    proofClipPath,
  ]);
  const proofBeforePath = path.join(UPLOADS_DIR, `${jobId}-color-proof-before.jpg`);
  const proofAfterPath = path.join(UPLOADS_DIR, `${jobId}-color-proof-after.jpg`);
  await extractFrameAtTime(resolvedInputPath, proofProbeSec, proofBeforePath);
  await extractFrameAtTime(proofClipPath, proofProbeSec, proofAfterPath);
  const proofPixelDifferencePercent = await averagePixelDifferencePercent(proofBeforePath, proofAfterPath);
  console.info(
    `${DW_PIPELINE_TAG} COLOR PROOF (2s hue=0 saturation + extremes): PIXEL DIFFERENCE SCORE: ${proofPixelDifferencePercent}`,
  );
  prodPipelineLog("locked_color_proof_clip_pixels", {
    inputVideoPath: resolvedInputPath,
    proofClipPath,
    proofClipProbeSec: proofProbeSec,
    proofBeforeFramePath: proofBeforePath,
    proofAfterFramePath: proofAfterPath,
    proofPixelDifferencePercent,
    proofVf: LOCKED_COLOR_PROOF_VF,
  });
  if (proofPixelDifferencePercent < LOCKED_COLOR_PROOF_MIN_PIXEL_DIFF_PERCENT) {
    await unlink(proofClipPath).catch(() => {});
    throw new Error(
      "Color transfer proof failed: extreme test filter did not alter pixels. The FFmpeg preview path likely ignored -vf or the wrong input clip was read; final export would not prove color grading.",
    );
  }
  await unlink(proofClipPath).catch(() => {});
  const fb = buildLockedReferenceFilter(
    targetStats,
    referenceStats,
    passStrength,
    exposureMatchStrength,
    contrastMatchStrength,
    saturationMatchStrength,
    whiteBalanceStrength,
    toneCurveStrength,
    preserveSkinTone,
    preserveTargetLuminance,
  );
  const filterComplex = fb.filter;
  prodPipelineLog("locked_reference_filter", {
    vf: filterComplex,
    note: "reference_weighted_colorchannelmixer_eq_curves",
    passStrength,
    filterMeta: fb,
  });

  prodPipelineLog("locked_color_frame_stats_before_encode", {
    targetRgbMean: targetStats.rgbMean,
    referenceRgbMean: referenceStats.rgbMean,
    targetLabMean: targetStats.labMean,
    referenceLabMean: referenceStats.labMean,
  });

  updateJob(job, {
    transformStrength: passStrength,
    filterGraphUsed: filterComplex,
    yellowCastReduction: fb.yellowCastReduction,
    greenCastReduction: fb.greenCastReduction,
    brightnessShift: fb.brightnessShift,
    saturationShift: fb.saturationShift,
    contrastShift: fb.contrastShift,
    whiteBalanceProtection: fb.whiteBalanceProtection,
    preserveTargetLuminance,
    actualEngineUsed: "ffmpeg",
  });

  updateJob(job, { status: "encoding", currentStep: "encoding", progressPercent: 70, encodeStarted: true });

  const baseArgs = [
    "-y",
    "-i",
    resolvedInputPath,
    ...(trimSeconds > 0 ? ["-t", String(trimSeconds)] : []),
    "-vf",
    filterComplex,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    preserveOriginalAudio ? "copy" : "aac",
    ...(preserveOriginalAudio ? [] : ["-b:a", "128k"]),
    "-movflags",
    "+faststart",
    outputPath,
  ];

  await runFfmpegEncodeWithProgress({
    job,
    args: baseArgs,
    timeoutMs: encodeTimeoutMs,
    totalDurationSec: Math.max(1, effectiveDuration),
    progressStart: 70,
    progressEnd: 99,
  });
  prodPipelineLog("locked_color_main_encode_completed", {
    outputPath,
    ffmpegArgsJoined: ["ffmpeg", ...baseArgs].join(" "),
  });

  updateJob(job, {
    processedFramesUsedInEncode: true,
    processedFramesCreated: true,
    ffmpegExitCode: 0,
    ffmpegLastLog: "Encode completed.",
    ffmpegProgressPercent: 100,
  });
  const outputStat = await withTimeout(stat(outputPath), 20_000, "Timed out while verifying output file save.");
  const processedFramePath = path.join(UPLOADS_DIR, `${jobId}-processed-sample.png`);
  await execFileAsync(ffmpegBin, ["-y", "-ss", "0.5", "-i", outputPath, "-frames:v", "1", "-q:v", "2", processedFramePath]);
  const afterStats = await analyzeFrame(processedFramePath);

  prodPipelineLog("locked_color_frame_stats_after_encode", {
    processedSampleFramePath: processedFramePath,
    outputVideoPath: outputPath,
    afterRgbMean: afterStats.rgbMean,
    afterLabMean: afterStats.labMean,
    targetRgbMean: targetStats.rgbMean,
    rgbMeanDeltaAfterMinusTarget: {
      r: afterStats.rgbMean.r - targetStats.rgbMean.r,
      g: afterStats.rgbMean.g - targetStats.rgbMean.g,
      b: afterStats.rgbMean.b - targetStats.rgbMean.b,
    },
  });

  const verificationFailureMsg = "Final video verification failed. The app cannot prove color transfer was applied.";
  const outputInfo = await withTimeout(probeMedia(outputPath), 20_000, "Timed out while probing output media.");
  const outputFileHash = await withTimeout(sha256ForFile(outputPath), 60_000, "Timed out while hashing output file.");
  if (!outputFileHash) {
    throw new Error(verificationFailureMsg);
  }
  const inputOutputHashesDifferent = outputFileHash !== inputFileHash;
  if (!inputOutputHashesDifferent) {
    throw new Error("Final output file is identical to input. Color transfer was not applied.");
  }

  const frame0InputJpg = path.join(UPLOADS_DIR, `${jobId}-color-frame0-input.jpg`);
  const frame0OutputJpg = path.join(UPLOADS_DIR, `${jobId}-color-frame0-output.jpg`);
  await extractFrameAtTime(resolvedInputPath, 0, frame0InputJpg);
  await extractFrameAtTime(outputPath, 0, frame0OutputJpg);
  const frame0PixelDifferencePercent = await averagePixelDifferencePercent(frame0InputJpg, frame0OutputJpg);
  console.info(`${DW_PIPELINE_TAG} PIXEL DIFFERENCE SCORE: ${frame0PixelDifferencePercent}`);
  if (frame0PixelDifferencePercent < LOCKED_COLOR_FRAME0_IDENTICAL_MAX_PERCENT) {
    throw new Error("Color transfer failed: output matches input.");
  }

  console.info(`${DW_PIPELINE_TAG} COLOR OUTPUT: ${outputPath}`);
  prodPipelineLog("locked_color_output_ready", {
    colorOutputDiskPath: outputPath,
    vf: filterComplex,
    frame0PixelDifferencePercent,
    proofPixelDifferencePercent,
  });
  const samplePercents = [10, 30, 50, 70, 90];
  const sampledFrameDiffs: LockedColorJobState["sampledFrameDiffs"] = [];
  const sampleFrames: Array<{ target: string; reference: string; output: string }> = [];
  let sampledBeforeDelta = 0;
  let sampledAfterDelta = 0;
  const referenceDuration = Math.max(0.1, job.referenceDuration ?? targetInfo.duration);
  const safeOutputDuration = Math.max(0.1, outputInfo.duration);
  for (let i = 0; i < samplePercents.length; i++) {
    const percent = samplePercents[i];
    const ratio = percent / 100;
    const targetSamplePath = path.join(UPLOADS_DIR, `${jobId}-target-sample-${percent}.jpg`);
    const referenceSamplePath = path.join(UPLOADS_DIR, `${jobId}-reference-sample-${percent}.jpg`);
    const outputSamplePath = path.join(UPLOADS_DIR, `${jobId}-output-sample-${percent}.jpg`);
    const sampleTime = clamp(targetInfo.duration * ratio, 0, Math.max(0, targetInfo.duration - 0.1));
    await extractFrameAtTime(resolvedInputPath, sampleTime, targetSamplePath);
    await extractFrameAtTime(
      safeReferencePath,
      refIsImage ? 0 : clamp(referenceDuration * ratio, 0, Math.max(0, referenceDuration - 0.1)),
      referenceSamplePath,
    );
    await extractFrameAtTime(
      outputPath,
      clamp(safeOutputDuration * ratio, 0, Math.max(0, safeOutputDuration - 0.1)),
      outputSamplePath,
    );
    sampleFrames.push({ target: targetSamplePath, reference: referenceSamplePath, output: outputSamplePath });
    const diffPercent = await averagePixelDifferencePercent(targetSamplePath, outputSamplePath);
    sampledFrameDiffs.push({
      timestamp: Number(sampleTime.toFixed(3)),
      inputFrameUrl: `/api/uploads/${path.basename(targetSamplePath)}`,
      outputFrameUrl: `/api/uploads/${path.basename(outputSamplePath)}`,
      referenceFrameUrl: `/api/uploads/${path.basename(referenceSamplePath)}`,
      averagePixelDifferencePercent: diffPercent,
    });
    const [targetSampleStats, referenceSampleStats, outputSampleStats] = await Promise.all([
      analyzeFrame(targetSamplePath),
      analyzeFrame(referenceSamplePath),
      analyzeFrame(outputSamplePath),
    ]);
    sampledBeforeDelta += Math.sqrt(
      Math.pow(targetSampleStats.labMean.l - referenceSampleStats.labMean.l, 2) +
        Math.pow(targetSampleStats.labMean.a - referenceSampleStats.labMean.a, 2) +
        Math.pow(targetSampleStats.labMean.b - referenceSampleStats.labMean.b, 2),
    );
    sampledAfterDelta += Math.sqrt(
      Math.pow(outputSampleStats.labMean.l - referenceSampleStats.labMean.l, 2) +
        Math.pow(outputSampleStats.labMean.a - referenceSampleStats.labMean.a, 2) +
        Math.pow(outputSampleStats.labMean.b - referenceSampleStats.labMean.b, 2),
    );
  }
  const avgDiffPercent =
    sampledFrameDiffs.reduce((acc, sample) => acc + sample.averagePixelDifferencePercent, 0) /
    Math.max(1, sampledFrameDiffs.length);
  if (sampledFrameDiffs.length === 0) {
    throw new Error(verificationFailureMsg);
  }
  const colorDeltaBeforeToReference = sampledBeforeDelta / Math.max(1, sampledFrameDiffs.length);
  const colorDeltaAfterToReference = sampledAfterDelta / Math.max(1, sampledFrameDiffs.length);

  return {
    avgDiffPercent,
    frame0PixelDifferencePercent,
    proofPixelDifferencePercent,
    afterStats,
    filterComplex,
    filterMeta: fb,
    outputStat,
    outputInfo,
    outputFileHash,
    inputOutputHashesDifferent,
    sampledFrameDiffs,
    sampleFrames,
    colorDeltaBeforeToReference,
    colorDeltaAfterToReference,
  };
}

async function ensureReferenceVideoReadable(referencePath: string, jobId: string): Promise<string> {
  const ext = path.extname(referencePath).toLowerCase();
  if (ext === ".mp4") return referencePath;
  const transcoded = path.join(UPLOADS_DIR, `${jobId}-reference-safe.mp4`);
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, [
    "-y",
    "-i", referencePath,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    transcoded,
  ]);
  return transcoded;
}

async function runMockLockedReferenceColorJob(params: {
  job: LockedColorJobState;
  jobId: string;
  targetPath: string;
  referencePath: string;
  targetVideoUrl: string;
  referenceVideoUrl: string;
  referenceImageUrl: string;
  resolvedInputPath: string;
  colorMatchStrength: number;
  exposureMatchStrength: number;
  contrastMatchStrength: number;
  saturationMatchStrength: number;
  whiteBalanceStrength: number;
  toneCurveStrength: number;
}) {
  const {
    job,
    jobId,
    targetVideoUrl,
    referenceVideoUrl,
    referenceImageUrl,
    resolvedInputPath,
    colorMatchStrength,
    exposureMatchStrength,
    contrastMatchStrength,
    saturationMatchStrength,
    whiteBalanceStrength,
    toneCurveStrength,
  } = params;

  const mockTimeout = getMockRenderTimeoutMs();
  const maxEncodeSeconds = Math.min(getMockEncodeMaxSeconds(), 15);

  const targetInfo = await withTimeout(probeMedia(resolvedInputPath), 6_000, "Timed out probing target media.");
  const inputStat = await withTimeout(stat(resolvedInputPath), 4_000, "Timed out while reading input file metadata.");
  const inputFileHash = `mock-in:${jobId}:${inputStat.size}`;

  // No reference probe, no frame extraction, no sampled diffs — single FFmpeg pass only.
  updateJob(job, {
    targetDuration: targetInfo.duration,
    targetCodec: targetInfo.codec,
    inputDurationSeconds: targetInfo.duration,
    inputFileSize: inputStat.size,
    inputFileHash,
    status: "processing",
    currentStep: "mock_ffmpeg_encode",
    progressPercent: 30,
    heavyColorTransferSkipped: true,
    analyzeReferenceComplete: true,
    warning: null,
    referenceDuration: null,
    referenceCodec: null,
    colorTransferStarted: false,
    referenceFrameExtracted: false,
    targetFrameExtracted: false,
    colorStatsComputed: false,
  });

  const outputPath = path.join(VIDEOS_DIR, `${jobId}-locked-color-match.mp4`);
  await runMockLockedColorFfmpeg(resolvedInputPath, outputPath, {
    maxSeconds: maxEncodeSeconds,
    timeoutMs: mockTimeout,
  });

  const finalOutputUrl = `/api/videos-files/${jobId}-locked-color-match.mp4`;
  const resolvedOutputPath = parseAssetPath(finalOutputUrl) ?? outputPath;
  const outputInfo = await withTimeout(probeMedia(resolvedOutputPath), 6_000, "Timed out probing mock output.");
  const outputStat = await withTimeout(stat(resolvedOutputPath), 4_000, "Timed out reading mock output.");
  const outputFileHash = `mock-out:${jobId}:${outputStat.size}`;
  if (!(outputStat.size > 0 && outputInfo.duration > 0)) {
    throw new Error("Mock encode produced no playable output.");
  }

  await withTimeout(makeThumbnail(resolvedOutputPath, path.join(THUMBS_DIR, `${jobId}.jpg`)), 8_000, "Timed out creating thumbnail.");

  updateJob(job, {
    status: "complete",
    currentStep: "complete",
    progressPercent: 100,
    heavyColorTransferSkipped: true,
    encodeStarted: true,
    encodeCompleted: true,
    colorTransferCompleted: true,
    finalOutputUrl,
    outputFileExists: true,
    outputFileSize: outputStat.size,
    outputFileHash,
    outputDurationSeconds: outputInfo.duration,
    inputOutputHashesDifferent: true,
    sampledFrameDiffs: [],
    averagePixelDifferencePercent: 0,
    visibleChangeDetected: true,
    colorTransformApplied: false,
    processedFramesCreated: false,
    processedFramesUsedInEncode: true,
    filterGraphUsed: MOCK_FAST_EQ_FILTER,
    transformStrength: colorMatchStrength,
    exposureMatchStrength,
    contrastMatchStrength,
    saturationMatchStrength,
    whiteBalanceStrength,
    toneCurveStrength,
    error: null,
    thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
    actualEngineUsed: "ffmpeg-mock-eq",
    preserveTargetLuminance: false,
    whiteBalanceProtection: false,
    yellowCastReduction: 0,
    greenCastReduction: 0,
    brightnessShift: 0,
    saturationShift: 0,
    contrastShift: 0,
    rerenderedBecauseTooStrong: false,
    targetFrameSampleBefore: "",
    referenceFrameSample: "",
    processedFrameSampleAfter: "",
    actualFinalOutputUrl: finalOutputUrl,
    targetVideoUrl,
    referenceVideoUrl,
    referenceImageUrl,
    debugProof: {
      renderMode: "mock",
      paidAiCalled: false,
      mockOutputGenerated: true,
      heavyColorTransferSkipped: true,
      finalOutputUrl: "present",
      verificationPassed: true,
      mode: "locked_reference_color_match",
      progressPercent: 100,
      currentStep: "complete",
      analyzeReferenceComplete: true,
      colorTransferComplete: true,
      encodeComplete: true,
      inputFileHash,
      outputFileHash,
      inputOutputHashesDifferent: true,
      inputFileSize: inputStat.size,
      inputDurationSeconds: targetInfo.duration,
      outputDurationSeconds: outputInfo.duration,
      sampledFrameDiffs: [],
      filterGraphUsed: MOCK_FAST_EQ_FILTER,
      actualEngineUsed: "ffmpeg-mock-eq",
      preserveTargetLuminance: false,
      whiteBalanceProtection: false,
      yellowCastReduction: 0,
      greenCastReduction: 0,
      brightnessShift: 0,
      saturationShift: 0,
      contrastShift: 0,
      rerenderedBecauseTooStrong: false,
      error: null,
    },
  });
}

async function runLockedReferenceColorJob(params: {
  job: LockedColorJobState;
  jobId: string;
  targetPath: string;
  referencePath: string;
  targetVideoUrl: string;
  referenceVideoUrl: string;
  referenceImageUrl: string;
  colorMatchStrength: number;
  exposureMatchStrength: number;
  contrastMatchStrength: number;
  saturationMatchStrength: number;
  whiteBalanceStrength: number;
  toneCurveStrength: number;
  preserveSkinTone: boolean;
  preserveOriginalAudio: boolean;
  preserveTargetLuminance: boolean;
}) {
  const {
    job,
    jobId,
    targetPath,
    referencePath,
    targetVideoUrl,
    referenceVideoUrl,
    referenceImageUrl,
    colorMatchStrength,
    exposureMatchStrength,
    contrastMatchStrength,
    saturationMatchStrength,
    whiteBalanceStrength,
    toneCurveStrength,
    preserveSkinTone,
    preserveOriginalAudio,
    preserveTargetLuminance,
  } = params;
  try {
    updateJob(job, {
      status: "validating",
      currentStep: "validating",
      progressPercent: 10,
      targetVideoUrl,
      referenceVideoUrl,
      referenceImageUrl,
      targetFileExists: await exists(targetPath),
      referenceFileExists: await exists(referencePath),
    });
    if (!job.targetFileExists) throw new Error("Target media file not found on server.");
    if (!job.referenceFileExists) throw new Error("Reference media file not found on server.");

    const resolvedInputPath = parseAssetPath(targetVideoUrl) ?? targetPath;

    const targetInfo = await withTimeout(
      probeMedia(resolvedInputPath),
      20_000,
      "Timed out probing target media.",
    );
    const inputStat = await withTimeout(
      stat(resolvedInputPath),
      20_000,
      "Timed out while reading input file metadata.",
    );
    const inputFileHash = await withTimeout(
      sha256ForFile(resolvedInputPath),
      60_000,
      "Timed out while hashing input file.",
    );
    if (!inputFileHash) {
      throw new Error("Input file hash could not be computed.");
    }
    const encodeTimeoutMs = encodeTimeoutMsForDuration(targetInfo.duration);
    const devTrimSeconds = 0;
    const effectiveDuration = devTrimSeconds > 0 ? Math.min(targetInfo.duration, devTrimSeconds) : targetInfo.duration;
    const longVideoWarning =
      targetInfo.duration > 5 * 60
        ? "Long input detected (>5 min). Processing as background job with extended encode timeout."
        : null;
    updateJob(job, {
      targetDuration: targetInfo.duration,
      targetCodec: targetInfo.codec,
      inputDurationSeconds: targetInfo.duration,
      inputFileSize: inputStat.size,
      inputFileHash,
      status: "uploading",
      currentStep: "preparing_files",
      progressPercent: 20,
      warning: longVideoWarning,
    });

    const refIsImage = IMAGE_EXTS.has(path.extname(referencePath).toLowerCase());
    let safeReferencePath = referencePath;
    if (!refIsImage) {
      safeReferencePath = await withTimeout(
        ensureReferenceVideoReadable(referencePath, jobId),
        60_000,
        "Timed out transcoding reference video to safe format.",
      );
      const refInfo = await withTimeout(
        probeMedia(safeReferencePath),
        20_000,
        "Timed out probing reference media.",
      );
      updateJob(job, { referenceDuration: refInfo.duration, referenceCodec: refInfo.codec });
    }

    updateJob(job, { status: "processing", currentStep: "processing", progressPercent: 40, ffmpegStarted: true });
    let targetFrames: string[] = [];
    let referenceFrames: string[] = [];
    try {
      targetFrames = await withTimeout(
        extractRepresentativeFrames(resolvedInputPath, `${resolvedInputPath}-sample`, false),
        45_000,
        "Timed out during target frame extraction.",
      );
      referenceFrames = await withTimeout(
        extractRepresentativeFrames(safeReferencePath, `${safeReferencePath}-sample`, refIsImage),
        45_000,
        "Timed out during reference frame extraction.",
      );
    } catch (err: any) {
      const stderr = typeof err?.stderr === "string" ? tailLog(err.stderr) : "";
      const msg = `FFmpeg failed during reference analysis: ${stderr || err?.message || "unknown error"}`;
      updateJob(job, { ffmpegLastLog: msg, ffmpegExitCode: 1 });
      throw new Error(msg);
    }
    updateJob(job, {
      framesExtracted: targetFrames.length,
      referenceFramesExtracted: referenceFrames.length,
      targetFrameExtracted: targetFrames.length > 0,
      referenceFrameExtracted: referenceFrames.length > 0,
      analyzeReferenceComplete: true,
    });
    if (!targetFrames.length) {
      throw new Error("Failed to extract target sample frames.");
    }
    if (!referenceFrames.length) {
      throw new Error("Failed to extract reference sample frames.");
    }

    updateJob(job, { status: "processing", currentStep: "processing", progressPercent: 60 });
    const [targetStats, referenceStats] = await withTimeout(
      Promise.all([
        Promise.all(targetFrames.map((p) => analyzeFrame(p))).then(averageStats),
        Promise.all(referenceFrames.map((p) => analyzeFrame(p))).then(averageStats),
      ]),
      45_000,
      "Timed out during color analysis.",
    );
    updateJob(job, { colorStatsComputed: true });

    prodPipelineLog("locked_color_analyzed_reference_vs_target", {
      jobId,
      inputVideoPath: resolvedInputPath,
      referenceMediaPath: referencePath,
      safeReferencePath,
      refIsImage,
      targetRgbMean: targetStats.rgbMean,
      referenceRgbMean: referenceStats.rgbMean,
      targetLabMean: targetStats.labMean,
      referenceLabMean: referenceStats.labMean,
      targetSaturation: targetStats.saturation,
      referenceSaturation: referenceStats.saturation,
      targetContrast: targetStats.contrast,
      referenceContrast: referenceStats.contrast,
      colorMatchStrength,
      exposureMatchStrength,
      contrastMatchStrength,
      saturationMatchStrength,
      whiteBalanceStrength,
      toneCurveStrength,
    });

    updateJob(job, { status: "processing", currentStep: "processing", progressPercent: 40, colorTransferStarted: true });
    const outputPath = path.join(VIDEOS_DIR, `${jobId}-locked-color-match.mp4`);
    updateJob(job, {
      beforeColorStats: targetStats as unknown as Record<string, unknown>,
      referenceColorStats: referenceStats as unknown as Record<string, unknown>,
      colorTransformApplied: true,
      transformStrength: colorMatchStrength,
      exposureMatchStrength,
      contrastMatchStrength,
      saturationMatchStrength,
      whiteBalanceStrength,
      toneCurveStrength,
      preserveTargetLuminance,
      actualEngineUsed: "ffmpeg",
      whiteBalanceProtection: true,
      yellowCastReduction: 0,
      greenCastReduction: 0,
      brightnessShift: 0,
      saturationShift: 0,
      contrastShift: 0,
      rerenderedBecauseTooStrong: false,
      filterGraphUsed: "",
      processedFramesUsedInEncode: false,
    });

    const ffmpegBin = resolveFfmpegBin(ffmpegPath);

    /** Strength is no longer auto-reduced when input↔output pixel diff is high (that indicated visible transfer, not overshoot). */
    const rerenderedBecauseTooStrong = false;

    const runPass = (pw: number) =>
      runLockedReferenceEncodeSamplePass({
        job,
        jobId,
        resolvedInputPath,
        safeReferencePath,
        refIsImage,
        trimSeconds: devTrimSeconds,
        outputPath,
        encodeTimeoutMs,
        effectiveDuration,
        preserveOriginalAudio,
        targetStats,
        referenceStats,
        targetInfo,
        passStrength: pw,
        exposureMatchStrength,
        contrastMatchStrength,
        saturationMatchStrength,
        whiteBalanceStrength,
        toneCurveStrength,
        preserveSkinTone,
        preserveTargetLuminance,
        inputFileHash,
      });

    const pass = await runPass(colorMatchStrength);

    const {
      avgDiffPercent,
      frame0PixelDifferencePercent,
      proofPixelDifferencePercent,
      afterStats,
      filterComplex,
      filterMeta,
      outputInfo,
      outputFileHash,
      inputOutputHashesDifferent,
      sampledFrameDiffs,
      sampleFrames,
      colorDeltaBeforeToReference,
      colorDeltaAfterToReference,
    } = pass;

    const colorTransferredVideoPath = outputPath;
    console.info(`${DW_PIPELINE_TAG} FINAL EXPORT INPUT: ${colorTransferredVideoPath}`);
    prodPipelineLog("locked_color_final_export_paths", {
      jobId,
      sourceInputVideoPath: resolvedInputPath,
      processedVideoPath: colorTransferredVideoPath,
      expectedFinalUrlPathSuffix: `${jobId}-locked-color-match.mp4`,
      avgSampledFrameDiffPercent: avgDiffPercent,
      frame0PixelDifferencePercent,
      proofPixelDifferencePercent,
      inputOutputHashesDifferent,
      inputSha256Prefix: inputFileHash.slice(0, 24),
      outputSha256Prefix: outputFileHash.slice(0, 24),
    });

    const thumbPath = path.join(THUMBS_DIR, `${jobId}.jpg`);
    await makeThumbnail(colorTransferredVideoPath, thumbPath);
    const finalOutputUrl = `/api/videos-files/${jobId}-locked-color-match.mp4`;
    const resolvedOutputPath = colorTransferredVideoPath;
    const debugTargetBeforePath = path.join(UPLOADS_DIR, `${jobId}-debug-target-before.jpg`);
    const debugReferenceFramePath = path.join(UPLOADS_DIR, `${jobId}-debug-reference-frame.jpg`);
    const debugTargetAfterPath = path.join(UPLOADS_DIR, `${jobId}-debug-target-after.jpg`);
    const debugContactSheetPath = path.join(UPLOADS_DIR, "debug-color-match-contact-sheet.jpg");
    const processedFramePath = path.join(UPLOADS_DIR, `${jobId}-processed-sample.png`);
    if (targetFrames[0]) {
      await execFileAsync(ffmpegBin, ["-y", "-i", targetFrames[0], "-frames:v", "1", "-q:v", "2", debugTargetBeforePath]);
    }
    if (referenceFrames[0]) {
      await execFileAsync(ffmpegBin, ["-y", "-i", referenceFrames[0], "-frames:v", "1", "-q:v", "2", debugReferenceFramePath]);
    }
    await execFileAsync(ffmpegBin, ["-y", "-i", processedFramePath, "-frames:v", "1", "-q:v", "2", debugTargetAfterPath]);
    if (!(await exists(debugTargetAfterPath))) {
      throw new Error("Could not extract a sample frame from color-matched output for verification.");
    }
    const targetBeforeUrl = `/api/uploads/${jobId}-debug-target-before.jpg`;
    const referenceSampleUrl = `/api/uploads/${jobId}-debug-reference-frame.jpg`;
    const processedAfterUrl = `/api/uploads/${jobId}-debug-target-after.jpg`;

    const verificationFailureMsg = "Final video verification failed. The app cannot prove color transfer was applied.";
    const minVisibleDiff = 3;
    const visibleByAverage = avgDiffPercent >= minVisibleDiff;
    const visibleByFirstFrame = frame0PixelDifferencePercent >= minVisibleDiff;

    const contactSource = sampleFrames[Math.floor(sampleFrames.length / 2)] ?? sampleFrames[0];
    if (contactSource) {
      await execFileAsync(ffmpegBin, [
        "-y",
        "-i", contactSource.target,
        "-i", contactSource.reference,
        "-i", contactSource.output,
        "-filter_complex", "[0:v][1:v][2:v]hstack=inputs=3[outv]",
        "-map", "[outv]",
        "-frames:v", "1",
        debugContactSheetPath,
      ]);
    }
    if (!visibleByAverage && !visibleByFirstFrame) {
      throw new Error("Color transfer produced no visible change.");
    }
    const inputSize = statSync(resolvedInputPath).size;
    const outputSize = statSync(resolvedOutputPath).size;
    const verificationPassed =
      Boolean(inputFileHash) &&
      Boolean(outputFileHash) &&
      inputOutputHashesDifferent &&
      inputSize > 0 &&
      outputSize > 0 &&
      targetInfo.duration > 0 &&
      outputInfo.duration > 0 &&
      sampledFrameDiffs.length >= 3 &&
      (visibleByAverage || visibleByFirstFrame);
    if (!verificationPassed) {
      throw new Error(verificationFailureMsg);
    }
    updateJob(job, { status: "verifying", progressPercent: 90, currentStep: "verifying" });
    const veryStrongWarning =
      verificationPassed && avgDiffPercent > 28 ? "Color match is very strong and may look unnatural." : null;
    updateJob(job, {
      colorTransferCompleted: true,
      encodeCompleted: true,
      finalOutputUrl,
      outputFileExists: true,
      outputFileSize: outputSize,
      outputFileHash,
      inputOutputHashesDifferent,
      outputDurationSeconds: outputInfo.duration,
      actualFinalOutputUrl: finalOutputUrl,
      targetFrameSampleBefore: targetBeforeUrl,
      referenceFrameSample: referenceSampleUrl,
      processedFrameSampleAfter: processedAfterUrl,
      contactSheetUrl: "/api/uploads/debug-color-match-contact-sheet.jpg",
      afterColorStats: afterStats as unknown as Record<string, unknown>,
      colorDeltaBeforeToReference,
      colorDeltaAfterToReference,
      warning: veryStrongWarning,
      processedFramesCreated: true,
      ffmpegUsedOriginalVideoCopy: false,
      averagePixelDifferencePercent: avgDiffPercent,
      sampledFrameDiffs,
      visibleChangeDetected: verificationPassed,
      processedFramesUsedInEncode: true,
      status: "complete",
      progressPercent: 100,
      currentStep: "complete",
      error: null,
      rerenderedBecauseTooStrong,
      preserveTargetLuminance,
      actualEngineUsed: "ffmpeg",
      whiteBalanceProtection: filterMeta.whiteBalanceProtection,
      yellowCastReduction: filterMeta.yellowCastReduction,
      greenCastReduction: filterMeta.greenCastReduction,
      brightnessShift: filterMeta.brightnessShift,
      saturationShift: filterMeta.saturationShift,
      contrastShift: filterMeta.contrastShift,
      transformStrength: job.transformStrength,
      debugProof: {
        mode: "locked_reference_color_match",
        progressPercent: 100,
        currentStep: "complete",
        analyzeReferenceComplete: true,
        colorTransferComplete: true,
        encodeComplete: true,
        finalOutputUrl: "present",
        ffmpegCommand: job.ffmpegCommand,
        ffmpegLastLog: job.ffmpegLastLog,
        ffmpegExitCode: job.ffmpegExitCode,
        ffmpegProgressPercent: job.ffmpegProgressPercent,
        ffmpegElapsedSeconds: job.ffmpegElapsedSeconds,
        outputFileExists: true,
        outputFileSize: outputSize,
        inputFileHash,
        outputFileHash,
        inputOutputHashesDifferent,
        inputFileSize: inputSize,
        inputDurationSeconds: targetInfo.duration,
        outputDurationSeconds: outputInfo.duration,
        targetFrameSampleBefore: targetBeforeUrl,
        referenceFrameSample: referenceSampleUrl,
        processedFrameSampleAfter: processedAfterUrl,
        contactSheetUrl: "/api/uploads/debug-color-match-contact-sheet.jpg",
        beforeColorStats: targetStats,
        referenceColorStats: referenceStats,
        afterColorStats: afterStats,
        targetBeforeRgb: targetStats.rgbMean,
        targetBeforeRgbStd: targetStats.rgbStd,
        referenceRgb: referenceStats.rgbMean,
        referenceRgbStd: referenceStats.rgbStd,
        targetAfterRgb: afterStats.rgbMean,
        targetAfterRgbStd: afterStats.rgbStd,
        targetBeforeLab: targetStats.labMean,
        targetBeforeLabStd: targetStats.labStd,
        referenceLab: referenceStats.labMean,
        referenceLabStd: referenceStats.labStd,
        targetAfterLab: afterStats.labMean,
        targetAfterLabStd: afterStats.labStd,
        targetBeforeSaturation: targetStats.saturation,
        referenceSaturation: referenceStats.saturation,
        targetAfterSaturation: afterStats.saturation,
        targetBeforeContrast: targetStats.contrast,
        referenceContrast: referenceStats.contrast,
        targetAfterContrast: afterStats.contrast,
        colorDeltaBeforeToReference,
        colorDeltaAfterToReference,
        transformStrength: job.transformStrength,
        actualEngineUsed: "ffmpeg",
        preserveTargetLuminance,
        whiteBalanceProtection: filterMeta.whiteBalanceProtection,
        yellowCastReduction: filterMeta.yellowCastReduction,
        greenCastReduction: filterMeta.greenCastReduction,
        brightnessShift: filterMeta.brightnessShift,
        saturationShift: filterMeta.saturationShift,
        contrastShift: filterMeta.contrastShift,
        rerenderedBecauseTooStrong,
        exposureMatchStrength,
        filterGraphUsed: filterComplex,
        processedFramesUsedInEncode: true,
        referenceFrameExtracted: true,
        targetFrameExtracted: true,
        colorStatsComputed: true,
        colorTransformApplied: true,
        processedFramesCreated: true,
        ffmpegUsedOriginalVideoCopy: false,
        averagePixelDifferencePercent: avgDiffPercent,
        sampledFrameDiffs,
        visibleChangeDetected: verificationPassed,
        verificationPassed,
        frame0PixelDifferencePercent,
        proofPixelDifferencePercent,
        lockedColorProofVfUsed: LOCKED_COLOR_PROOF_VF,
        finalExportDiskPath: colorTransferredVideoPath,
        colorProofBeforeFrameUrl: `/api/uploads/${jobId}-color-proof-before.jpg`,
        colorProofAfterFrameUrl: `/api/uploads/${jobId}-color-proof-after.jpg`,
        realTargetUrlReady: job.realTargetUrlReady,
        realReferenceUrlReady: job.realReferenceUrlReady,
        startedBeforeUploadFinished: job.startedBeforeUploadFinished,
        usedPlaceholderUrl: job.usedPlaceholderUrl,
        usedOldOutputUrl: job.usedOldOutputUrl,
        actualInputVideoUrl: job.actualInputVideoUrl,
        actualReferenceUrl: job.actualReferenceUrl,
        actualFinalOutputUrl: finalOutputUrl,
        warning: veryStrongWarning,
        error: null,
      },
    });
  } catch (err: any) {
    updateJob(job, {
      status: "failed",
      currentStep: "error",
      error: err?.message ?? "Locked reference color match failed",
      debugProof: {
        mode: "locked_reference_color_match",
        progressPercent: job.progressPercent,
        currentStep: "error",
        analyzeReferenceComplete: job.analyzeReferenceComplete,
        colorTransferComplete: job.colorTransferCompleted,
        encodeComplete: job.encodeCompleted,
        finalOutputUrl: job.finalOutputUrl ? "present" : "missing",
        ffmpegCommand: job.ffmpegCommand,
        ffmpegLastLog: job.ffmpegLastLog,
        ffmpegExitCode: job.ffmpegExitCode,
        ffmpegProgressPercent: job.ffmpegProgressPercent,
        ffmpegElapsedSeconds: job.ffmpegElapsedSeconds,
        outputFileExists: job.outputFileExists,
        outputFileSize: job.outputFileSize,
        inputFileSize: job.inputFileSize,
        inputFileHash: job.inputFileHash,
        outputFileHash: job.outputFileHash,
        inputOutputHashesDifferent: job.inputOutputHashesDifferent,
        inputDurationSeconds: job.inputDurationSeconds,
        outputDurationSeconds: job.outputDurationSeconds,
        targetFrameSampleBefore: job.targetFrameSampleBefore,
        referenceFrameSample: job.referenceFrameSample,
        processedFrameSampleAfter: job.processedFrameSampleAfter,
        contactSheetUrl: job.contactSheetUrl,
        beforeColorStats: job.beforeColorStats,
        referenceColorStats: job.referenceColorStats,
        afterColorStats: job.afterColorStats,
        colorDeltaBeforeToReference: job.colorDeltaBeforeToReference,
        colorDeltaAfterToReference: job.colorDeltaAfterToReference,
        transformStrength: job.transformStrength,
        exposureMatchStrength: job.exposureMatchStrength,
        filterGraphUsed: job.filterGraphUsed,
        processedFramesUsedInEncode: job.processedFramesUsedInEncode,
        referenceFrameExtracted: job.referenceFrameExtracted,
        targetFrameExtracted: job.targetFrameExtracted,
        colorStatsComputed: job.colorStatsComputed,
        colorTransformApplied: job.colorTransformApplied,
        processedFramesCreated: job.processedFramesCreated,
        ffmpegUsedOriginalVideoCopy: job.ffmpegUsedOriginalVideoCopy,
        averagePixelDifferencePercent: job.averagePixelDifferencePercent,
        sampledFrameDiffs: job.sampledFrameDiffs,
        visibleChangeDetected: job.visibleChangeDetected,
        realTargetUrlReady: job.realTargetUrlReady,
        realReferenceUrlReady: job.realReferenceUrlReady,
        startedBeforeUploadFinished: job.startedBeforeUploadFinished,
        usedPlaceholderUrl: job.usedPlaceholderUrl,
        usedOldOutputUrl: job.usedOldOutputUrl,
        actualInputVideoUrl: job.actualInputVideoUrl,
        actualReferenceUrl: job.actualReferenceUrl,
        actualFinalOutputUrl: job.actualFinalOutputUrl,
        error: err?.message ?? "Locked reference color match failed",
      },
    });
  }
}

router.get("/render/targeted-mask-status", (_req, res) => {
  res.json(getPublicTargetedMaskStatus());
});

router.get("/render/status", requireAuth, async (req, res) => {
  const jobId = String(req.query?.jobId ?? "").trim();
  if (!jobId) return res.status(400).json({ error: "jobId is required" });
  const job = lockedColorJobs.get(jobId);
  if (!job) return res.status(404).json({ error: "Render job not found" });
  const renderMode = getRenderMode();
  const mockEqUsed = job.heavyColorTransferSkipped === true;
  const referencePipeline: "mock_eq" | "ffmpeg_locked_reference" = mockEqUsed ? "mock_eq" : "ffmpeg_locked_reference";
  return res.json({
    ...job,
    renderMode,
    serverRenderMode: renderMode,
    paidAiCalled: false,
    creditsDeducted: false,
    selectedMode: "locked_reference_color_match",
    selectedRoute: "/api/render/production",
    selectedEngine: mockEqUsed ? "ffmpeg-mock-visible-filter" : "ffmpeg-locked-reference-color-transfer",
    referencePipeline,
    mockEqUsed,
    targetUrlReady: job.realTargetUrlReady,
    referenceUrlReady: job.realReferenceUrlReady,
    inputVideoUrl: job.actualInputVideoUrl,
    referenceVideoUrl: job.referenceVideoUrl,
    referenceImageUrl: job.referenceImageUrl,
    previewUsingFinalOutputUrl: Boolean(job.finalOutputUrl),
    /** True only when this job used the fast mock EQ path (not the reference-driven pipeline). */
    mockOutputGenerated: mockEqUsed && Boolean(job.finalOutputUrl),
    heavyColorTransferSkipped: mockEqUsed,
    localOutputGenerated: renderMode === "local" && Boolean(job.finalOutputUrl),
    productionAiCalled: false,
  });
});

router.post(
  "/render/production",
  requireAuth,
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "target", maxCount: 1 },
    { name: "reference", maxCount: 1 },
    { name: "swapImage", maxCount: 1 },
    { name: "targetImage", maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const jobId = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (isBaselineMode()) {
      return baselineProductionPassthrough(req, res, jobId, files);
    }

    const selectedRoute = "/api/render/production";
    let selectedMode: ProductionMode = "full_production";
    let selectedEngine = "production-unified";
    let finalOutputUrl = "";
    let errorMessage = "";
    let realAiCalled = false;
    // BASELINE: Real AI toggle disconnected — always local.
    const realAiRequested = false;
    const renderMode = getRenderMode();
    let paidAiCalled = false;
    let creditsDeducted = false;
    let demoMode = isDemoModeEnabled() && !realAiRequested;
    let faceLockActive = false;
    let backgroundReplaceActive = false;
    let objectEditActive = false;
    let targetedObjectEditMeta: TargetedEditRunMeta | undefined;
    let colorGradeActive = false;
    let inputVideoUrlPresent = false;
    let inputImageUrlPresent = false;

    try {
      await mkdir(UPLOADS_DIR, { recursive: true });
      await mkdir(VIDEOS_DIR, { recursive: true });
      await mkdir(THUMBS_DIR, { recursive: true });
      await mkdir(SWAPS_DIR, { recursive: true });

      selectedMode = parseMode(req.body?.selectedMode ?? req.body?.mode);
      const requiresPaidAi = !["locked_reference_color_match", "color_grade", "object_edit", "audio_cleanup"].includes(selectedMode);
      if (renderMode === "production") {
        const missing = missingKeysForMode(selectedMode);
        if (missing.length > 0) {
          throw new Error(`AI render failed because ${missing[0]} is missing.`);
        }
      }
      if (demoMode && requiresPaidAi) {
        throw new Error("BG_REPLACE_DEMO_MODE=true blocks paid AI. Disable it or use RENDER_MODE=mock/local.");
      }

      const token = process.env.REPLICATE_API_TOKEN;
      let replicate: Replicate | null = null;
      const ensureReplicate = () => {
        if (!realAiRequested) assertPaidAiAllowed();
        if (!replicate) {
          if (!token) throw new Error("AI render failed because REPLICATE_API_TOKEN is missing.");
          replicate = new Replicate({ auth: token });
        }
        paidAiCalled = true;
        creditsDeducted = true;
        return replicate;
      };
      const domain = getDomain();
      const needsLuma = ["background_replace", "full_production"].includes(selectedMode);
      if (!demoMode && needsLuma && !domain) return res.status(500).json({ error: "Could not determine public domain" });

      const prompt = String(
        req.body?.prompt ??
          req.body?.requestedEdit ??
          req.body?.backgroundPrompt ??
          req.body?.transferPrompt ??
          "",
      ).trim();
      const colorPrompt = String(req.body?.colorPrompt ?? DEFAULT_COLOR_INSTRUCTION).trim();
      const lockFace = String(req.body?.lockFace ?? "true").toLowerCase() === "true";
      const objectX = Number(req.body?.objectX);
      const objectY = Number(req.body?.objectY);
      const selectedObject = String(req.body?.selectedObject ?? "").trim();
      const rawMaskR = Number(req.body?.maskRadius ?? req.body?.maskRadiusFrac);
      const maskRadiusFrac = Number.isFinite(rawMaskR) ? clamp(rawMaskR, 0.06, 0.48) : undefined;
      const segmentTrackJobId = String(req.body?.segmentTrackJobId ?? "").trim();

      const saveFileFromUpload = async (file: Express.Multer.File | undefined, suffix: string) => {
        if (!file) return null;
        const ext = "." + (file.originalname.split(".").pop() ?? "bin").toLowerCase();
        const safeExt = file.mimetype.startsWith("video/")
          ? (VIDEO_EXTS.has(ext) ? ext : ".mp4")
          : (IMAGE_EXTS.has(ext) ? ext : ".png");
        const diskPath = path.join(UPLOADS_DIR, `${jobId}-${suffix}${safeExt}`);
        await writeFile(diskPath, file.buffer);
        return { diskPath, relativeUrl: `/api/uploads/${jobId}-${suffix}${safeExt}` };
      };

      const uploadedVideo = await saveFileFromUpload(files?.video?.[0] ?? files?.target?.[0], "input-video");
      const uploadedImage = await saveFileFromUpload(files?.image?.[0], "input-image");
      const swapImage = await saveFileFromUpload(files?.swapImage?.[0], "swap-image");
      const targetImage = await saveFileFromUpload(files?.targetImage?.[0], "target-image");
      const referenceMedia = await saveFileFromUpload(files?.reference?.[0], "reference");

      const bodyVideoPath = parseAssetPath(req.body?.inputVideoUrl);
      const bodyImagePath = parseAssetPath(req.body?.inputImageUrl);
      const bodyReferencePath = parseAssetPath(req.body?.referenceUrl);
      const bodyReferenceVideoPath = parseAssetPath(req.body?.referenceVideoUrl);
      const bodyReferenceImagePath = parseAssetPath(req.body?.referenceImageUrl);
      const inputVideoPath = uploadedVideo?.diskPath ?? bodyVideoPath;
      const inputImagePath = uploadedImage?.diskPath ?? bodyImagePath;
      const referencePath =
        referenceMedia?.diskPath ?? bodyReferenceVideoPath ?? bodyReferenceImagePath ?? bodyReferencePath;
      inputVideoUrlPresent = Boolean(inputVideoPath);
      inputImageUrlPresent = Boolean(inputImagePath || referencePath);

      if (selectedMode === "locked_reference_color_match") {
        selectedEngine = "ffmpeg-locked-reference-color-transfer";
        const targetVideoUrl = String(req.body?.targetVideoUrl ?? req.body?.inputVideoUrl ?? "").trim();
        const referenceVideoUrl = String(req.body?.referenceVideoUrl ?? "").trim();
        const referenceImageUrl = String(req.body?.referenceImageUrl ?? "").trim();
        const colorMatchStrength = clamp(Number(req.body?.colorMatchStrength ?? 0.85), 0.05, 1.5);
        const exposureMatchStrength = clamp(Number(req.body?.exposureMatchStrength ?? 0.35), 0, 1.25);
        const contrastMatchStrength = clamp(Number(req.body?.contrastMatchStrength ?? 0.5), 0, 1.25);
        const saturationMatchStrength = clamp(Number(req.body?.saturationMatchStrength ?? 0.45), 0, 1.25);
        const whiteBalanceStrength = clamp(Number(req.body?.whiteBalanceStrength ?? 0.45), 0, 1.25);
        const toneCurveStrength = clamp(Number(req.body?.toneCurveStrength ?? 0.4), 0, 1.25);
        const preserveSkinTone = String(req.body?.preserveSkinTone ?? "true").toLowerCase() !== "false";
        const preserveOriginalAudio = String(req.body?.preserveOriginalAudio ?? "true").toLowerCase() !== "false";
        const preserveTargetLuminance = false;
        if (isUnresolvedUrl(targetVideoUrl)) {
          throw new Error("Target upload is not ready yet.");
        }
        if (isUnresolvedUrl(referenceVideoUrl) && isUnresolvedUrl(referenceImageUrl) && isUnresolvedUrl(req.body?.referenceUrl)) {
          throw new Error("Reference upload is not ready yet.");
        }
        if (!inputVideoPath) {
          throw new Error("locked_reference_color_match requires targetVideoUrl.");
        }
        if (!referencePath) {
          throw new Error("locked_reference_color_match requires referenceVideoUrl or referenceImageUrl.");
        }
        if (
          !allowsFullSceneVideoTransfer(req.body as Record<string, unknown>) &&
          isSpecificObjectEditIntent(prompt)
        ) {
          return res.status(422).json({
            error:
              "This prompt targets a specific object. Use targeted object editing (mask detection → static mask propagation → masked edit → composite) via selectedMode=object_edit instead of full-frame reference transfer.",
            code: "USE_TARGETED_OBJECT_EDIT",
            hint: "POST /api/render/production with video upload, objectX/objectY (optional with selectedObject), requestedEdit, maskRadius. Set allowFullSceneVideoTransfer=true only for intentional full-scene work.",
          });
        }
        const statusJobId = `locked-color-${randomUUID()}`;
        const initialJob: LockedColorJobState = {
          jobId: statusJobId,
          status: "queued",
          currentStep: "queued",
          progressPercent: 0,
          lastProgressAt: new Date().toISOString(),
          targetVideoUrl,
          referenceVideoUrl,
          referenceImageUrl,
          targetFileExists: false,
          referenceFileExists: false,
          targetDuration: null,
          referenceDuration: null,
          targetCodec: null,
          referenceCodec: null,
          ffmpegStarted: false,
          ffmpegCommand: "",
          ffmpegLastLog: "",
          ffmpegProgressPercent: 0,
          ffmpegElapsedSeconds: 0,
          ffmpegExitCode: null,
          framesExtracted: 0,
          referenceFramesExtracted: 0,
          colorStatsComputed: false,
          colorTransferStarted: false,
          colorTransferCompleted: false,
          encodeStarted: false,
          encodeCompleted: false,
          finalOutputUrl: "",
          outputFileExists: false,
          outputFileSize: 0,
          inputFileSize: 0,
          inputFileHash: "",
          outputFileHash: "",
          inputOutputHashesDifferent: false,
          inputDurationSeconds: 0,
          outputDurationSeconds: 0,
          warning: null,
          realTargetUrlReady: !isUnresolvedUrl(targetVideoUrl),
          realReferenceUrlReady:
            !isUnresolvedUrl(referenceVideoUrl) || !isUnresolvedUrl(referenceImageUrl) || !isUnresolvedUrl(req.body?.referenceUrl),
          startedBeforeUploadFinished:
            isUnresolvedUrl(targetVideoUrl) ||
            (isUnresolvedUrl(referenceVideoUrl) && isUnresolvedUrl(referenceImageUrl) && isUnresolvedUrl(req.body?.referenceUrl)),
          usedPlaceholderUrl:
            isUnresolvedUrl(targetVideoUrl) ||
            (isUnresolvedUrl(referenceVideoUrl) && isUnresolvedUrl(referenceImageUrl) && isUnresolvedUrl(req.body?.referenceUrl)),
          usedOldOutputUrl: false,
          actualInputVideoUrl: targetVideoUrl,
          actualReferenceUrl: referenceVideoUrl || referenceImageUrl || String(req.body?.referenceUrl ?? ""),
          actualFinalOutputUrl: "",
          targetFrameSampleBefore: "",
          referenceFrameSample: "",
          processedFrameSampleAfter: "",
          contactSheetUrl: "",
          beforeColorStats: null,
          referenceColorStats: null,
          afterColorStats: null,
          colorDeltaBeforeToReference: null,
          colorDeltaAfterToReference: null,
          transformStrength: colorMatchStrength,
          exposureMatchStrength,
          contrastMatchStrength,
          saturationMatchStrength,
          whiteBalanceStrength,
          toneCurveStrength,
          filterGraphUsed: "",
          processedFramesUsedInEncode: false,
          referenceFrameExtracted: false,
          targetFrameExtracted: false,
          colorTransformApplied: false,
          processedFramesCreated: false,
          ffmpegUsedOriginalVideoCopy: false,
          averagePixelDifferencePercent: 0,
          sampledFrameDiffs: [],
          visibleChangeDetected: false,
          error: null,
          heavyColorTransferSkipped: false,
          analyzeReferenceComplete: false,
          actualEngineUsed: "ffmpeg",
          preserveTargetLuminance,
          whiteBalanceProtection: true,
          yellowCastReduction: 0,
          greenCastReduction: 0,
          brightnessShift: 0,
          saturationShift: 0,
          contrastShift: 0,
          rerenderedBecauseTooStrong: false,
        };
        lockedColorJobs.set(statusJobId, initialJob);
        void runLockedReferenceColorJob({
          job: initialJob,
          jobId: statusJobId,
          targetPath: inputVideoPath,
          referencePath,
          targetVideoUrl,
          referenceVideoUrl,
          referenceImageUrl,
          colorMatchStrength,
          exposureMatchStrength,
          contrastMatchStrength,
          saturationMatchStrength,
          whiteBalanceStrength,
          toneCurveStrength,
          preserveSkinTone,
          preserveOriginalAudio,
          preserveTargetLuminance,
        });
        return res.json({
          jobId: statusJobId,
          renderMode,
          paidAiCalled,
          creditsDeducted,
          selectedMode,
          selectedRoute,
          selectedEngine: renderMode === "mock" ? "ffmpeg-mock-visible-filter" : selectedEngine,
          targetUrlReady: initialJob.realTargetUrlReady,
          referenceUrlReady: initialJob.realReferenceUrlReady,
          realTargetUrlReady: initialJob.realTargetUrlReady,
          realReferenceUrlReady: initialJob.realReferenceUrlReady,
          inputVideoUrl: targetVideoUrl,
          referenceVideoUrl,
          referenceImageUrl,
          currentStep: initialJob.currentStep,
          progressPercent: initialJob.progressPercent,
          finalOutputUrl: "",
          previewUsingFinalOutputUrl: false,
          mockOutputGenerated: false,
          localOutputGenerated: false,
          productionAiCalled: false,
          error: null,
        });
      }

      if (selectedMode === "face_swap") {
        const targetVideoUrlBody = String(req.body?.targetVideoUrl ?? "").trim();
        const faceSourceUrlBody = String(req.body?.faceSourceUrl ?? "").trim();
        if (renderMode !== "production") {
          if (targetVideoUrlBody && faceSourceUrlBody) {
            const targetLocal = parseAssetPath(targetVideoUrlBody);
            if (!targetLocal) throw new Error("face_swap video mode requires valid local asset URLs.");
            const outPath = path.join(VIDEOS_DIR, `${jobId}-face-lock.mp4`);
            await applyVisibleTestRender(
              targetLocal,
              outPath,
              renderMode === "mock"
                ? {
                    maxInputSeconds: getMockEncodeMaxSeconds(),
                    timeoutMs: getMockRenderTimeoutMs(),
                    applyMockColorFilter: true,
                  }
                : { applyMockColorFilter: false },
            );
            await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
            finalOutputUrl = `/api/videos-files/${jobId}-face-lock.mp4`;
            return res.json({
              renderMode,
              paidAiCalled: false,
              creditsDeducted: false,
              selectedMode,
              selectedRoute,
              selectedEngine: "ffmpeg-face-swap-test",
              videoUrl: finalOutputUrl,
              thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
              finalOutputUrl,
              previewUsingFinalOutputUrl: true,
              mockOutputGenerated: renderMode === "mock",
              localOutputGenerated: renderMode === "local",
              productionAiCalled: false,
            });
          }
          if (!targetImage?.diskPath) {
            throw new Error("face_swap requires swapImage and targetImage.");
          }
          const outPath = path.join(SWAPS_DIR, `${jobId}-result.png`);
          const bin = resolveFfmpegBin(ffmpegPath);
          await execFileAsync(bin, ["-y", "-i", targetImage.diskPath, "-vf", MOCK_VISIBLE_FILTER, outPath]);
          finalOutputUrl = `/api/swaps/${jobId}-result.png`;
          return res.json({
            renderMode,
            paidAiCalled: false,
            creditsDeducted: false,
            selectedMode,
            selectedRoute,
            selectedEngine: "ffmpeg-face-swap-test",
            imageUrl: finalOutputUrl,
            finalOutputUrl,
            previewUsingFinalOutputUrl: true,
            mockOutputGenerated: renderMode === "mock",
            localOutputGenerated: renderMode === "local",
            productionAiCalled: false,
          });
        }
        if (targetVideoUrlBody && faceSourceUrlBody) {
          selectedEngine = "arabyai-replicate/roop_face_swap";
          const targetLocal = parseAssetPath(targetVideoUrlBody);
          const faceSourceLocal = parseAssetPath(faceSourceUrlBody);
          if (!targetLocal || !faceSourceLocal) {
            throw new Error("face_swap video mode requires valid local asset URLs.");
          }
          const faceFramePath = path.join(UPLOADS_DIR, `${jobId}-face.jpg`);
          await extractFaceFrame(faceSourceLocal, faceFramePath);
          const client = ensureReplicate();
          const targetVideoUrl = await uploadLocalFileToReplicate(client, targetLocal, `${jobId}-target.mp4`);
          const faceImageUrl = await uploadLocalFileToReplicate(client, faceFramePath, `${jobId}-face.jpg`);
          const out = await client.run("arabyai-replicate/roop_face_swap", {
            input: { swap_image: faceImageUrl, target_video: targetVideoUrl },
          });
          realAiCalled = true;
          const outUrl = resolveReplicateUrl(out);
          const outPath = path.join(VIDEOS_DIR, `${jobId}-face-lock.mp4`);
          await downloadToFile(outUrl, outPath);
          await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
          finalOutputUrl = `/api/videos-files/${jobId}-face-lock.mp4`;
          return res.json({
            renderMode,
            paidAiCalled: true,
            creditsDeducted: true,
            selectedMode,
            selectedRoute,
            selectedEngine,
            realAiCalled,
            videoUrl: finalOutputUrl,
            thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
            finalOutputUrl,
            previewUsingFinalOutputUrl: true,
            mockOutputGenerated: false,
            localOutputGenerated: false,
            productionAiCalled: true,
          });
        }

        selectedEngine = "lucataco/faceswap";
        if (!swapImage?.diskPath || !targetImage?.diskPath) {
          throw new Error("face_swap requires swapImage and targetImage.");
        }
        if (!domain) throw new Error("Could not determine public domain for face swap.");
        const swapUrl = `https://${domain}${swapImage.relativeUrl}`;
        const targetUrl = `https://${domain}${targetImage.relativeUrl}`;
        const out = await ensureReplicate().run("lucataco/faceswap", {
          input: { swap_image: swapUrl, target_image: targetUrl },
        });
        realAiCalled = true;
        const outUrl = resolveReplicateUrl(out);
        const outPath = path.join(SWAPS_DIR, `${jobId}-result.png`);
        await downloadToFile(outUrl, outPath);
        finalOutputUrl = `/api/swaps/${jobId}-result.png`;
        return res.json({
          renderMode,
          paidAiCalled: true,
          creditsDeducted: true,
          selectedMode,
          selectedRoute,
          selectedEngine,
          realAiCalled,
          imageUrl: finalOutputUrl,
          finalOutputUrl,
          previewUsingFinalOutputUrl: true,
          mockOutputGenerated: false,
          localOutputGenerated: false,
          productionAiCalled: true,
        });
      }

      if (selectedMode === "image_generate") {
        selectedEngine = "black-forest-labs/flux-schnell";
        if (!prompt) throw new Error("image_generate requires a prompt.");
        if (renderMode !== "production") {
          const outPath = path.join(SWAPS_DIR, `${jobId}-image.png`);
          const bin = resolveFfmpegBin(ffmpegPath);
          await execFileAsync(bin, ["-y", "-f", "lavfi", "-i", "color=c=#253040:s=1024x1024:d=1", "-frames:v", "1", outPath]);
          finalOutputUrl = `/api/swaps/${jobId}-image.png`;
          return res.json({
            renderMode,
            paidAiCalled: false,
            creditsDeducted: false,
            selectedMode,
            selectedRoute,
            selectedEngine: "ffmpeg-image-generate-test",
            imageUrl: finalOutputUrl,
            finalOutputUrl,
            previewUsingFinalOutputUrl: true,
            mockOutputGenerated: renderMode === "mock",
            localOutputGenerated: renderMode === "local",
            productionAiCalled: false,
          });
        }
        const out = await ensureReplicate().run("black-forest-labs/flux-schnell", { input: { prompt } });
        realAiCalled = true;
        const outUrl = resolveReplicateUrl(out);
        const outPath = path.join(SWAPS_DIR, `${jobId}-image.png`);
        await downloadToFile(outUrl, outPath);
        finalOutputUrl = `/api/swaps/${jobId}-image.png`;
        return res.json({
          renderMode,
          paidAiCalled: true,
          creditsDeducted: true,
          selectedMode,
          selectedRoute,
          selectedEngine,
          realAiCalled,
          imageUrl: finalOutputUrl,
          finalOutputUrl,
          previewUsingFinalOutputUrl: true,
          mockOutputGenerated: false,
          localOutputGenerated: false,
          productionAiCalled: true,
        });
      }

      if (selectedMode === "video_generate") {
        // Prefer POST /api/scene/generate for the full multi-engine catalog (Luma, Runway,
        // Kling, …). This branch remains for older clients that still post here with only
        // Hailuo vs Runway routing.
        if (!prompt) throw new Error("video_generate requires a prompt.");
        if (renderMode !== "production") {
          const outPath = path.join(VIDEOS_DIR, `${jobId}-video-generate.mp4`);
          const durationSec = Math.max(3, Number(req.body?.duration ?? 6));
          const bin = resolveFfmpegBin(ffmpegPath);
          if (inputImagePath) {
            await execFileAsync(bin, [
              "-y",
              "-loop", "1",
              "-i", inputImagePath,
              "-t", String(durationSec),
              "-vf", `${MOCK_VISIBLE_FILTER},scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2`,
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-crf", "23",
              "-pix_fmt", "yuv420p",
              "-movflags", "+faststart",
              outPath,
            ]);
          } else {
            await execFileAsync(bin, [
              "-y",
              "-f", "lavfi",
              "-i", `testsrc=size=1280x720:rate=30:duration=${durationSec}`,
              "-vf", MOCK_VISIBLE_FILTER,
              "-c:v", "libx264",
              "-preset", "ultrafast",
              "-crf", "23",
              "-pix_fmt", "yuv420p",
              "-movflags", "+faststart",
              outPath,
            ]);
          }
          await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
          finalOutputUrl = `/api/videos-files/${jobId}-video-generate.mp4`;
          return res.json({
            renderMode,
            paidAiCalled: false,
            creditsDeducted: false,
            selectedMode,
            selectedRoute,
            selectedEngine: "ffmpeg-video-generate-test",
            engineLabel: "Local test render (FFmpeg)",
            videoUrl: finalOutputUrl,
            outputUrl: finalOutputUrl,
            thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
            finalOutputUrl,
            previewUsingFinalOutputUrl: true,
            mockOutputGenerated: renderMode === "mock",
            localOutputGenerated: renderMode === "local",
            productionAiCalled: false,
          });
        }
        const sceneEngineRaw = String(req.body?.engine ?? req.body?.sceneEngine ?? "").trim().toLowerCase();
        const useHailuo = sceneEngineRaw === "hailuo-02" || sceneEngineRaw === "hailuo";

        prodPipelineLog("video_generate_production", {
          sceneEngineRaw: sceneEngineRaw || "(default runway)",
          useHailuo,
          durationSec: Number(req.body?.duration ?? 5),
          aspectRatio: String(req.body?.aspectRatio ?? "16:9"),
          hasStartImage: Boolean(inputImagePath),
        });

        const outPathFinal = path.join(VIDEOS_DIR, `${jobId}-video-generate.mp4`);
        let engineLabelUsed: string;

        if (useHailuo) {
          selectedEngine = "minimax/hailuo-02";
          const imageRef = inputImagePath
            ? await uploadLocalFileToReplicate(ensureReplicate(), inputImagePath, `${jobId}-first-frame.png`)
            : undefined;
          const out = await ensureReplicate().run("minimax/hailuo-02", {
            input: {
              prompt: `${prompt}\n${CHARACTER_LOCK_INSTRUCTION}`,
              duration: Number(req.body?.duration ?? 6),
              resolution: "768p",
              ...(imageRef ? { first_frame_image: imageRef } : {}),
            },
          });
          realAiCalled = true;
          const outUrl = resolveReplicateUrl(out);
          await downloadToFile(outUrl, outPathFinal);
          engineLabelUsed = "Hailuo 02";
        } else {
          selectedEngine = "runwayml/gen-4.5";
          const client = ensureReplicate();
          const imageUri = inputImagePath
            ? await uploadLocalFileToReplicate(client, inputImagePath, `${jobId}-first-frame.png`)
            : undefined;

          const runwayStyle = String(req.body?.sceneStyle ?? req.body?.style ?? "").trim();
          const { output, input: runwayBuilt } = await generateRunwayVideoFromOptions({
            prompt: `${prompt}`,
            durationSeconds: Number(req.body?.duration ?? 5),
            aspectRatio: String(req.body?.aspectRatio ?? "16:9"),
            style: runwayStyle || undefined,
            imageReferenceUrl: imageUri,
          });
          prodPipelineLog("video_generate_runway_replicate_input", { replicateInput: runwayBuilt });
          realAiCalled = true;
          const runwayUrl = resolveRunwayVideoOutput(output);
          await downloadToFile(runwayUrl, outPathFinal);
          engineLabelUsed = "Runway Gen-4.5";
        }

        await makeThumbnail(outPathFinal, path.join(THUMBS_DIR, `${jobId}.jpg`));
        finalOutputUrl = `/api/videos-files/${jobId}-video-generate.mp4`;
        prodPipelineLog("video_generate_complete", {
          finalOutputPathDisk: outPathFinal,
          engineLabelUsed,
        });

        return res.json({
          renderMode,
          paidAiCalled: true,
          creditsDeducted: true,
          selectedMode,
          selectedRoute,
          selectedEngine,
          engineLabel: engineLabelUsed,
          realAiCalled,
          videoUrl: finalOutputUrl,
          outputUrl: finalOutputUrl,
          thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
          finalOutputUrl,
          previewUsingFinalOutputUrl: true,
          mockOutputGenerated: false,
          localOutputGenerated: false,
          productionAiCalled: true,
        });
      }

      if (selectedMode === "audio_cleanup") {
        if (!inputVideoPath) {
          throw new Error("audio_cleanup requires inputVideoUrl.");
        }
        selectedEngine = "ffmpeg-audio-cleanup";
        const outPath = path.join(VIDEOS_DIR, `${jobId}-audio-cleanup.mp4`);
        const bin = resolveFfmpegBin(ffmpegPath);
        await execFileAsync(bin, [
          "-y",
          "-i", inputVideoPath,
          "-c:v", "copy",
          "-af", "highpass=f=80,lowpass=f=12000,loudnorm",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          outPath,
        ]);
        await makeThumbnail(outPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
        finalOutputUrl = `/api/videos-files/${jobId}-audio-cleanup.mp4`;
        return res.json({
          renderMode,
          paidAiCalled: false,
          creditsDeducted: false,
          selectedMode,
          selectedRoute,
          selectedEngine,
          videoUrl: finalOutputUrl,
          outputUrl: finalOutputUrl,
          thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
          finalOutputUrl,
          previewUsingFinalOutputUrl: true,
          mockOutputGenerated: renderMode === "mock",
          localOutputGenerated: renderMode === "local",
          productionAiCalled: false,
        });
      }

      if (!inputVideoPath) {
        throw new Error("A video input is required for this production mode.");
      }

      const originalVideoPath = inputVideoPath;
      let generatedVideoPath: string | null = null;
      let maskedEditedVideoPath: string | null = null;
      let colorGradedVideoPath: string | null = null;
      let currentVideoPath = originalVideoPath;

      let parsedProductionState: unknown = null;
      try {
        const rawPs = req.body?.productionState;
        if (typeof rawPs === "string" && rawPs.trim()) parsedProductionState = JSON.parse(rawPs) as unknown;
        else if (rawPs != null && typeof rawPs === "object") parsedProductionState = rawPs;
      } catch {
        parsedProductionState = { note: "productionState JSON parse failed" };
      }

      prodPipelineLog("unified_pipeline_start", {
        selectedMode,
        productionState: parsedProductionState,
        selectedObject: selectedObject || null,
        requestedEditPreview: String(req.body?.requestedEdit ?? "").slice(0, 200),
        originalVideoPath,
        promptPreview: prompt.slice(0, 240),
      });

      if (selectedMode === "background_replace" || selectedMode === "full_production") {
        selectedEngine = renderMode === "production" ? "luma/modify-video" : "ffmpeg-background-test";
        backgroundReplaceActive = true;
        faceLockActive = lockFace;
        if (renderMode === "production") {
          const inputPublicUrl =
            domain && uploadedVideo?.relativeUrl
              ? `https://${domain}${uploadedVideo.relativeUrl}`
              : await uploadLocalFileToReplicate(ensureReplicate(), inputVideoPath, `${jobId}-input.mp4`);
          const referenceHint = referencePath
            ? ` Match style from this reference asset: ${await uploadLocalFileToReplicate(ensureReplicate(), referencePath, `${jobId}-reference`)}`
            : "";
          const bgPrompt = (prompt || "Replace background while preserving character exactly.") + referenceHint;
          const out = await ensureReplicate().run("luma/modify-video", {
            input: {
              video: inputPublicUrl,
              prompt: `${CHARACTER_LOCK_INSTRUCTION}\nBackground replacement request: ${bgPrompt}`,
              mode: "flex_1",
            },
          });
          realAiCalled = true;
          const outUrl = resolveReplicateUrl(out);
          const bgPath = path.join(VIDEOS_DIR, `${jobId}-bg.mp4`);
          await downloadToFile(outUrl, bgPath);
          currentVideoPath = bgPath;
          generatedVideoPath = bgPath;
          prodPipelineLog("step_ai_background_complete", {
            outputPath: bgPath,
            currentVideoPath,
          });

          if (lockFace) {
            selectedEngine = "arabyai-replicate/roop_face_swap";
            const faceFramePath = path.join(UPLOADS_DIR, `${jobId}-face.jpg`);
            await extractFaceFrame(inputVideoPath, faceFramePath);
            const client = ensureReplicate();
            const targetVideoUrl = await uploadLocalFileToReplicate(client, currentVideoPath, `${jobId}-bg.mp4`);
            const faceImageUrl = await uploadLocalFileToReplicate(client, faceFramePath, `${jobId}-face.jpg`);
            const swapped = await client.run("arabyai-replicate/roop_face_swap", {
              input: {
                swap_image: faceImageUrl,
                target_video: targetVideoUrl,
              },
            });
            realAiCalled = true;
            const swappedUrl = resolveReplicateUrl(swapped);
            const faceLockedPath = path.join(VIDEOS_DIR, `${jobId}-face-locked.mp4`);
            await downloadToFile(swappedUrl, faceLockedPath);
            currentVideoPath = faceLockedPath;
            generatedVideoPath = faceLockedPath;
            prodPipelineLog("step_face_swap_after_bg_complete", { outputPath: faceLockedPath, currentVideoPath });
          }
        } else {
          const bgPath = path.join(VIDEOS_DIR, `${jobId}-bg.mp4`);
          await applyVisibleTestRender(
            currentVideoPath,
            bgPath,
            renderMode === "mock"
              ? {
                  maxInputSeconds: getMockEncodeMaxSeconds(),
                  timeoutMs: getMockRenderTimeoutMs(),
                  applyMockColorFilter: true,
                }
              : { applyMockColorFilter: false },
          );
          currentVideoPath = bgPath;
          generatedVideoPath = bgPath;
          prodPipelineLog("step_mock_local_background_complete", { outputPath: bgPath });
        }
      }

      if (selectedMode === "object_edit" || selectedMode === "full_production") {
        const requestedEditTrim = String(req.body?.requestedEdit ?? "").trim();
        const editInstruction =
          selectedMode === "object_edit" ? (requestedEditTrim || prompt).trim() : requestedEditTrim;
        const runObjectStep =
          selectedMode === "object_edit" ||
          (selectedMode === "full_production" &&
            (Boolean(selectedObject) || (Number.isFinite(objectX) && Number.isFinite(objectY))));

        if (runObjectStep) {
          prodPipelineLog("step_enter_object_edit", {
            currentVideoPathBeforeStep: currentVideoPath,
            selectedObject: selectedObject || null,
            editInstruction: editInstruction.slice(0, 200),
            segmentTrackJobId: segmentTrackJobId || null,
          });
          let ox = objectX;
          let oy = objectY;
          if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
            if (selectedObject || editInstruction) {
              ox = 0.5;
              oy = 0.55;
            }
          }
          if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
            throw new Error(
              "Object edit requires click coordinates (objectX/objectY) or an object label / edit prompt for center masking.",
            );
          }
          if (selectedMode === "object_edit" && !editInstruction) {
            throw new Error('Object edit requires an edit instruction (e.g. "change wall to white").');
          }
          if (selectedMode === "full_production" && !editInstruction) {
            throw new Error(
              'Object edit step requires requestedEdit (e.g. "make car red") so background prompts are not applied to the mask.',
            );
          }

          objectEditActive = true;
          selectedEngine = sam2MaskEngineRequested()
            ? "ffmpeg-targeted-mask-composite-sam2"
            : "ffmpeg-targeted-mask-composite";

          if (sam2MaskEngineRequested()) {
            if (!segmentTrackJobId) {
              throw new Error(
                "OBJECT_MASK_ENGINE=SAM2 requires segmentTrackJobId from POST /api/ai/segment-track after clicking the object.",
              );
            }
            const segJob = getSegmentTrackJob(segmentTrackJobId);
            if (!segJob) {
              throw new Error("Invalid or expired segmentTrackJobId. Run segment-track again before rendering.");
            }
          }

          const objectPath = path.join(VIDEOS_DIR, `${jobId}-object.mp4`);
          targetedObjectEditMeta = await runTargetedObjectEdit({
            inputPath: currentVideoPath,
            outputPath: objectPath,
            objectX: ox,
            objectY: oy,
            editPrompt: editInstruction,
            selectedObject: selectedObject || undefined,
            maskRadiusFrac,
            segmentTrackJobId: segmentTrackJobId || undefined,
          });
          currentVideoPath = objectPath;
          maskedEditedVideoPath = objectPath;
          prodPipelineLog("step_masked_object_edit_complete", { outputPath: objectPath, clip: currentVideoPath });
        }
      }

      let kontextColorUrl: string | null = null;
      const runFluxKontext =
        realAiRequested && (selectedMode === "color_grade" || selectedMode === "full_production");
      if (runFluxKontext) {
        const falConfigured = isFalConfigured();
        console.log(
          `[production] evaluating color grade branch (mode=${selectedMode}, renderMode=${renderMode}, falConfigured=${falConfigured})`,
        );
        colorGradeActive = true;
        const kontextPrompt = colorPrompt || DEFAULT_COLOR_INSTRUCTION;
        prodPipelineLog("step_enter_color_grade", { currentVideoPathBeforeStep: currentVideoPath });
        if (!falConfigured) {
          console.log("[production] skipping Flux Kontext: FAL_KEY is missing.");
          throw new Error("Flux Kontext color grade requires FAL_KEY.");
        }
        selectedEngine = "flux-kontext";
        realAiCalled = true;
        console.log("[production] calling applyFluxKontextColor ...");
        kontextColorUrl = await applyFluxKontextColor({
          videoPath: currentVideoPath,
          prompt: kontextPrompt,
          jobId: `${jobId}-kontext`,
        });
        console.log("[production] applyFluxKontextColor completed — skipping FFmpeg color polish (passthrough).");
        prodPipelineLog("step_color_grade_complete", { kontextColorUrl, ffmpegPolish: false });
      } else {
        console.log(`[production] color grade branch skipped (mode=${selectedMode}) — FFmpeg passthrough, no yellow filter.`);
        if (selectedMode === "color_grade") {
          selectedEngine = "ffmpeg-passthrough";
          colorGradeActive = false;
        }
      }

      prodPipelineLog("pre_final_export", {
        originalVideoPath,
        generatedVideoPath,
        maskedEditedVideoPath,
        colorGradedVideoPath,
        finalOutputPath: currentVideoPath,
      });
      await makeThumbnail(currentVideoPath, path.join(THUMBS_DIR, `${jobId}.jpg`));
      const outFileName = path.basename(currentVideoPath);
      finalOutputUrl = `/api/videos-files/${outFileName}`;

      return res.json({
        renderMode,
        paidAiCalled,
        creditsDeducted,
        selectedMode,
        selectedRoute,
        selectedEngine,
        selectedObject: selectedObject || undefined,
        colorPromptApplied: colorPrompt || DEFAULT_COLOR_INSTRUCTION,
        colorGradeImageUrl: kontextColorUrl,
        videoUrl: finalOutputUrl,
        outputUrl: finalOutputUrl,
        thumbnailUrl: `/api/thumbs/${jobId}.jpg`,
        finalOutputUrl,
        previewUsingFinalOutputUrl: Boolean(finalOutputUrl),
        mockOutputGenerated: renderMode === "mock",
        localOutputGenerated: renderMode === "local",
        productionAiCalled: renderMode === "production" && paidAiCalled,
        demoMode,
        realAiCalled,
        targetedObjectEdit: targetedObjectEditMeta,
        targetedMaskEngineStatus: getPublicTargetedMaskStatus(),
        renderProof: {
          selectedMode,
          selectedRoute,
          selectedEngine,
          demoMode,
          realAiCalled,
          inputVideoUrlPresent,
          inputImageUrlPresent,
          faceLockActive,
          backgroundReplaceActive,
          objectEditActive,
          colorGradeActive,
          finalOutputUrlPresent: Boolean(finalOutputUrl),
          errorMessage: "",
          pipelinePaths: {
            originalVideoPath,
            generatedVideoPath,
            maskedEditedVideoPath,
            colorGradedVideoPath,
            finalOutputPath: currentVideoPath,
          },
        },
      });
    } catch (err: any) {
      errorMessage = err?.message ?? "Production render failed";
      const debugProof =
        selectedMode === "locked_reference_color_match"
          ? {
              mode: "locked_reference_color_match",
              targetVideoUrl: String(req.body?.targetVideoUrl ?? req.body?.inputVideoUrl ?? "").trim() ? "present" : "missing",
              referenceVideoUrl: String(req.body?.referenceVideoUrl ?? "").trim() ? "present" : "missing",
              referenceImageUrl: String(req.body?.referenceImageUrl ?? "").trim() ? "present" : "missing",
              progressPercent: 0,
              currentStep: "error",
              analyzeReferenceComplete: false,
              colorTransferComplete: false,
              encodeComplete: false,
              regenerationUsed: false,
              fullAiGenerationUsed: false,
              referenceUsedForContent: false,
              referenceUsedForColorOnly: true,
              framesReplaced: false,
              identityChanged: false,
              audioPreserved: true,
              durationPreserved: true,
              resolutionPreserved: true,
              colorMatchStrength: clamp(Number(req.body?.colorMatchStrength ?? 0.85), 0.05, 1.5),
              outputVideoUrl: finalOutputUrl ? "present" : "missing",
              error: errorMessage,
            }
          : undefined;
      return res.status(500).json({
        error: errorMessage,
        renderMode,
        paidAiCalled,
        creditsDeducted,
        selectedMode,
        selectedRoute,
        selectedEngine,
        finalOutputUrl,
        previewUsingFinalOutputUrl: false,
        mockOutputGenerated: false,
        localOutputGenerated: false,
        productionAiCalled: renderMode === "production" && paidAiCalled,
        demoMode,
        realAiCalled,
        debugProof,
        renderProof: {
          selectedMode,
          selectedRoute,
          selectedEngine,
          demoMode,
          realAiCalled,
          inputVideoUrlPresent,
          inputImageUrlPresent,
          faceLockActive,
          backgroundReplaceActive,
          objectEditActive,
          colorGradeActive,
          finalOutputUrlPresent: Boolean(finalOutputUrl),
          errorMessage,
        },
      });
    }
  },
);

export default router;
