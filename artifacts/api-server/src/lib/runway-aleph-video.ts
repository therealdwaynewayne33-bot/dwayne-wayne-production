/**
 * Runway Gen-4 Aleph video-to-video styling via Replicate (`runwayml/gen4-aleph`).
 * Uses REPLICATE_API_TOKEN from the environment.
 */
import { readFile, writeFile, stat, copyFile } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import Replicate from "replicate";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { resolveFfmpegBin } from "./ffmpeg";
import { resolvePublicDomain } from "./public-domain";

const execFileAsync = promisify(execFile);

export const RUNWAY_ALEPH_MODEL = "runwayml/gen4-aleph" as const;

/** Aleph accepts videos under 16MB; we trim to 9s to match the bg-replace pipeline. */
export const RUNWAY_ALEPH_MAX_INPUT_SECONDS = 9;
export const RUNWAY_ALEPH_MAX_BYTES = 16 * 1024 * 1024;
/** Replicate inline data-uri limit; used when no public HTTPS domain is configured. */
export const RUNWAY_ALEPH_DATA_URI_MAX_BYTES = 9_500_000;

export type CinematicStylePresetId = "luma_dream" | "hollywood_blockbuster" | "film_noir_moody";

export type CinematicStylePreset = {
  id: CinematicStylePresetId;
  label: string;
  description: string;
  prompt: string;
};

export const CINEMATIC_STYLE_PRESETS: Record<CinematicStylePresetId, CinematicStylePreset> = {
  luma_dream: {
    id: "luma_dream",
    label: "Luma Dream",
    description: "Soft golden warmth, lifted shadows, dreamy filmic feel",
    prompt:
      "Transform this video into a dreamy cinematic film look. Soft warm golden lighting, lifted blacks, slight film grain, shallow depth of field, anamorphic lens flare. Keep the person's face, clothing, and all movement exactly the same. Only change lighting, color, and atmosphere to feel like Luma Dream Machine cinematic style.",
  },
  hollywood_blockbuster: {
    id: "hollywood_blockbuster",
    label: "Hollywood Blockbuster",
    description: "Teal and orange blockbuster grade with dramatic contrast",
    prompt:
      "Transform this video into a Hollywood blockbuster film look. Teal and orange color grade, deep contrast, cinematic lighting with dramatic shadows, 35mm film texture. Keep the person's face, clothing, and all movement exactly the same. Only change color grading and lighting mood.",
  },
  film_noir_moody: {
    id: "film_noir_moody",
    label: "Film Noir Moody",
    description: "Desaturated cool tones, deep shadows, dramatic atmosphere",
    prompt:
      "Transform this video into a moody film noir cinematic look. Desaturated cool tones, deep shadows, soft moody lighting, slight haze, 35mm film grain, dramatic atmosphere. Keep the person's face, clothing, and all movement exactly the same. Only change color, lighting, and mood.",
  },
};

export const DEFAULT_CINEMATIC_STYLE_PRESET: CinematicStylePresetId = "luma_dream";

const LEGACY_STYLE_ALIASES: Record<string, CinematicStylePresetId> = {
  luma_teal: "hollywood_blockbuster",
  luma_noir: "film_noir_moody",
  warm_cinema: "luma_dream",
  teal_orange: "hollywood_blockbuster",
  film_noir: "film_noir_moody",
};

export function isRunwayAlephConfigured(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN?.trim());
}

export function resolveCinematicStylePreset(value: unknown): CinematicStylePreset {
  const raw = String(value ?? DEFAULT_CINEMATIC_STYLE_PRESET).trim().toLowerCase();
  const resolvedId = (raw in CINEMATIC_STYLE_PRESETS
    ? raw
    : LEGACY_STYLE_ALIASES[raw] ?? raw) as CinematicStylePresetId;
  if (resolvedId in CINEMATIC_STYLE_PRESETS) {
    return CINEMATIC_STYLE_PRESETS[resolvedId];
  }
  return CINEMATIC_STYLE_PRESETS[DEFAULT_CINEMATIC_STYLE_PRESET];
}

export function resolveRunwayAlephPrompt(opts: {
  presetId?: unknown;
  customPrompt?: unknown;
}): { preset: CinematicStylePreset; prompt: string; usedCustomPrompt: boolean } {
  const custom = String(opts.customPrompt ?? "").trim();
  if (custom) {
    const preset = resolveCinematicStylePreset(opts.presetId);
    return { preset, prompt: custom, usedCustomPrompt: true };
  }
  const preset = resolveCinematicStylePreset(opts.presetId);
  return { preset, prompt: preset.prompt, usedCustomPrompt: false };
}

export type RunwayAlephAspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9";

const PIXEL_ASPECT_TO_ALEPH: Record<string, RunwayAlephAspectRatio> = {
  "1280:720": "16:9",
  "720:1280": "9:16",
  "1104:832": "4:3",
  "832:1104": "3:4",
  "960:960": "1:1",
  "1584:672": "21:9",
};

export async function detectRunwayAlephAspectRatio(videoPath: string): Promise<RunwayAlephAspectRatio> {
  const ffprobeBin = ffprobeStatic?.path || "ffprobe";
  const { stdout } = await execFileAsync(ffprobeBin, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    videoPath,
  ]);
  const [wRaw, hRaw] = stdout.trim().split("x");
  const width = parseInt(wRaw ?? "1280", 10);
  const height = parseInt(hRaw ?? "720", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "16:9";
  }
  const pixelKey = `${width}:${height}`;
  if (pixelKey in PIXEL_ASPECT_TO_ALEPH) {
    return PIXEL_ASPECT_TO_ALEPH[pixelKey]!;
  }
  if (width === height) return "1:1";
  return width > height ? "16:9" : "9:16";
}

/** Trim to 9s, scale, and compress so Aleph input stays under maxBytes. */
export async function prepareVideoForRunwayAleph(
  srcPath: string,
  outPath: string,
  opts?: { maxBytes?: number },
): Promise<void> {
  const maxBytes = opts?.maxBytes ?? RUNWAY_ALEPH_MAX_BYTES;
  const bin = resolveFfmpegBin(ffmpegPath);
  const aspect = await detectRunwayAlephAspectRatio(srcPath);
  const targetW = aspect === "9:16" || aspect === "3:4" ? 720 : 1280;
  const targetH = aspect === "9:16" || aspect === "3:4" ? 1280 : 720;
  const vf = [
    `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "fps=30",
    "format=yuv420p",
    "setsar=1",
  ].join(",");

  const bitrates = ["3500k", "2500k", "1800k", "1200k"];
  let lastErr: unknown;
  for (const bitrate of bitrates) {
    try {
      await execFileAsync(bin, [
        "-y",
        "-i",
        srcPath,
        "-t",
        String(RUNWAY_ALEPH_MAX_INPUT_SECONDS),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-level",
        "4.0",
        "-preset",
        "fast",
        "-b:v",
        bitrate,
        "-maxrate",
        bitrate,
        "-bufsize",
        "7000k",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        outPath,
      ]);
      const size = (await stat(outPath)).size;
      if (size <= maxBytes) return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Could not prepare Aleph input video under ${Math.round(maxBytes / (1024 * 1024))}MB.`);
}

function resolveReplicateOutputUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof (output as { url?: () => URL }).url === "function") {
    return (output as { url: () => URL }).url().href;
  }
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === "string") return first;
    if (first && typeof (first as { url?: () => URL }).url === "function") {
      return (first as { url: () => URL }).url().href;
    }
  }
  throw new Error("Unexpected Runway Aleph output format");
}

async function downloadToFile(url: string, outPath: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download Aleph video: ${resp.status}`);
  await writeFile(outPath, Buffer.from(await resp.arrayBuffer()));
}

const EXT_TO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function mimeTypeForFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

export type AlephAssetUrlSource = "public_https" | "data_uri";

/**
 * Runway Aleph fetches video URLs directly — NOT Replicate's api.replicate.com/v1/files URLs
 * (those return JSON metadata with application/json / octet-stream, which Runway rejects).
 * Use a public HTTPS URL on our uploads static route, or a data: URI when small enough.
 */
export async function resolveAlephVideoInputUrl(opts: {
  preparedInputPath: string;
  jobId: string;
  uploadsDir: string;
}): Promise<{ url: string; source: AlephAssetUrlSource }> {
  const basename = `${opts.jobId}-aleph-input.mp4`;
  const publicDiskPath = path.join(opts.uploadsDir, basename);
  if (path.resolve(opts.preparedInputPath) !== path.resolve(publicDiskPath)) {
    await copyFile(opts.preparedInputPath, publicDiskPath);
  }

  const domain = resolvePublicDomain();
  if (domain) {
    const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return {
      url: `https://${host}/api/uploads/${basename}`,
      source: "public_https",
    };
  }

  const size = (await stat(publicDiskPath)).size;
  if (size > RUNWAY_ALEPH_DATA_URI_MAX_BYTES) {
    throw new Error(
      "Runway Aleph cannot fetch Replicate file URLs for video input. Set PUBLIC_DOMAIN in .env.local " +
        "(e.g. an ngrok URL tunneling port 3000) so your prepared clip is served as video/mp4 over HTTPS. " +
        "Without a public domain, the clip must compress under ~9.5MB for inline encoding.",
    );
  }

  const buf = await readFile(publicDiskPath);
  return {
    url: `data:video/mp4;base64,${buf.toString("base64")}`,
    source: "data_uri",
  };
}

export async function resolveAlephImageInputUrl(opts: {
  localPath: string;
  jobId: string;
  label: string;
  uploadsDir: string;
}): Promise<{ url: string; source: AlephAssetUrlSource }> {
  const ext = path.extname(opts.localPath) || ".jpg";
  const basename = `${opts.jobId}-${opts.label}${ext}`;
  const publicDiskPath = path.join(opts.uploadsDir, basename);
  await copyFile(opts.localPath, publicDiskPath);
  const mime = mimeTypeForFilename(basename);

  const domain = resolvePublicDomain();
  if (domain) {
    const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return {
      url: `https://${host}/api/uploads/${basename}`,
      source: "public_https",
    };
  }

  const buf = await readFile(publicDiskPath);
  if (buf.length > RUNWAY_ALEPH_DATA_URI_MAX_BYTES) {
    throw new Error(
      "Reference image is too large for inline encoding. Set PUBLIC_DOMAIN in .env.local for HTTPS asset URLs.",
    );
  }
  return {
    url: `data:${mime};base64,${buf.toString("base64")}`,
    source: "data_uri",
  };
}

/** @deprecated Replicate files URLs are not fetchable by Runway Aleph — use resolveAlephVideoInputUrl. */
export async function uploadMediaToReplicate(
  replicate: Replicate,
  localPath: string,
  filename: string,
  mimeType?: string,
): Promise<string> {
  const buf = await readFile(localPath);
  const type = mimeType ?? mimeTypeForFilename(filename);
  if (type === "application/octet-stream") {
    throw new Error(`Unsupported media type for Replicate upload: ${filename}`);
  }
  const file = new File([buf], filename, { type });
  const uploaded = await replicate.files.create(file, {});
  const getUrl = (uploaded as { urls?: { get?: string } })?.urls?.get;
  if (typeof getUrl !== "string" || !getUrl.startsWith("http")) {
    throw new Error("Replicate file upload returned an invalid URL.");
  }
  return getUrl;
}

export async function uploadVideoToReplicate(
  replicate: Replicate,
  localPath: string,
  filename: string,
): Promise<string> {
  return uploadMediaToReplicate(replicate, localPath, filename, "video/mp4");
}

export type RunwayAlephVideoResult = {
  outputPath: string;
  model: typeof RUNWAY_ALEPH_MODEL;
  preset: CinematicStylePreset;
  prompt: string;
  usedCustomPrompt: boolean;
  aspectRatio: RunwayAlephAspectRatio;
  seed: number;
  replicateInput: Record<string, unknown>;
  replicateOutputUrl: string;
  preparedInputPath: string;
};

export const BG_REPLACE_PRESERVE_SUFFIX =
  " Keep the person, their face, clothing and all movement exactly the same.";

export const BG_REPLACE_REFERENCE_DEFAULT_PROMPT =
  `Replace the background to match this reference image.${BG_REPLACE_PRESERVE_SUFFIX}`;

export function appendBgReplacePreserveSuffix(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return BG_REPLACE_REFERENCE_DEFAULT_PROMPT;
  if (/keep the person/i.test(trimmed)) return trimmed;
  return `${trimmed}${BG_REPLACE_PRESERVE_SUFFIX}`;
}

export type RunwayAlephEditResult = {
  outputPath: string;
  model: typeof RUNWAY_ALEPH_MODEL;
  prompt: string;
  aspectRatio: RunwayAlephAspectRatio;
  seed: number;
  referenceImageUrl?: string;
  videoInputSource?: AlephAssetUrlSource;
  replicateInput: Record<string, unknown>;
  replicateOutputUrl: string;
  preparedInputPath: string;
};

export async function applyRunwayAlephVideoEdit(opts: {
  replicate: Replicate;
  videoPath: string;
  jobId: string;
  outputPath: string;
  preparedInputPath: string;
  uploadsDir: string;
  prompt: string;
  referenceImageUrl?: string;
  seed?: number;
}): Promise<RunwayAlephEditResult> {
  const prompt = appendBgReplacePreserveSuffix(String(opts.prompt ?? ""));

  const hasPublicDomain = Boolean(resolvePublicDomain());
  await prepareVideoForRunwayAleph(opts.videoPath, opts.preparedInputPath, {
    maxBytes: hasPublicDomain ? RUNWAY_ALEPH_MAX_BYTES : RUNWAY_ALEPH_DATA_URI_MAX_BYTES,
  });
  const aspectRatio = await detectRunwayAlephAspectRatio(opts.preparedInputPath);
  const { url: videoUrl, source: videoInputSource } = await resolveAlephVideoInputUrl({
    preparedInputPath: opts.preparedInputPath,
    jobId: opts.jobId,
    uploadsDir: opts.uploadsDir,
  });
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000_000);

  const replicateInput: Record<string, unknown> = {
    video: videoUrl,
    prompt,
    aspect_ratio: aspectRatio,
    seed,
  };
  if (opts.referenceImageUrl) {
    replicateInput.reference_image = opts.referenceImageUrl;
  }

  console.log("[runway-aleph] background edit API call", {
    model: RUNWAY_ALEPH_MODEL,
    jobId: opts.jobId,
    videoInputSource,
    hasReferenceImage: Boolean(opts.referenceImageUrl),
    videoUrlPreview: videoInputSource === "data_uri" ? "[data:video/mp4;base64,...]" : videoUrl,
  });

  const output = await opts.replicate.run(RUNWAY_ALEPH_MODEL, { input: replicateInput });
  const replicateOutputUrl = resolveReplicateOutputUrl(output);

  console.log("[runway-aleph] background edit API response", {
    jobId: opts.jobId,
    outputUrl: replicateOutputUrl,
  });

  await downloadToFile(replicateOutputUrl, opts.outputPath);

  return {
    outputPath: opts.outputPath,
    model: RUNWAY_ALEPH_MODEL,
    prompt,
    aspectRatio,
    seed,
    referenceImageUrl: opts.referenceImageUrl,
    videoInputSource,
    replicateInput,
    replicateOutputUrl,
    preparedInputPath: opts.preparedInputPath,
  };
}

export async function applyRunwayAlephVideoStyle(opts: {
  replicate: Replicate;
  videoPath: string;
  jobId: string;
  outputPath: string;
  preparedInputPath: string;
  uploadsDir: string;
  presetId?: unknown;
  customPrompt?: unknown;
  seed?: number;
}): Promise<RunwayAlephVideoResult> {
  const { preset, prompt, usedCustomPrompt } = resolveRunwayAlephPrompt({
    presetId: opts.presetId,
    customPrompt: opts.customPrompt,
  });

  const hasPublicDomain = Boolean(resolvePublicDomain());
  await prepareVideoForRunwayAleph(opts.videoPath, opts.preparedInputPath, {
    maxBytes: hasPublicDomain ? RUNWAY_ALEPH_MAX_BYTES : RUNWAY_ALEPH_DATA_URI_MAX_BYTES,
  });
  const aspectRatio = await detectRunwayAlephAspectRatio(opts.preparedInputPath);
  const { url: videoUrl, source: videoInputSource } = await resolveAlephVideoInputUrl({
    preparedInputPath: opts.preparedInputPath,
    jobId: opts.jobId,
    uploadsDir: opts.uploadsDir,
  });
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000_000);

  const replicateInput: Record<string, unknown> = {
    video: videoUrl,
    prompt,
    aspect_ratio: aspectRatio,
    seed,
  };

  console.log("[runway-aleph] API call", {
    model: RUNWAY_ALEPH_MODEL,
    jobId: opts.jobId,
    presetId: preset.id,
    presetLabel: preset.label,
    usedCustomPrompt,
    videoInputSource,
    videoUrlPreview: videoInputSource === "data_uri" ? "[data:video/mp4;base64,...]" : videoUrl,
  });

  const output = await opts.replicate.run(RUNWAY_ALEPH_MODEL, { input: replicateInput });
  const replicateOutputUrl = resolveReplicateOutputUrl(output);

  console.log("[runway-aleph] API response", {
    jobId: opts.jobId,
    outputUrl: replicateOutputUrl,
  });

  await downloadToFile(replicateOutputUrl, opts.outputPath);

  return {
    outputPath: opts.outputPath,
    model: RUNWAY_ALEPH_MODEL,
    preset,
    prompt,
    usedCustomPrompt,
    aspectRatio,
    seed,
    replicateInput,
    replicateOutputUrl,
    preparedInputPath: opts.preparedInputPath,
  };
}
