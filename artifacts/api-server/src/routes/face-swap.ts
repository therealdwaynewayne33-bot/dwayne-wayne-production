import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, writeFile, readFile } from "fs/promises";
import Replicate from "replicate";
import { requireAuth } from "../middlewares/requireAuth";
import { isBaselineMode, baselineDisabledResponse } from "../lib/baseline-mode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");
const SWAPS_DIR   = path.join(__dirname, "../public/swaps");

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are accepted"));
  },
});

// POST /api/face-swap
// multipart: swapImage (the face), targetImage (the photo to put it in)
//
// TODO(credits): this route is NOT yet gated by the credit system in
// `lib/credits.ts`. Wire `chargeCredits()` / `refundCredits()` here before
// exposing it to public users, otherwise it bypasses the per-user quota.
router.post("/face-swap", requireAuth, upload.fields([
  { name: "swapImage", maxCount: 1 },
  { name: "targetImage", maxCount: 1 },
]), async (req, res) => {
  if (isBaselineMode()) {
    return res.status(503).json(baselineDisabledResponse("/face-swap"));
  }

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const swapFile   = files?.swapImage?.[0];
  const targetFile = files?.targetImage?.[0];

  if (!swapFile || !targetFile) {
    return res.status(400).json({ error: "Both swapImage and targetImage are required" });
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  const jobId = `fswap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(SWAPS_DIR,   { recursive: true });

  const domain = process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0];

  const swapPath   = path.join(UPLOADS_DIR, `${jobId}-swap.png`);
  const targetPath = path.join(UPLOADS_DIR, `${jobId}-target.png`);
  await writeFile(swapPath,   swapFile.buffer);
  await writeFile(targetPath, targetFile.buffer);

  const replicate = new Replicate({ auth: token });

  let swapUrl: string;
  let targetUrl: string;
  if (domain) {
    swapUrl   = `https://${domain}/api/uploads/${jobId}-swap.png`;
    targetUrl = `https://${domain}/api/uploads/${jobId}-target.png`;
  } else {
    const upload = async (p: string, kind: string) => {
      const buf = await readFile(p);
      const uploaded = await replicate.files.create(buf, { jobId, kind, route: "face-swap" });
      const getUrl = (uploaded as { urls?: { get?: string } })?.urls?.get;
      if (typeof getUrl !== "string" || !getUrl.startsWith("http")) {
        throw new Error("Replicate file upload returned an invalid URL.");
      }
      return getUrl;
    };
    try {
      swapUrl   = await upload(swapPath, "swap");
      targetUrl = await upload(targetPath, "target");
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to upload images: ${err.message}` });
    }
  }

  let output: unknown;
  try {
    output = await replicate.run("lucataco/faceswap", {
      input: {
        swap_image:   swapUrl,
        target_image: targetUrl,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: `Face swap failed: ${err.message}` });
  }

  // Result is a URL string
  let resultUrl: string;
  if (typeof output === "string") {
    resultUrl = output;
  } else if (output && typeof (output as any).url === "function") {
    resultUrl = (output as any).url().href;
  } else if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    resultUrl = typeof item === "string" ? item : item.url().href;
  } else {
    return res.status(500).json({ error: "Unexpected output from face swap model" });
  }

  // Download and cache the result
  const resultResp = await fetch(resultUrl);
  if (!resultResp.ok) return res.status(500).json({ error: "Failed to download result image" });
  const resultPath = path.join(SWAPS_DIR, `${jobId}-result.png`);
  await writeFile(resultPath, Buffer.from(await resultResp.arrayBuffer()));

  return res.json({ imageUrl: `/api/swaps/${jobId}-result.png`, jobId });
});

export default router;
