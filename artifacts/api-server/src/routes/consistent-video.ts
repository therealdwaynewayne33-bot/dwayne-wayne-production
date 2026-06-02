import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

function resolvePodUrl(): string | null {
  const url = (process.env.SELFHOSTED_URL ?? "").replace(/\/$/, "");
  return url || null;
}

async function isPodReachable(): Promise<boolean> {
  const url = resolvePodUrl();
  if (!url) return false;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

router.get("/video/consistent/status", requireAuth, async (_req, res) => {
  const configured = !!resolvePodUrl();
  const reachable = configured ? await isPodReachable() : false;
  res.json({
    available: configured && reachable,
    configured,
    reachable,
    message: configured
      ? reachable
        ? "Pod is reachable"
        : "RunPod video generation is currently unavailable."
      : "RunPod video generation is currently unavailable. SELFHOSTED_URL is not configured.",
  });
});

router.post("/video/consistent", requireAuth, async (req, res) => {
  try {
    const { imageBase64, mode } = req.body;

    if (!imageBase64) {
      res.status(400).json({ error: "No character image data provided" });
      return;
    }

    const SELFHOSTED_URL = resolvePodUrl();
    if (!SELFHOSTED_URL) {
      res.status(503).json({ error: "RunPod video generation is currently unavailable.", code: "RUNPOD_UNAVAILABLE" });
      return;
    }

    if (!(await isPodReachable())) {
      res.status(503).json({ error: "RunPod video generation is currently unavailable.", code: "RUNPOD_UNAVAILABLE" });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);
    const startTime = Date.now();

    try {
      const response = await fetch(`${SELFHOSTED_URL}/api/video/consistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageBase64,
          edit_target: mode ?? "background",
        }),
        signal: controller.signal,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[ConsistentVideo] Response after ${elapsed}s (status: ${response.status})`);

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown");
        throw new Error(`Self-hosted pod returned ${response.status}: ${text}`);
      }

      const data = await response.json();
      res.json({ success: true, video: data.output_video });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("[ConsistentVideo] Error:", error);
    res.status(503).json({ error: "RunPod video generation is currently unavailable.", code: "RUNPOD_UNAVAILABLE" });
  }
});

export default router;
