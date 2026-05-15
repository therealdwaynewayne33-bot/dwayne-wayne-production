import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** Connectivity probe for local dev; main video generation remains POST /videos. */
router.post("/generate", (req, res) => {
  try {
    const prompt = req.body?.prompt;
    const lockFace = Boolean(req.body?.lockFace);
    req.log?.info?.(
      {
        route: "POST /generate",
        promptChars: typeof prompt === "string" ? prompt.length : 0,
        lockFace,
        replicateConfigured: Boolean(process.env.REPLICATE_API_TOKEN?.trim()),
      },
      "generate route hit",
    );
    return res.json({
      success: true,
      message: "Generate route working",
    });
  } catch (err: unknown) {
    console.error("[POST /generate]", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
