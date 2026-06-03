import fetch from "node-fetch";
import { isBaselineMode } from "./baseline-mode";

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-pro/kontext";

export function resolveFalKey(): string | undefined {
  const key = process.env.FAL_KEY ?? process.env.FAL_AI_KEY;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

export function isFalConfigured(opts?: { ignoreBaseline?: boolean }): boolean {
  if (!opts?.ignoreBaseline && isBaselineMode()) return false;
  return Boolean(resolveFalKey());
}

export type FalKontextResult = {
  imageUrl: string;
  prompt: string;
  seed?: number | null;
  raw: unknown;
};

type RunFalKontextOpts = {
  prompt: string;
  imageUrl: string;
  guidanceScale?: number;
  numImages?: number;
  outputFormat?: "jpeg" | "png";
  safetyTolerance?: "1" | "2" | "3" | "4" | "5" | "6";
  enhancePrompt?: boolean;
  ignoreBaseline?: boolean;
};

export async function runFalKontextEdit(opts: RunFalKontextOpts): Promise<FalKontextResult> {
  if (!opts.ignoreBaseline && isBaselineMode()) {
    throw new Error("Flux Kontext is disabled in baseline mode.");
  }
  const key = resolveFalKey();
  if (!key) {
    throw new Error("FAL_KEY is not configured. Set FAL_KEY or FAL_AI_KEY in .env.local to use Flux Kontext. Example: FAL_KEY=your-fal-api-key");
  }

  const body = {
    prompt: opts.prompt,
    image_url: opts.imageUrl,
    guidance_scale: opts.guidanceScale ?? 3.5,
    num_images: opts.numImages ?? 1,
    output_format: opts.outputFormat ?? "jpeg",
    safety_tolerance: opts.safetyTolerance ?? "2",
    enhance_prompt: opts.enhancePrompt ?? false,
  };

  const response = await fetch(FAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Flux Kontext API error (${response.status})`);
  }

  const data = await response.json();
  const imageUrl = Array.isArray(data?.images) && data.images.length > 0 ? data.images[0]?.url : undefined;

  if (!imageUrl) {
    throw new Error("Flux Kontext returned no image URL");
  }

  return {
    imageUrl,
    prompt: opts.prompt,
    seed: data?.seed ?? null,
    raw: data,
  };
}
