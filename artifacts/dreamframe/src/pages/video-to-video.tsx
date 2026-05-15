import { useState, useRef, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Sparkles, Film, Play, Pause, RotateCcw, Volume2, VolumeX,
  CheckCircle2, X, ArrowRight, AlertTriangle,
} from "lucide-react";

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

declare const __RENDER_POLL_TIMEOUT_MS__: number;

const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;
const RENDER_POLL_TIMEOUT_MS: number =
  typeof __RENDER_POLL_TIMEOUT_MS__ === "number" && Number.isFinite(__RENDER_POLL_TIMEOUT_MS__) && __RENDER_POLL_TIMEOUT_MS__ >= 10_000
    ? __RENDER_POLL_TIMEOUT_MS__
    : DEFAULT_MAX_WAIT_MS;
/** Minimum wait follows `RENDER_POLL_TIMEOUT_MS` / Vite define (default 3600s when unset). */
const MAX_WAIT_MS = Math.max(DEFAULT_MAX_WAIT_MS, RENDER_POLL_TIMEOUT_MS);
const POLL_INTERVAL_MS = 3000;

const runningStatusesPoll = new Set([
  "running",
  "queued",
  "pending",
  "processing",
  "in-progress",
  "applying_color_transfer",
  "validating",
  "uploading",
  "encoding",
  "verifying",
]);

const successStatusesPoll = new Set(["completed", "complete", "succeeded", "success", "done"]);

const failedStatusesPoll = new Set(["failed", "error", "cancelled", "canceled"]);

function normStatus(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function VideoPlayer({ src, thumbnail }: { src: string; thumbnail?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [ended, setEnded] = useState(false);
  const progress = duration > 0 ? (elapsed / duration) * 100 : 0;

  const toggle = () => {
    const v = ref.current; if (!v) return;
    if (ended) { v.currentTime = 0; setEnded(false); v.play(); }
    else if (playing) v.pause(); else v.play();
  };

  return (
    <div className="rounded-2xl overflow-hidden border border-white/8 bg-black">
      <div className="relative aspect-video">
        <video key={stripQuery(src)} ref={ref} src={src} poster={thumbnail} className="w-full h-full object-contain" controls playsInline
          onPlay={() => { setPlaying(true); setEnded(false); }}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setEnded(true); }}
          onTimeUpdate={() => setElapsed(ref.current?.currentTime ?? 0)}
          onLoadedMetadata={() => setDuration(ref.current?.duration ?? 0)} />
        {!playing && !ended && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button onClick={toggle} className="w-14 h-14 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-2xl hover:scale-105 transition-all">
              <Play className="w-6 h-6 text-black ml-0.5" />
            </button>
          </div>
        )}
        {ended && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <button onClick={toggle} className="w-12 h-12 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-2xl hover:scale-105 transition-all mb-1.5">
              <RotateCcw className="w-5 h-5 text-black" />
            </button>
            <span className="text-white/50 text-xs">Replay</span>
          </div>
        )}
      </div>
      <div className="bg-black px-4 pt-2.5 pb-3 space-y-2">
        <div className="relative h-px bg-white/10 overflow-visible">
          <div className="absolute left-0 top-0 h-px bg-white transition-all" style={{ width: `${progress}%` }} />
          <input type="range" min={0} max={100} step={0.1} value={progress}
            onChange={(e) => { const v = ref.current; if (v && duration) v.currentTime = (Number(e.target.value) / 100) * duration; }}
            className="absolute inset-0 w-full opacity-0 cursor-pointer h-4 -top-2" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggle} className="w-7 h-7 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white transition-colors shrink-0">
            {playing ? <Pause className="w-3 h-3" /> : ended ? <RotateCcw className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
          </button>
          <button onClick={() => { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }}
            className="w-7 h-7 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white transition-colors shrink-0">
            {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          </button>
          <span className="text-xs text-white/30 font-mono tabular-nums">{fmt(elapsed)} / {fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}

const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"];

const isVideoFile = (f: File) => {
  const ext = "." + f.name.split(".").pop()?.toLowerCase();
  return f.type.startsWith("video/")
    || (f.type === "application/octet-stream" && VIDEO_EXTS.includes(ext))
    || VIDEO_EXTS.includes(ext);
};
const isImageFile = (f: File) => {
  const ext = "." + f.name.split(".").pop()?.toLowerCase();
  return f.type.startsWith("image/") || IMAGE_EXTS.includes(ext);
};

function MediaDropZone({
  label, file, previewUrl, onFile, onClear, dataTestId,
  acceptImages = false, hint,
}: {
  label: string;
  file: File | null;
  previewUrl: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
  dataTestId: string;
  acceptImages?: boolean;
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const isImg = file ? isImageFile(file) : false;

  const handle = (f: File) => {
    const ok = isVideoFile(f) || (acceptImages && isImageFile(f));
    if (!ok) {
      toast({
        title: acceptImages
          ? "Please upload a video or image"
          : "Please upload a video file",
        variant: "destructive",
      });
      return;
    }
    onFile(f);
  };

  const acceptAttr = acceptImages
    ? "video/*,image/*,.mp4,.mov,.webm,.avi,.mkv,.m4v,.3gp,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif"
    : "video/*,.mp4,.mov,.webm,.avi,.mkv,.m4v,.3gp";

  return (
    <div>
      <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">{label}</p>
      <div
        data-testid={dataTestId}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
        onClick={() => !file && inputRef.current?.click()}
        className={cn(
          "relative rounded-2xl border-2 border-dashed transition-all overflow-hidden",
          dragging ? "border-white/40 bg-white/5"
            : file ? "border-white/15 cursor-default"
                   : "border-white/10 hover:border-white/25 cursor-pointer",
          file ? "aspect-video" : "py-12"
        )}>
        {file && previewUrl ? (
          <>
            {isImg
              ? <img src={previewUrl} alt="reference" className="w-full h-full object-contain bg-black" />
              : <video src={previewUrl} className="w-full h-full object-contain bg-black" muted />
            }
            <button onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/80 hover:bg-black flex items-center justify-center text-white transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-medium truncate max-w-[90%]">
              {isImg ? "IMG" : "VID"} · {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-10 h-10 rounded-full bg-white/6 flex items-center justify-center">
              <Upload className={cn("w-4 h-4", dragging ? "text-white/70" : "text-white/25")} />
            </div>
            <div>
              <p className="text-xs font-medium text-white/50">{acceptImages ? "Drop video or image" : "Drop video"}</p>
              <p className="text-[10px] text-white/20 mt-0.5">{hint ?? (acceptImages ? "Video or photo · for inspiration" : "MP4, MOV, WebM")}</p>
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept={acceptAttr} className="hidden"
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      </div>
    </div>
  );
}

type Stage = "idle" | "processing" | "done" | "error";
type ProcessingMode = "transfer" | null;
type RenderMode = "locked_reference_color_match";
type TransferMode = RenderMode;
type PipelineStep = "idle" | "upload" | "analyze_reference" | "color_transfer" | "encode" | "complete" | "error";

const PRODUCTION_RESULT_STORAGE_KEY = "dreamframe_production_final_result";
const PRODUCTION_PENDING_JOB_STORAGE_KEY = "dreamframe_production_pending_job";

function isRealUploadedUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const v = url.trim();
  if (!v) return false;
  if (v.includes("[pending upload]")) return false;
  if (v.startsWith("blob:")) return false;
  if (v.startsWith("data:")) return false;
  if (v === "null" || v === "undefined") return false;
  return v.startsWith("/api/uploads/") || v.startsWith("/api/videos-files/");
}

function stripQuery(url: string): string {
  return url.split("?")[0] ?? url;
}

type V2vPollDebug = {
  serverRenderMode: string;
  selectedRoute: string;
  selectedEngine: string;
  mockMode: boolean;
  finalOutputUrl: string;
  inputDurationSeconds: number;
  outputDurationSeconds: number;
  referencePipeline: string;
};

const PRESETS = [
  { label: "Color grade",   prompt: "the overall color grade and tone" },
  { label: "Lighting mood", prompt: "the lighting mood and ambient atmosphere" },
  { label: "Cinematic look",prompt: "the cinematic film look — contrast, colors, and mood" },
  { label: "Warm sunset",   prompt: "the warm sunset glow and golden hour lighting" },
  { label: "Cool teal",     prompt: "the cool teal and blue color grade" },
  { label: "Moody dark",    prompt: "the moody dark cinematic atmosphere" },
];

const DEFAULT_TRANSFER_PROMPT =
  "Match reference color and lighting style only; preserve person, face, clothing, background, objects, timing, and scene layout exactly.";

const COLOR_TRANSFER_STRENGTH_OPTIONS = [
  { label: "Subtle", value: 0.2 },
  { label: "Normal", value: 0.85 },
  { label: "Strong", value: 0.95 },
  { label: "Maximum", value: 1 },
] as const;

/** UI label: this page uses FFmpeg for locked reference match; reserve “Luma” for real Luma API routes. */
function referenceTransferEngineLabel(selectedEngine: string | undefined): string {
  const e = String(selectedEngine ?? "").toLowerCase();
  if (e.includes("luma") && !e.includes("ffmpeg")) return "Luma Look Match";
  return "FFmpeg Reference Color Match";
}

function getRenderRoute(_mode: RenderMode): string {
  return "/api/render/production";
}

function validateEngineForMode(mode: RenderMode, engine: string) {
  if (mode !== "locked_reference_color_match" || engine !== "ffmpeg") {
    throw new Error(`Wrong engine selected. Mode ${mode} cannot use ${engine}.`);
  }
}

function normalizeRenderMode(mode: TransferMode): RenderMode {
  return mode === "locked_reference_color_match" ? mode : "locked_reference_color_match";
}

export default function VideoToVideoPage() {
  const [target,   setTarget]   = useState<File | null>(null);
  const [reference,setReference]= useState<File | null>(null);
  const [targetUrl,   setTargetUrl]    = useState<string | null>(null);
  const [referenceUrl,setReferenceUrl] = useState<string | null>(null);
  const [uploadedTargetUrl, setUploadedTargetUrl] = useState<string | null>(null);
  const [uploadedReferenceUrl, setUploadedReferenceUrl] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_TRANSFER_PROMPT);
  const selectedMode: TransferMode = "locked_reference_color_match";
  const [stage, setStage] = useState<Stage>("idle");
  const [processingMode, setProcessingMode] = useState<ProcessingMode>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploaded,  setUploaded]  = useState(0);
  const [totalBytes,setTotalBytes]= useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [colorTransferStrength, setColorTransferStrength] = useState(0.85);
  const [currentStep, setCurrentStep] = useState<PipelineStep>("idle");
  const [analyzeReferenceComplete, setAnalyzeReferenceComplete] = useState(false);
  const [colorTransferComplete, setColorTransferComplete] = useState(false);
  const [encodeComplete, setEncodeComplete] = useState(false);
  const [result, setResult] = useState<{
    videoUrl: string;
    finalOutputUrl?: string;
    thumbnailUrl?: string;
    previewUrl?: string;
    label?: string;
    description?: string;
    aiVideoModelUsed?: boolean;
    mode?: string;
    transferCompleteCertified?: boolean;
    referencePipeline?: string;
    serverRenderMode?: string;
    analysis?: {
      target: Record<string, number>;
      reference: Record<string, number>;
      targetYellowCast?: number;
      referenceYellowCast?: number;
      yellowDifference?: number;
      selectedStrength?: string;
    };
    finalFilter?: string;
    finalFFmpegFilter?: string;
    outputUrl?: string;
    renderId?: string;
    renderStartedAt?: string;
    selectedMode?: string;
    selectedPreset?: string;
    selectedRoute?: string;
    selectedEngine?: string;
    renderMode?: string;
    inputVideoUrl?: string;
    referenceUrl?: string;
    ffmpegCommand?: string;
    targetAverageRGB?: Record<string, number> | null;
    referenceAverageRGB?: Record<string, number> | null;
    outputAverageRGB?: Record<string, number> | null;
    yellowDifference?: number | null;
    filterApplied?: boolean;
    cacheBuster?: number;
    debugProof?: {
      progressPercent?: number;
      currentStep?: string;
      analyzeReferenceComplete?: boolean;
      colorTransferComplete?: boolean;
      encodeComplete?: boolean;
      outputVideoUrl?: "present" | "missing";
      targetFrameSampleBefore?: string;
      referenceFrameSample?: string;
      processedFrameSampleAfter?: string;
      beforeColorStats?: unknown;
      referenceColorStats?: unknown;
      afterColorStats?: unknown;
      colorDeltaBeforeToReference?: number;
      colorDeltaAfterToReference?: number;
      transformStrength?: number;
      filterGraphUsed?: string;
      processedFramesUsedInEncode?: boolean;
      error?: string | null;
      [key: string]: unknown;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stillProcessingNotice, setStillProcessingNotice] = useState<string | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [serverRenderMode, setServerRenderMode] = useState<string | null>(null);
  const [v2vPollDebug, setV2vPollDebug] = useState<V2vPollDebug | null>(null);
  const [finalRenderPayload, setFinalRenderPayload] = useState<{
    selectedMode: string;
    selectedRoute: string;
    selectedEngine: string;
    inputVideoUrl: string;
    referenceUrl: string;
    prompt: string;
  } | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRODUCTION_RESULT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { finalOutputUrl?: string; thumbnailUrl?: string; mode?: string };
      if (parsed?.mode === "locked_reference_color_match" && parsed.finalOutputUrl) {
        const cacheBusted = `${String(parsed.finalOutputUrl)}?v=${Date.now()}`;
        setResult((prev) => prev ?? {
          videoUrl: cacheBusted,
          finalOutputUrl: String(parsed.finalOutputUrl),
          outputUrl: String(parsed.finalOutputUrl),
          thumbnailUrl: parsed.thumbnailUrl,
          selectedMode: "locked_reference_color_match",
          selectedRoute: "/api/render/production",
          selectedEngine: "ffmpeg-locked-reference-color-transfer",
        });
      }
    } catch {
      // ignore malformed local state
    }
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("dreamframe_library_template_v2v");
      if (!raw) return;
      sessionStorage.removeItem("dreamframe_library_template_v2v");
      const data = JSON.parse(raw) as { prompt?: string };
      if (typeof data.prompt === "string" && data.prompt.trim()) {
        setPrompt(data.prompt.trim());
        toast({ title: "Library template applied", description: "Video → Video prompt updated." });
      }
    } catch {
      /* ignore */
    }
  }, [toast]);

  useEffect(() => {
    try {
      const pending = localStorage.getItem(PRODUCTION_PENDING_JOB_STORAGE_KEY)?.trim();
      if (pending) setRenderJobId((prev) => prev ?? pending);
    } catch {
      // ignore malformed storage
    }
  }, []);

  const setT = useCallback((f: File) => {
    setTarget(f);
    setTargetUrl(URL.createObjectURL(f));
    setUploadedTargetUrl(null);
    setResult(null); setError(null); setStillProcessingNotice(null); setStage("idle");
    setPipelineProgress(0); setCurrentStep("idle"); setUploadComplete(false);
    setAnalyzeReferenceComplete(false); setColorTransferComplete(false); setEncodeComplete(false);
    localStorage.removeItem(PRODUCTION_RESULT_STORAGE_KEY);
  }, []);
  const setR = useCallback((f: File) => {
    setReference(f);
    setReferenceUrl(URL.createObjectURL(f));
    setUploadedReferenceUrl(null);
    setResult(null); setError(null); setStillProcessingNotice(null); setStage("idle");
    setPipelineProgress(0); setCurrentStep("idle"); setUploadComplete(false);
    setAnalyzeReferenceComplete(false); setColorTransferComplete(false); setEncodeComplete(false);
    localStorage.removeItem(PRODUCTION_RESULT_STORAGE_KEY);
  }, []);
  const clearT = () => { setTarget(null); setTargetUrl(null); setUploadedTargetUrl(null); };
  const clearR = () => { setReference(null); setReferenceUrl(null); setUploadedReferenceUrl(null); };

  const uploadMedia = async (file: File, kind: "target" | "reference"): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    const token = localStorage.getItem("dreamframe_token");
    const resp = await fetch("/api/render/upload-media", {
      method: "POST",
      body: form,
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || typeof data?.url !== "string") {
      throw new Error(typeof data?.error === "string" ? data.error : "Upload failed");
    }
    return data.url;
  };

  async function runProductionPollLoop(
    jobId: string,
    urlCtx: { targetUploadUrl: string; referenceUploadUrl: string },
  ): Promise<void> {
    const token = localStorage.getItem("dreamframe_token");
    const pollStartedAt = Date.now();
    while (true) {
      const statusResp = await fetch(`/api/render/status?jobId=${encodeURIComponent(jobId)}`, {
        method: "GET",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const statusData = await statusResp.json().catch(() => ({}));
      if (!statusResp.ok) {
        throw new Error(statusData?.error ?? `Status polling failed (HTTP ${statusResp.status})`);
      }
      const modeFromStatus = statusData?.serverRenderMode ?? statusData?.renderMode;
      if (modeFromStatus != null) {
        setServerRenderMode(String(modeFromStatus));
      }

      const rawStatus = normStatus(statusData?.status);
      const step = String(statusData?.currentStep ?? statusData?.status ?? "unknown");
      const progress = Number(statusData?.progressPercent ?? 20);
      const finalOutputUrl = String(statusData?.finalOutputUrl ?? "");
      const actualInputVideoUrl = String(
        statusData?.targetVideoUrl ?? statusData?.inputVideoUrl ?? urlCtx.targetUploadUrl ?? "",
      );
      const actualReferenceUrl =
        String(statusData?.referenceVideoUrl ?? "") ||
        String(statusData?.referenceImageUrl ?? "") ||
        String(urlCtx.referenceUploadUrl ?? "");

      const inFailed = failedStatusesPoll.has(rawStatus);

      const inSuccess = successStatusesPoll.has(rawStatus);

      const renderModeStr = String(statusData?.serverRenderMode ?? statusData?.renderMode ?? "");
      const refPipelineStr = String(statusData?.referencePipeline ?? "");
      const mockEqJob =
        statusData?.heavyColorTransferSkipped === true ||
        statusData?.debugProof?.heavyColorTransferSkipped === true ||
        statusData?.mockEqUsed === true ||
        statusData?.mockOutputGenerated === true ||
        statusData?.debugProof?.mockOutputGenerated === true ||
        refPipelineStr === "mock_eq";

      const sampledDiffs = statusData?.debugProof?.sampledFrameDiffs;
      const strictComplete =
        inSuccess &&
        Boolean(finalOutputUrl) &&
        isRealUploadedUrl(actualInputVideoUrl) &&
        isRealUploadedUrl(actualReferenceUrl) &&
        isRealUploadedUrl(finalOutputUrl) &&
        Boolean(statusData?.debugProof?.inputFileHash) &&
        Boolean(statusData?.debugProof?.outputFileHash) &&
        Boolean(statusData?.debugProof?.inputOutputHashesDifferent) &&
        Number(statusData?.debugProof?.inputDurationSeconds ?? 0) > 0 &&
        Number(statusData?.debugProof?.outputDurationSeconds ?? 0) > 0 &&
        Array.isArray(sampledDiffs) &&
        sampledDiffs.length >= 3 &&
        Boolean(statusData?.debugProof?.verificationPassed);

      const isCompleted = strictComplete && !mockEqJob;

      const transferCompleteCertified =
        strictComplete &&
        !mockEqJob &&
        renderModeStr !== "mock";

      const inDur = Number(statusData?.debugProof?.inputDurationSeconds ?? statusData?.inputDurationSeconds ?? 0);
      const outDur = Number(statusData?.debugProof?.outputDurationSeconds ?? statusData?.outputDurationSeconds ?? 0);
      setV2vPollDebug({
        serverRenderMode: renderModeStr,
        selectedRoute: String(statusData?.selectedRoute ?? "/api/render/production"),
        selectedEngine: String(statusData?.selectedEngine ?? ""),
        mockMode: renderModeStr === "mock",
        finalOutputUrl,
        inputDurationSeconds: inDur,
        outputDurationSeconds: outDur,
        referencePipeline: refPipelineStr || "(pending)",
      });

      setPipelineProgress(clamp(progress, 0, 100));
      if (step.includes("analyze")) {
        setCurrentStep("analyze_reference");
      } else if (step.includes("computing") || step.includes("applying")) {
        setCurrentStep("color_transfer");
      } else if (step.includes("encoding")) {
        setCurrentStep("encode");
      } else if (step.includes("mock_ffmpeg")) {
        setCurrentStep("encode");
      } else if (step === "complete") {
        setCurrentStep("complete");
      } else if (
        step === "processing" ||
        step === "preparing_files" ||
        step === "validating" ||
        step === "uploading" ||
        step === "queued"
      ) {
        setCurrentStep("color_transfer");
      } else if (step === "error") {
        setCurrentStep("error");
      }
      setAnalyzeReferenceComplete(Boolean(statusData?.analyzeReferenceComplete));
      setColorTransferComplete(Boolean(statusData?.colorTransferCompleted));
      setEncodeComplete(Boolean(statusData?.encodeCompleted));

      if (inFailed) {
        throw new Error(String(statusData?.error ?? "Render job failed."));
      }
      if (isCompleted) {
        try {
          localStorage.removeItem(PRODUCTION_PENDING_JOB_STORAGE_KEY);
        } catch {
          // ignore
        }
        const cacheBustedFinalUrl = `${finalOutputUrl}${finalOutputUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
        const normalizedResult = {
          ...statusData,
          videoUrl: cacheBustedFinalUrl,
          outputUrl: finalOutputUrl,
          finalOutputUrl,
          transferCompleteCertified,
          serverRenderMode: renderModeStr,
          referencePipeline: refPipelineStr,
          label: transferCompleteCertified
            ? "Transfer complete"
            : mockEqJob
              ? "Output ready (mock EQ only — reference pipeline was not used)"
              : renderModeStr === "mock"
                ? "Output ready (server RENDER_MODE=mock — Transfer complete label disabled)"
                : "Output ready",
          debugProof: {
            ...(statusData?.debugProof ?? {}),
            progressPercent: statusData?.progressPercent ?? 100,
            currentStep: statusData?.currentStep ?? "complete",
            analyzeReferenceComplete: statusData?.analyzeReferenceComplete ?? true,
            colorTransferComplete: statusData?.colorTransferCompleted ?? true,
            encodeComplete: statusData?.encodeCompleted ?? true,
            outputVideoUrl: finalOutputUrl ? "present" : "missing",
            error: statusData?.error ?? null,
            realTargetUrlReady: true,
            realReferenceUrlReady: true,
            startedBeforeUploadFinished: false,
            usedPlaceholderUrl: false,
            usedOldOutputUrl: !finalOutputUrl.includes("locked-color"),
            actualInputVideoUrl,
            actualReferenceUrl,
            actualFinalOutputUrl: finalOutputUrl,
            previewUsingFinalOutputUrl: true,
            verificationPassed: Boolean(statusData?.debugProof?.verificationPassed),
          },
        };
        setAnalyzeReferenceComplete(true);
        setColorTransferComplete(true);
        setEncodeComplete(true);
        setCurrentStep("complete");
        setPipelineProgress(100);
        setResult(normalizedResult);
        localStorage.setItem(
          PRODUCTION_RESULT_STORAGE_KEY,
          JSON.stringify({
            mode: "locked_reference_color_match",
            finalOutputUrl,
            thumbnailUrl: statusData?.thumbnailUrl,
            updatedAt: new Date().toISOString(),
          }),
        );
        setStage("done");
        setRenderJobId(null);
        setStillProcessingNotice(null);
        break;
      }
      if (Date.now() - pollStartedAt > MAX_WAIT_MS) {
        try {
          localStorage.setItem(PRODUCTION_PENDING_JOB_STORAGE_KEY, jobId);
        } catch {
          // ignore
        }
        setStillProcessingNotice("Render still processing. Check again soon.");
        setStage("idle");
        setProcessingMode(null);
        setCurrentStep("idle");
        setRenderJobId(jobId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  const handleAiTransfer = async () => {
    if (!target)    { toast({ title: "Upload a target video first",    variant: "destructive" }); return; }
    if (!reference) {
      setError("Reference file missing. Upload a reference video or image before AI transfer.");
      setStage("error");
      return;
    }
    if (!prompt.trim()) { toast({ title: "Describe what to transfer", variant: "destructive" }); return; }
    const mode = normalizeRenderMode(selectedMode);
    const selectedEngine = "ffmpeg";
    validateEngineForMode(mode, selectedEngine);
    setProcessingMode("transfer");
    setStage("processing");
    setError(null);
    setStillProcessingNotice(null);
    setResult(null);
    setFinalRenderPayload(null);
    setV2vPollDebug(null);
    setCurrentStep("upload");
    setPipelineProgress(5);
    setUploadComplete(false);
    setAnalyzeReferenceComplete(false);
    setColorTransferComplete(false);
    setEncodeComplete(false);
    setUploadPct(0);
    setUploaded(0);
    setTotalBytes(target.size + reference.size);
    setIsUploadingMedia(true);
    localStorage.removeItem(PRODUCTION_RESULT_STORAGE_KEY);
    let targetUploadUrl = uploadedTargetUrl;
    let referenceUploadUrl = uploadedReferenceUrl;
    try {
      if (!targetUploadUrl) {
        targetUploadUrl = await uploadMedia(target, "target");
        setUploadedTargetUrl(targetUploadUrl);
      }
      if (!referenceUploadUrl) {
        referenceUploadUrl = await uploadMedia(reference, "reference");
        setUploadedReferenceUrl(referenceUploadUrl);
      }
      setIsUploadingMedia(false);
      setUploadComplete(true);
      setPipelineProgress(20);
      setCurrentStep("analyze_reference");
    } catch (uploadErr: any) {
      setIsUploadingMedia(false);
      setError(uploadErr?.message ?? "Failed to upload media before AI render.");
      setCurrentStep("error");
      setPipelineProgress(0);
      setStage("error");
      return;
    }

    const realTargetUrlReady = isRealUploadedUrl(targetUploadUrl);
    const realReferenceUrlReady = isRealUploadedUrl(referenceUploadUrl);
    const usedPlaceholderUrl =
      String(targetUploadUrl ?? "").includes("pending upload") ||
      String(referenceUploadUrl ?? "").includes("pending upload");
    const startedBeforeUploadFinished = !realTargetUrlReady || !realReferenceUrlReady;
    if (startedBeforeUploadFinished || usedPlaceholderUrl) {
      setError("Upload still processing. Please wait until target and reference are ready.");
      setCurrentStep("error");
      setPipelineProgress(0);
      setStage("error");
      return;
    }

    const form = new FormData();
    form.append("prompt", prompt.trim());
    form.append("selectedMode", mode);
    form.append("mode", mode);
    form.append("inputVideoUrl", targetUploadUrl ?? "");
    form.append("targetVideoUrl", targetUploadUrl ?? "");
    form.append("referenceUrl", referenceUploadUrl ?? "");
    if (reference && isImageFile(reference)) {
      form.append("referenceImageUrl", referenceUploadUrl ?? "");
    } else {
      form.append("referenceVideoUrl", referenceUploadUrl ?? "");
    }
    form.append("colorMatchStrength", String(colorTransferStrength));
    form.append("exposureMatchStrength", "0.35");
    form.append("contrastMatchStrength", "0.50");
    form.append("saturationMatchStrength", "0.45");
    form.append("whiteBalanceStrength", "0.45");
    form.append("toneCurveStrength", "0.40");
    form.append("preserveSkinTone", "true");
    form.append("preserveIdentity", "true");
    form.append("preserveOriginalVideoContent", "true");
    form.append("preserveOriginalAudio", "true");
    form.append("preserveTargetLuminance", "true");
    setFinalRenderPayload({
      selectedMode: mode,
      selectedRoute: "/api/render/production",
      selectedEngine: "ffmpeg",
      inputVideoUrl: targetUploadUrl!,
      referenceUrl: referenceUploadUrl!,
      prompt: prompt.trim(),
    });

    const token = localStorage.getItem("dreamframe_token");
    setUploadPct(100);

    try {
      const startResp = await fetch(getRenderRoute(mode), {
        method: "POST",
        body: form,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const startData = await startResp.json().catch(() => ({}));
      if (!startResp.ok) {
        throw new Error(startData?.error ?? `Failed to start render job (HTTP ${startResp.status})`);
      }
      const jobId = String(startData?.jobId ?? "").trim();
      if (!jobId) throw new Error("Server did not return a render jobId.");
      setRenderJobId(jobId);
      try {
        localStorage.removeItem(PRODUCTION_PENDING_JOB_STORAGE_KEY);
      } catch {
        // ignore
      }

      await runProductionPollLoop(jobId, {
        targetUploadUrl: targetUploadUrl!,
        referenceUploadUrl: referenceUploadUrl!,
      });
    } catch (pollErr: any) {
      setError(pollErr?.message ?? "Render job failed.");
      setCurrentStep("error");
      setStage("error");
    }
  };

  const handleSubmit = async () => {
    if (!target) {
      setError("Target video missing.");
      setStage("error");
      return;
    }
    if (!reference) {
      setError("Reference video/image missing.");
      setStage("error");
      return;
    }

    await handleAiTransfer();
  };

  const handleResumePoll = async () => {
    const jobId = (renderJobId ?? localStorage.getItem(PRODUCTION_PENDING_JOB_STORAGE_KEY) ?? "").trim();
    if (!jobId) {
      toast({ title: "No render job to check", variant: "destructive" });
      return;
    }
    const targetU = finalRenderPayload?.inputVideoUrl ?? uploadedTargetUrl ?? "";
    const referenceU = finalRenderPayload?.referenceUrl ?? uploadedReferenceUrl ?? "";

    setRenderJobId(jobId);
    setStillProcessingNotice(null);
    setError(null);
    setProcessingMode("transfer");
    setStage("processing");
    setCurrentStep("color_transfer");
    setPipelineProgress((p) => Math.max(p, 25));

    try {
      await runProductionPollLoop(jobId, {
        targetUploadUrl: targetU,
        referenceUploadUrl: referenceU,
      });
    } catch (pollErr: unknown) {
      const msg = pollErr instanceof Error ? pollErr.message : "Render job failed.";
      setError(msg);
      setCurrentStep("error");
      setStage("error");
    }
  };

  const cancelUpload = () => { xhrRef.current?.abort(); };

  const reset = () => {
    xhrRef.current?.abort();
    setTarget(null); setReference(null);
    setTargetUrl(null); setReferenceUrl(null);
    setUploadedTargetUrl(null); setUploadedReferenceUrl(null);
    setIsUploadingMedia(false);
    setPrompt(DEFAULT_TRANSFER_PROMPT); setResult(null); setError(null); setStillProcessingNotice(null); setStage("idle"); setProcessingMode(null);
    setFinalRenderPayload(null);
    setUploadPct(0); setUploaded(0); setTotalBytes(0);
    setUploadComplete(false);
    setPipelineProgress(0);
    setCurrentStep("idle");
    setAnalyzeReferenceComplete(false);
    setColorTransferComplete(false);
    setEncodeComplete(false);
    localStorage.removeItem(PRODUCTION_RESULT_STORAGE_KEY);
    try {
      localStorage.removeItem(PRODUCTION_PENDING_JOB_STORAGE_KEY);
    } catch {
      // ignore
    }
    setColorTransferStrength(0.85);
    setRenderJobId(null);
    setServerRenderMode(null);
    setV2vPollDebug(null);
  };

  const fmtMB = (n: number) => (n / 1024 / 1024).toFixed(1);
  const canApplyTransfer = Boolean(target && reference && prompt.trim()) && !isUploadingMedia;
  const effectiveRenderMode = serverRenderMode ?? result?.serverRenderMode ?? result?.renderMode ?? null;
  const transferEngineUiLabel = referenceTransferEngineLabel(result?.selectedEngine ?? v2vPollDebug?.selectedEngine);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-8 py-14">
        {/* Header */}
        <div className="mb-12">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-2">AI transfer</p>
          <h1 className="text-4xl font-semibold text-white tracking-tight">Video to Video</h1>
          <p className="text-sm text-white/30 mt-2">
            Drop your video and a reference (video or photo) — describe what to copy (color grade, lighting, an object) and we apply it to your video
          </p>
          <p className="text-xs text-white/45 mt-3">
            {effectiveRenderMode === "production"
              ? "Server: production — paid AI may be used on other routes; locked color match here is still FFmpeg-based."
              : effectiveRenderMode === "local"
                ? "Server: local — FFmpeg reference color match runs on this machine. Target brightness structure is preserved by default; only cinematic color mood is borrowed."
                : effectiveRenderMode === "mock"
                  ? "Server: mock tier — FFmpeg reference pipeline still runs end-to-end, but the UI will not show “Transfer complete” until RENDER_MODE is local or production."
                  : "Server mode appears after the first status poll — ensure RENDER_MODE=local for a certified completion label."}
          </p>
          {effectiveRenderMode === "mock" ? (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-100/95">
              <span className="font-semibold text-red-200">Mock server tier.</span> The page will not claim “Transfer complete” while{" "}
              <span className="font-mono">RENDER_MODE=mock</span>. Set{" "}
              <span className="font-mono text-red-50">RENDER_MODE=local</span> in{" "}
              <span className="font-mono">.env.local</span> at the workspace root and restart <span className="font-mono">pnpm dev</span>{" "}
              so certification matches your environment.
            </div>
          ) : null}
          {v2vPollDebug ? (
            <div className="mt-4 border border-white/10 rounded-xl p-3 font-mono text-[10px] text-white/55 space-y-1">
              <p className="text-[11px] text-white/35 uppercase tracking-widest mb-2">V2V poll debug</p>
              <p className="break-all">serverRenderMode: {v2vPollDebug.serverRenderMode || "(none)"}</p>
              <p className="break-all">selectedRoute: {v2vPollDebug.selectedRoute}</p>
              <p className="break-all">selectedEngine: {v2vPollDebug.selectedEngine || "(none)"}</p>
              <p>mockMode: {String(v2vPollDebug.mockMode)}</p>
              <p className="break-all">referencePipeline: {v2vPollDebug.referencePipeline}</p>
              <p className="break-all">finalOutputUrl: {v2vPollDebug.finalOutputUrl || "(none)"}</p>
              <p>inputDurationSeconds: {String(v2vPollDebug.inputDurationSeconds)}</p>
              <p>outputDurationSeconds: {String(v2vPollDebug.outputDurationSeconds)}</p>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left: inputs */}
          <div className="space-y-7">
            {/* Target video + reference (video OR image) drop zones */}
            <div className="grid grid-cols-2 gap-4 items-start">
              <MediaDropZone
                label="Your video (target)"
                file={target} previewUrl={targetUrl}
                onFile={setT} onClear={clearT}
                dataTestId="drop-zone-target"
                hint="MP4, MOV, WebM"
              />
              <MediaDropZone
                label="Reference (video or image)"
                file={reference} previewUrl={referenceUrl}
                onFile={setR} onClear={clearR}
                dataTestId="drop-zone-reference"
                acceptImages
                hint="A photo or video to copy from"
              />
            </div>

            {/* Visual flow indicator */}
            <div className="flex items-center justify-center gap-3 text-[10px] text-white/30 uppercase tracking-widest">
              <span>Reference</span>
              <ArrowRight className="w-3 h-3" />
              <span>Target</span>
            </div>

            {/* Transfer mode */}
            <div className="border border-white/10 rounded-2xl p-5 bg-white/[0.02] space-y-3">
              <p className="text-[11px] text-white/30 uppercase tracking-widest">Mode</p>
              <div className="w-full rounded-xl border border-white/40 bg-white/10 px-3 py-2.5">
                <p className="text-xs font-medium text-white">{transferEngineUiLabel}</p>
                <p className="text-[10px] text-white/30 mt-1">
                  Engine: FFmpeg reference color transfer on this page (no Luma API). Use{" "}
                  <span className="font-mono">RENDER_MODE=local</span> or <span className="font-mono">production</span> for a certified
                  “Transfer complete” label; <span className="font-mono">mock</span> still runs the same pipeline but disables that label.
                </p>
              </div>
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2">
                <p className="text-[11px] text-emerald-200/90">
                  Full-frame color grade only: same person, face, skin tone, clothing, background, objects, timing, framing, and layout — no crop,
                  resize, face swap, background replacement, or added objects.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] text-white/30 uppercase tracking-widest">Match strength</p>
                <div className="flex flex-wrap gap-2">
                  {COLOR_TRANSFER_STRENGTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setColorTransferStrength(opt.value)}
                      disabled={stage === "processing"}
                      className={cn(
                        "text-xs px-3 py-1.5 rounded-full border transition-all",
                        Math.abs(colorTransferStrength - opt.value) < 0.001
                          ? "border-white/40 bg-white/10 text-white"
                          : "border-white/8 text-white/30 hover:border-white/20 hover:text-white/60",
                      )}
                    >
                      {opt.label} ({opt.value})
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-white/20">
                  Default is Normal (0.85). Higher values push average color and contrast closer to the reference; Subtle keeps more of the original shot.
                </p>
              </div>
            </div>

            {/* Transfer prompt */}
            <div>
              <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">Transfer intent</p>
              <Input
                data-testid="input-transfer-prompt"
                placeholder='e.g. "the warm color grade", "the lamp on the table", "the rainy mood"'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus-visible:ring-white/20 mb-2"
              />
              <p className="text-[11px] text-white/20 mb-3">
                This mode applies locked post-processing color transfer from your reference while preserving original content.
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => setPrompt(p.prompt)}
                    className={cn("text-xs px-3 py-1.5 rounded-full border transition-all",
                      prompt === p.prompt
                        ? "border-white/40 bg-white/10 text-white"
                        : "border-white/8 text-white/30 hover:border-white/20 hover:text-white/60")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <Button data-testid="button-transfer"
              onClick={handleSubmit}
              disabled={!canApplyTransfer || stage === "processing"}
              className="w-full bg-white text-black hover:bg-white/90 font-semibold gap-2 h-11 rounded-full">
              {stage === "processing" ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                  {processingMode === "transfer" ? "Color transfer still processing…" : "Processing..."}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Apply Automatic Transfer
                </>
              )}
            </Button>

            {stage === "processing" && (
              <div className="border border-white/8 rounded-2xl p-5 space-y-4">
                {/* Upload progress bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-white/60 uppercase tracking-widest">
                      {currentStep === "upload" ? "Uploading" : currentStep === "error" ? "Error" : "Processing on server"}
                    </p>
                    <span className="text-xs font-mono tabular-nums text-white/50">
                      {currentStep === "upload"
                        ? `${fmtMB(uploaded)} / ${fmtMB(totalBytes)} MB · ${uploadPct}%`
                        : `${pipelineProgress}%`}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-200",
                        pipelineProgress < 100 ? "bg-white" : "bg-emerald-400"
                      )}
                      style={{ width: `${Math.max(pipelineProgress, 4)}%` }}
                    />
                  </div>
                  {currentStep !== "upload" && processingMode === "transfer" && (
                    <p className="text-sm text-white/55">Color transfer still processing… This can take several minutes.</p>
                  )}
                  {currentStep === "upload" && (
                    <button
                      onClick={cancelUpload}
                      className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
                    >
                      Cancel upload
                    </button>
                  )}
                </div>

                <div className="border-t border-white/8 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Pipeline</p>
                  {[
                    { label: "Upload target + reference", done: uploadComplete, active: currentStep === "upload" },
                    { label: "Analyze reference look", done: analyzeReferenceComplete, active: currentStep === "analyze_reference" },
                    { label: "Apply locked color transfer", done: colorTransferComplete, active: currentStep === "color_transfer" },
                    { label: "Encode final video", done: encodeComplete, active: currentStep === "encode" },
                  ].map((step) => (
                    <div key={step.label} className="flex items-center gap-3">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        step.done ? "bg-emerald-400" : step.active ? "bg-white animate-pulse" : "bg-white/15"
                      )} />
                      <span className={cn("text-xs", step.active ? "text-white/70" : "text-white/40")}>{step.label}</span>
                    </div>
                  ))}
                  <p className="text-[11px] text-white/20 pt-1">
                    We poll every few seconds for up to {Math.max(1, Math.round(MAX_WAIT_MS / 60_000))} minutes. You can leave this page and use &quot;Check render status&quot; with the saved job if polling pauses.
                  </p>
                </div>
              </div>
            )}

            {stillProcessingNotice ? (
              <div className="border border-amber-400/35 bg-amber-400/10 rounded-2xl p-4 text-sm text-amber-100/95 space-y-3">
                <p>{stillProcessingNotice}</p>
                {renderJobId ? (
                  <p className="text-[11px] text-white/55 font-mono break-all">jobId: {renderJobId}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-400/40 text-amber-100 hover:bg-amber-400/15 rounded-full"
                  onClick={() => void handleResumePoll()}
                  disabled={stage === "processing"}
                >
                  Check render status
                </Button>
              </div>
            ) : null}

            {error && (
              <div className="border border-red-500/20 bg-red-500/5 rounded-2xl p-4 text-sm text-red-400 space-y-2">
                <p>{error}</p>
                {renderJobId ? (
                  <p className="text-[11px] text-white/45 font-mono break-all">jobId: {renderJobId}</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Right: result */}
          <div>
            {stage === "done" && result ? (
              <div className="space-y-5">
                <div
                  className={cn(
                    "flex items-center gap-2 text-sm font-medium mb-2",
                    result.transferCompleteCertified ? "text-white/60" : "text-red-200/90",
                  )}
                >
                  {result.finalOutputUrl ? (
                    <>
                      {result.transferCompleteCertified ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <span>{result.label ?? (result.transferCompleteCertified ? "Transfer complete" : "Output ready")}</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      <span>Render incomplete</span>
                    </>
                  )}
                </div>
                {!result.transferCompleteCertified && result.finalOutputUrl ? (
                  <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-[11px] text-red-100/90">
                    Certified “Transfer complete” is disabled for this run (mock server tier and/or non-reference pipeline). The video below may
                    still be the FFmpeg locked-reference output — set <span className="font-mono">RENDER_MODE=local</span> (or production) in{" "}
                    <span className="font-mono">.env.local</span> at the workspace root and restart <span className="font-mono">pnpm dev</span>.
                  </div>
                ) : null}
                {result.finalOutputUrl ? <VideoPlayer src={result.videoUrl} thumbnail={result.thumbnailUrl} /> : null}
                {result.finalOutputUrl ? (
                  <div className="mt-2 border border-white/8 rounded-lg p-3 space-y-1">
                    <p className="text-[10px] text-white/35 break-all">videoPlayerSrc: {result.videoUrl}</p>
                    <p className="text-[10px] text-white/35 break-all">finalOutputUrl: {result.finalOutputUrl}</p>
                    <p className="text-[10px] text-white/35 break-all">inputVideoUrl: {String(result.inputVideoUrl ?? result.debugProof?.actualInputVideoUrl ?? "")}</p>
                    <p className="text-[10px] text-white/35 break-all">referenceUrl: {String(result.referenceUrl ?? result.debugProof?.actualReferenceUrl ?? "")}</p>
                    <p className="text-[10px] text-white/35 break-all">
                      isPlayerUsingFinalOutputUrl: {String(stripQuery(String(result.videoUrl ?? "")) === stripQuery(String(result.finalOutputUrl ?? "")))}
                    </p>
                  </div>
                ) : null}
                {(targetUrl || referenceUrl || result.finalOutputUrl) && (
                  <div className="border border-white/8 rounded-2xl p-4">
                    <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">Side-by-side proof</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-white/35 mb-1">Original target</p>
                        {result.debugProof?.targetFrameSampleBefore
                          ? <img src={String(result.debugProof.targetFrameSampleBefore)} alt="Target before" className="w-full rounded-lg bg-black" />
                          : (targetUrl ? <video src={targetUrl} className="w-full rounded-lg bg-black" muted /> : null)}
                      </div>
                      <div>
                        <p className="text-[10px] text-white/35 mb-1">Reference</p>
                        {result.debugProof?.referenceFrameSample
                          ? <img src={String(result.debugProof.referenceFrameSample)} alt="Reference frame" className="w-full rounded-lg bg-black" />
                          : (referenceUrl
                              ? (referenceUrl.match(/\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i)
                                  ? <img src={referenceUrl} alt="Reference" className="w-full rounded-lg bg-black" />
                                  : <video src={referenceUrl} className="w-full rounded-lg bg-black" muted />)
                              : null)}
                      </div>
                      <div>
                        <p className="text-[10px] text-white/35 mb-1">Color matched output</p>
                        {result.debugProof?.processedFrameSampleAfter
                          ? <img src={String(result.debugProof.processedFrameSampleAfter)} alt="Processed frame" className="w-full rounded-lg bg-black" />
                          : (result.finalOutputUrl ? <video src={result.finalOutputUrl} className="w-full rounded-lg bg-black" controls playsInline /> : null)}
                      </div>
                    </div>
                  </div>
                )}
                {result.debugProof?.contactSheetUrl ? (
                  <div className="border border-white/8 rounded-2xl p-4">
                    <p className="text-[11px] text-white/30 uppercase tracking-widest mb-2">Contact sheet proof</p>
                    <img
                      src={String(result.debugProof.contactSheetUrl)}
                      alt="Color match contact sheet"
                      className="w-full rounded-lg bg-black"
                    />
                  </div>
                ) : null}
                <div className="border border-amber-400/15 bg-amber-400/5 rounded-2xl p-4 space-y-1.5">
                  <p className="text-[11px] text-amber-200/80 uppercase tracking-widest">Progress debug proof</p>
                  <p className="text-[10px] text-white/35 break-all">progressPercent: {String(result.debugProof?.progressPercent ?? pipelineProgress)}</p>
                  <p className="text-[10px] text-white/35 break-all">currentStep: {result.debugProof?.currentStep ?? currentStep}</p>
                  <p className="text-[10px] text-white/35 break-all">analyzeReferenceComplete: {String(result.debugProof?.analyzeReferenceComplete ?? analyzeReferenceComplete)}</p>
                  <p className="text-[10px] text-white/35 break-all">colorTransferComplete: {String(result.debugProof?.colorTransferComplete ?? colorTransferComplete)}</p>
                  <p className="text-[10px] text-white/35 break-all">encodeComplete: {String(result.debugProof?.encodeComplete ?? encodeComplete)}</p>
                  <p className="text-[10px] text-white/35 break-all">finalOutputUrl: {result.finalOutputUrl ? "present" : "missing"}</p>
                  <p className="text-[10px] text-white/35 break-all">error: {result.debugProof?.error ?? "null"}</p>
                  <p className="text-[10px] text-white/35 break-all">processedFramesUsedInEncode: {String(result.debugProof?.processedFramesUsedInEncode ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">colorDeltaBeforeToReference: {String(result.debugProof?.colorDeltaBeforeToReference ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">colorDeltaAfterToReference: {String(result.debugProof?.colorDeltaAfterToReference ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">transformStrength: {String(result.debugProof?.transformStrength ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">actualEngineUsed: {String(result.debugProof?.actualEngineUsed ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">whiteBalanceProtection: {String(result.debugProof?.whiteBalanceProtection ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">preserveTargetLuminance: {String(result.debugProof?.preserveTargetLuminance ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">yellowCastReduction: {String(result.debugProof?.yellowCastReduction ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">greenCastReduction: {String(result.debugProof?.greenCastReduction ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">brightnessShift: {String(result.debugProof?.brightnessShift ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">saturationShift: {String(result.debugProof?.saturationShift ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">contrastShift: {String(result.debugProof?.contrastShift ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">rerenderedBecauseTooStrong: {String(result.debugProof?.rerenderedBecauseTooStrong ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">targetFrameSampleBefore: {String(result.debugProof?.targetFrameSampleBefore ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">referenceFrameSample: {String(result.debugProof?.referenceFrameSample ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">processedFrameSampleAfter: {String(result.debugProof?.processedFrameSampleAfter ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">referenceFrameExtracted: {String(result.debugProof?.referenceFrameExtracted ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">targetFrameExtracted: {String(result.debugProof?.targetFrameExtracted ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">colorStatsComputed: {String(result.debugProof?.colorStatsComputed ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">colorTransformApplied: {String(result.debugProof?.colorTransformApplied ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">processedFramesCreated: {String(result.debugProof?.processedFramesCreated ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">ffmpegUsedOriginalVideoCopy: {String(result.debugProof?.ffmpegUsedOriginalVideoCopy ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">previewUsingFinalOutputUrl: {String(result.debugProof?.previewUsingFinalOutputUrl ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">averagePixelDifferencePercent: {String(result.debugProof?.averagePixelDifferencePercent ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">inputFileHash: {String(result.debugProof?.inputFileHash ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">outputFileHash: {String(result.debugProof?.outputFileHash ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">inputOutputHashesDifferent: {String(result.debugProof?.inputOutputHashesDifferent ?? false)}</p>
                  <p className="text-[10px] text-white/35 break-all">inputFileSize: {String(result.debugProof?.inputFileSize ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">outputFileSize: {String(result.debugProof?.outputFileSize ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">inputDurationSeconds: {String(result.debugProof?.inputDurationSeconds ?? result.debugProof?.targetDuration ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">outputDurationSeconds: {String(result.debugProof?.outputDurationSeconds ?? "")}</p>
                  <p className="text-[10px] text-white/35 break-all">sampledFrameDiffs: {JSON.stringify(result.debugProof?.sampledFrameDiffs ?? [])}</p>
                  <p className="text-[10px] text-white/35 break-all">visibleChangeDetected: {String(result.debugProof?.visibleChangeDetected ?? false)}</p>
                </div>
                {Number(result.debugProof?.averagePixelDifferencePercent ?? 0) > 28 ? (
                  <div className="border border-amber-400/25 bg-amber-400/10 rounded-2xl p-3">
                    <p className="text-xs text-amber-200/90">Color match is very strong and may look unnatural.</p>
                  </div>
                ) : null}
                {result.renderId && (
                  <div className="border border-amber-400/15 bg-amber-400/5 rounded-2xl p-4 space-y-1.5">
                    <p className="text-[11px] text-amber-200/80 uppercase tracking-widest">Render debug proof</p>
                    <p className="text-[10px] text-white/35 break-all">selectedMode: {result.selectedMode ?? result.mode}</p>
                    <p className="text-[10px] text-white/35 break-all">selectedRoute: {result.selectedRoute}</p>
                    <p className="text-[10px] text-white/35 break-all">selectedEngine: {result.selectedEngine}</p>
                    <p className="text-[10px] text-white/35 break-all">selectedPreset: {result.selectedPreset ?? result.analysis?.selectedStrength}</p>
                    <p className="text-[10px] text-white/35 break-all">inputVideoUrl: {result.inputVideoUrl}</p>
                    <p className="text-[10px] text-white/35 break-all">referenceUrl: {result.referenceUrl}</p>
                    <p className="text-[10px] text-white/35 break-all">outputUrl: {result.outputUrl ?? result.videoUrl}</p>
                    <p className="text-[10px] text-white/35 break-all">renderId: {result.renderId}</p>
                    <p className="text-[10px] text-white/35 break-all">renderStartedAt: {result.renderStartedAt}</p>
                    <p className="text-[10px] text-white/35 break-all">targetAverageRGB: {JSON.stringify(result.targetAverageRGB)}</p>
                    <p className="text-[10px] text-white/35 break-all">referenceAverageRGB: {JSON.stringify(result.referenceAverageRGB)}</p>
                    <p className="text-[10px] text-white/35 break-all">outputAverageRGB: {JSON.stringify(result.outputAverageRGB)}</p>
                    <p className="text-[10px] text-white/35 break-all">yellowDifference: {String(result.yellowDifference)}</p>
                    <p className="text-[10px] text-white/35 break-all">filterApplied: {String(result.filterApplied)}</p>
                    <p className="text-[10px] text-white/35 break-all">cacheBuster: {String(result.cacheBuster)}</p>
                    <p className="text-[10px] text-white/25 break-all">ffmpegCommand: {result.ffmpegCommand}</p>
                    <p className="text-[10px] text-white/25 break-all">finalFFmpegFilter: {result.finalFFmpegFilter ?? result.finalFilter}</p>
                  </div>
                )}
                {finalRenderPayload && (
                  <div className="border border-cyan-400/20 bg-cyan-400/5 rounded-2xl p-4 space-y-1.5">
                    <p className="text-[11px] text-cyan-200/80 uppercase tracking-widest">Final render payload</p>
                    <p className="text-[10px] text-white/40 break-all">selectedMode: {finalRenderPayload.selectedMode}</p>
                    <p className="text-[10px] text-white/40 break-all">selectedRoute: {finalRenderPayload.selectedRoute}</p>
                    <p className="text-[10px] text-white/40 break-all">selectedEngine: {finalRenderPayload.selectedEngine}</p>
                    <p className="text-[10px] text-white/40 break-all">inputVideoUrl: {finalRenderPayload.inputVideoUrl}</p>
                    <p className="text-[10px] text-white/40 break-all">referenceUrl: {finalRenderPayload.referenceUrl}</p>
                    <p className="text-[10px] text-white/40 break-all">prompt: {finalRenderPayload.prompt}</p>
                  </div>
                )}
                {result.previewUrl && (
                  <div className="border border-white/8 rounded-2xl p-4">
                    <p className="text-[11px] text-white/30 uppercase tracking-widest mb-2.5">AI-generated reference frame</p>
                    <img src={result.previewUrl} alt="AI transfer preview" className="w-full rounded-lg border border-white/5" />
                    <p className="text-[10px] text-white/20 mt-2.5">Locked reference color transform guidance applied to your target video.</p>
                  </div>
                )}
                {result.aiVideoModelUsed === false && (
                  <div className="border border-emerald-400/15 bg-emerald-400/5 rounded-2xl p-4">
                    <p className="text-xs text-emerald-300 font-medium mb-1">Fallback output detected.</p>
                    <p className="text-[11px] text-white/30">
                      This request is configured for locked reference color transfer. If you see this, verify source/reference media inputs.
                    </p>
                  </div>
                )}
                {result.selectedRoute && (
                  <div className="border border-white/10 bg-white/[0.02] rounded-2xl p-4">
                    <p className="text-xs text-white/70">
                      {result.selectedRoute === "/api/render/production"
                        ? `${referenceTransferEngineLabel(result.selectedEngine)} active.`
                        : ""}
                    </p>
                  </div>
                )}
                {result.finalOutputUrl ? (
                  <a href={result.finalOutputUrl} download className="block">
                    <Button variant="outline" className="w-full border-white/10 text-white/50 hover:text-white hover:border-white/25 hover:bg-white/5 rounded-full">
                      Download video
                    </Button>
                  </a>
                ) : null}
                <button onClick={reset} className="w-full text-xs text-white/20 hover:text-white/40 transition-colors py-2">
                  New render
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/8 aspect-video flex flex-col items-center justify-center text-center p-10 gap-6">
                <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center">
                  <Film className="w-7 h-7 text-white/15" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/25 mb-1">Result appears here</p>
                  <p className="text-xs text-white/15">Drop a video + reference and describe what to transfer</p>
                </div>
                <div className="text-[11px] text-white/15 space-y-1.5 text-left w-full max-w-xs">
                  <p className="text-white/25 font-medium mb-2">Examples</p>
                  <p>• "the warm color grade"</p>
                  <p>• "the moody lighting and shadows"</p>
                  <p>• "the cinematic film look"</p>
                  <p>• "the lamp and warm glow on the desk"</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
