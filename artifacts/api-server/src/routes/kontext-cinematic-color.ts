import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";
import { isFalConfigured } from "../lib/fal-kontext";
import { gradeUploadedVideoWithKontext } from "../lib/kontext-video-color";

const router = Router();

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (file.mimetype.startsWith("video/") || VIDEO_EXTS.has(ext)) cb(null, true);
    else cb(new Error("Only video files are accepted (MP4, MOV, WebM…)"));
  },
});

router.post("/render/kontext-cinematic-color", requireAuth, upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file provided." });
    }

    if (!isFalConfigured({ ignoreBaseline: true })) {
      return res.status(503).json({
        error: "Flux Kontext requires FAL_KEY. Add FAL_KEY to .env.local and restart the API server.",
        falKeyMissing: true,
        code: "FAL_KEY_MISSING",
      });
    }

    const jobId = `kctx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await gradeUploadedVideoWithKontext({
      videoBuffer: req.file.buffer,
      originalName: req.file.originalname,
      jobId,
    });

    return res.json({
      ...result,
      jobId,
      selectedMode: "color_grade",
      selectedRoute: "/api/render/kontext-cinematic-color",
      renderMode: "production",
      paidAiCalled: true,
      creditsDeducted: false,
      demoMode: false,
      baselineMode: false,
      renderProof: {
        selectedMode: "color_grade",
        selectedRoute: "/api/render/kontext-cinematic-color",
        selectedEngine: result.selectedEngine,
        realAiCalled: true,
        colorGradeActive: true,
        finalOutputUrlPresent: true,
        errorMessage: "",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Flux Kontext cinematic color grade failed.";
    const falKeyMissing = message.includes("FAL_KEY");
    req.log?.error?.({ err }, "kontext-cinematic-color failed");
    return res.status(falKeyMissing ? 503 : 500).json({
      error: message,
      falKeyMissing,
      code: falKeyMissing ? "FAL_KEY_MISSING" : "KONTEXT_FAILED",
    });
  }
});

export default router;
