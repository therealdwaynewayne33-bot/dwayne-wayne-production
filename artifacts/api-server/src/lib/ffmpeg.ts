import { existsSync } from "fs";
import { copyFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

let installerPath: string | null = null;
try {
  const mod = require("@ffmpeg-installer/ffmpeg") as { path?: unknown };
  if (typeof mod.path === "string" && mod.path.trim()) {
    installerPath = mod.path;
  }
} catch {
  // Fallback to ffmpeg-static or PATH if optional package is unavailable.
}

export function resolveFfmpegBin(staticPath: string | null | undefined): string {
  if (typeof staticPath === "string" && staticPath.trim() && existsSync(staticPath)) {
    return staticPath;
  }
  if (typeof installerPath === "string" && installerPath.trim() && existsSync(installerPath)) {
    return installerPath;
  }
  return "ffmpeg";
}

/** Copy or re-encode video without any -vf filter — no color grading. */
export async function ffmpegVideoPassthrough(
  inputPath: string,
  outputPath: string,
  opts?: { maxInputSeconds?: number },
): Promise<void> {
  const bin = resolveFfmpegBin(ffmpegPath);
  const durationArgs =
    opts?.maxInputSeconds != null && opts.maxInputSeconds > 0
      ? (["-t", String(opts.maxInputSeconds)] as const)
      : ([] as const);

  try {
    await execFileAsync(bin, [
      "-y",
      ...durationArgs,
      "-i",
      inputPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return;
  } catch {
    // Container/codec mismatch — re-encode without filters so colors are not deliberately shifted.
    await execFileAsync(bin, [
      "-y",
      ...durationArgs,
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ]).catch(async () => {
      await copyFile(inputPath, outputPath);
    });
  }
}
