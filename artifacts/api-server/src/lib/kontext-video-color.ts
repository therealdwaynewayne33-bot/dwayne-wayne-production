import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";
import { fal } from "@fal-ai/client";
import { resolveFfmpegBin, ffmpegVideoPassthrough } from "./ffmpeg";
import { runFalKontextEdit, resolveFalKey } from "./fal-kontext";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const KONTEXT_CINEMATIC_PROMPT =
  "Professional cinematic color grade. Warm golden highlights, teal shadows, balanced midtones, film-like contrast, natural skin tones. Preserve all subjects, motion, and composition exactly. Only adjust color and tone.";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);

type FrameStats = {
  r: number;
  g: number;
  b: number;
  luminance: number;
  contrast: number;
  saturation: number;
  shadow: number;
  highlight: number;
  lab: { l: number; a: number; b: number; lStd: number; aStd: number; bStd: number };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / 0.95047);
  const fy = f(y);
  const fz = f(z / 1.08883);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

async function analyzeFrame(imagePath: string): Promise<FrameStats> {
  const ppmPath = `${imagePath}.ppm`;
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-i", imagePath, "-f", "image2", "-vcodec", "ppm", ppmPath]);
  const buf = await readFile(ppmPath);

  let idx = 0;
  let newlines = 0;
  while (idx < buf.length && newlines < 3) {
    if (buf[idx] === 0x0a) newlines++;
    idx++;
  }

  const pixels: Array<{ r: number; g: number; b: number; lum: number; sat: number; labL: number; labA: number; labB: number }> = [];
  for (let i = idx; i + 2 < buf.length; i += 3) {
    const r = buf[i]!;
    const g = buf[i + 1]!;
    const b = buf[i + 2]!;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lab = rgbToLab(r, g, b);
    pixels.push({ r, g, b, lum, sat, labL: lab.l, labA: lab.a, labB: lab.b });
  }

  const count = Math.max(1, pixels.length);
  const avg = pixels.reduce(
    (acc, p) => {
      acc.r += p.r;
      acc.g += p.g;
      acc.b += p.b;
      acc.luminance += p.lum;
      acc.saturation += p.sat;
      acc.shadow += p.lum < 64 ? p.lum : 0;
      acc.highlight += p.lum > 192 ? p.lum : 0;
      acc.lab.l += p.labL;
      acc.lab.a += p.labA;
      acc.lab.b += p.labB;
      return acc;
    },
    { r: 0, g: 0, b: 0, luminance: 0, saturation: 0, shadow: 0, highlight: 0, lab: { l: 0, a: 0, b: 0 } },
  );

  const labSamples = pixels.map((p) => p.labL);
  const labMean = labSamples.reduce((s, v) => s + v, 0) / count;
  const labStd = Math.sqrt(labSamples.reduce((s, v) => s + (v - labMean) ** 2, 0) / count);
  const aSamples = pixels.map((p) => p.labA);
  const aMean = aSamples.reduce((s, v) => s + v, 0) / count;
  const aStd = Math.sqrt(aSamples.reduce((s, v) => s + (v - aMean) ** 2, 0) / count);
  const bSamples = pixels.map((p) => p.labB);
  const bMean = bSamples.reduce((s, v) => s + v, 0) / count;
  const bStd = Math.sqrt(bSamples.reduce((s, v) => s + (v - bMean) ** 2, 0) / count);

  return {
    r: avg.r / count,
    g: avg.g / count,
    b: avg.b / count,
    luminance: avg.luminance / count,
    contrast: labStd,
    saturation: avg.saturation / count,
    shadow: avg.shadow / count,
    highlight: avg.highlight / count,
    lab: { l: avg.lab.l / count, a: avg.lab.a / count, b: avg.lab.b / count, lStd: labStd, aStd: aStd, bStd: bStd },
  };
}

/** Build ffmpeg filter from Kontext graded still vs source frame — not a hardcoded yellow preset. */
function buildKontextReferenceFilter(target: FrameStats, reference: FrameStats): string {
  const deltaL = reference.lab.l - target.lab.l;
  const deltaA = reference.lab.a - target.lab.a;
  const brightness = clamp((deltaL / 100) * 0.22, -0.09, 0.11);
  const contrast = clamp(reference.lab.lStd / Math.max(0.1, target.lab.lStd), 0.92, 1.22);
  const saturation = clamp(reference.saturation / Math.max(0.01, target.saturation), 0.62, 1.2);
  const gamma = clamp(1 + ((reference.shadow - target.shadow) / 255) * 0.25, 0.92, 1.16);
  const yellowGap = target.lab.b - reference.lab.b;
  const wbBlueBoost = clamp((yellowGap / 100) * 0.26, -0.14, 0.18);
  const wbRedCut = clamp((-deltaA / 128) * 0.18 - wbBlueBoost * 0.55, -0.14, 0.14);
  const wbGreenCut = clamp((-(reference.lab.b - target.lab.b) / 128) * 0.13 - wbBlueBoost * 0.45, -0.14, 0.14);
  const midCurve = clamp(0.5 + (deltaL / 100) * 0.2, 0.4, 0.66).toFixed(2);
  const highCurve = clamp(0.84 + ((reference.highlight - target.highlight) / 255) * 0.16, 0.76, 0.96).toFixed(2);
  const lowCurve = clamp(0.18 + ((reference.shadow - target.shadow) / 255) * 0.15, 0.08, 0.3).toFixed(2);

  return [
    `eq=contrast=${contrast.toFixed(3)}:brightness=${brightness.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${gamma.toFixed(3)}`,
    `colorbalance=rs=${wbRedCut.toFixed(3)}:gs=${wbGreenCut.toFixed(3)}:bs=${wbBlueBoost.toFixed(3)}`,
    `curves=all='0/0 ${lowCurve}/0.22 0.50/${midCurve} 0.82/${highCurve} 1/1'`,
    "format=yuv420p",
  ].join(",");
}

async function uploadBufferToFalStorage(buffer: Buffer, mimeType: string): Promise<string> {
  const key = resolveFalKey();
  if (!key) {
    throw new Error("Flux Kontext requires FAL_KEY. Add FAL_KEY to .env.local and restart the API server.");
  }
  fal.config({ credentials: key });
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  const uploadResult = await fal.storage.upload(blob);
  const url =
    (uploadResult as { url?: string }).url ??
    (uploadResult as { data?: { url?: string } }).data?.url ??
    (uploadResult as { upload?: { url?: string } }).upload?.url;
  if (!url) throw new Error("Fal storage upload returned no URL.");
  return url;
}

async function captureFrame(videoPath: string, framePath: string) {
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, [
    "-y",
    "-ss",
    "0.5",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=1280:-1:flags=lanczos",
    "-q:v",
    "2",
    framePath,
  ]);
}

async function downloadToFile(url: string, destPath: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download Kontext result: ${resp.status}`);
  await writeFile(destPath, Buffer.from(await resp.arrayBuffer()));
}

async function makeThumbnail(videoPath: string, outPath: string) {
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, ["-y", "-i", videoPath, "-ss", "0.5", "-frames:v", "1", "-q:v", "3", outPath]);
}

async function applyKontextDerivedFilter(inputVideo: string, filter: string, outputVideo: string) {
  const bin = resolveFfmpegBin(ffmpegPath);
  await execFileAsync(bin, [
    "-y",
    "-i",
    inputVideo,
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputVideo,
  ]);
}

export type KontextVideoColorResult = {
  videoUrl: string;
  thumbnailUrl: string;
  kontextColorUrl: string;
  selectedEngine: "flux-kontext";
  realAiCalled: true;
  colorGradeActive: true;
};

export async function gradeUploadedVideoWithKontext(opts: {
  videoBuffer: Buffer;
  originalName: string;
  jobId: string;
  uploadsDir?: string;
  videosDir?: string;
  thumbsDir?: string;
}): Promise<KontextVideoColorResult> {
  if (!resolveFalKey()) {
    throw new Error("Flux Kontext requires FAL_KEY. Add FAL_KEY to .env.local and restart the API server.");
  }

  const uploadsDir = opts.uploadsDir ?? path.join(__dirname, "../public/uploads");
  const videosDir = opts.videosDir ?? path.join(__dirname, "../public/videos");
  const thumbsDir = opts.thumbsDir ?? path.join(__dirname, "../public/thumbs");
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(videosDir, { recursive: true });
  await mkdir(thumbsDir, { recursive: true });

  const rawExt = "." + (opts.originalName.split(".").pop() ?? "mp4").toLowerCase();
  const safeExt = VIDEO_EXTS.has(rawExt) ? rawExt : ".mp4";
  const rawPath = path.join(uploadsDir, `${opts.jobId}-raw${safeExt}`);
  const normalizedPath = path.join(uploadsDir, `${opts.jobId}-src.mp4`);
  const sourceFramePath = path.join(uploadsDir, `${opts.jobId}-source-frame.jpg`);
  const gradedStillPath = path.join(uploadsDir, `${opts.jobId}-kontext-grade.jpg`);
  const outputVideoPath = path.join(videosDir, `${opts.jobId}-kontext-colored.mp4`);
  const thumbPath = path.join(thumbsDir, `${opts.jobId}.jpg`);

  await writeFile(rawPath, opts.videoBuffer);
  await ffmpegVideoPassthrough(rawPath, normalizedPath);
  await captureFrame(normalizedPath, sourceFramePath);

  const videoBuffer = await readFile(normalizedPath);
  await uploadBufferToFalStorage(videoBuffer, "video/mp4");

  const frameBuffer = await readFile(sourceFramePath);
  const frameUploadUrl = await uploadBufferToFalStorage(frameBuffer, "image/jpeg");

  const kontextResult = await runFalKontextEdit({
    prompt: KONTEXT_CINEMATIC_PROMPT,
    imageUrl: frameUploadUrl,
    guidanceScale: 4.5,
    outputFormat: "jpeg",
    ignoreBaseline: true,
  });

  await downloadToFile(kontextResult.imageUrl, gradedStillPath);

  const sourceStats = await analyzeFrame(sourceFramePath);
  const gradedStats = await analyzeFrame(gradedStillPath);
  const derivedFilter = buildKontextReferenceFilter(sourceStats, gradedStats);
  await applyKontextDerivedFilter(normalizedPath, derivedFilter, outputVideoPath);
  await makeThumbnail(outputVideoPath, thumbPath);

  return {
    videoUrl: `/api/videos-files/${opts.jobId}-kontext-colored.mp4`,
    thumbnailUrl: `/api/thumbs/${opts.jobId}.jpg`,
    kontextColorUrl: `/api/uploads/${opts.jobId}-kontext-grade.jpg`,
    selectedEngine: "flux-kontext",
    realAiCalled: true,
    colorGradeActive: true,
  };
}
