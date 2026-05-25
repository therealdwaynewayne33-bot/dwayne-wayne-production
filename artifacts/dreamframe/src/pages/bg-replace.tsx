import { useState, useRef, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Sparkles, Layers, Play, Pause, RotateCcw, Volume2, VolumeX,
  CheckCircle2, X, ShieldCheck, Wand2,
  AlertTriangle,
} from "lucide-react";
import { describeFetchFailure } from "@workspace/api-client-react";

const OBJECT_MASK_ENGINE_WARNING =
  "Object masking engine not connected. This will not change only one object until SAM/object masking is installed.";

type ObjectMaskEngineMode = "GEOMETRIC" | "SAM2";

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
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
        <video ref={ref} src={src} poster={thumbnail} className="w-full h-full object-contain" playsInline
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

type Stage = "idle" | "processing" | "done" | "error";

type BgResult = {
  videoUrl: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  lumaUrl?: string;
  faceLocked?: boolean;
  selectedMode?: string;
  selectedRoute?: string;
  selectedEngine?: string;
  renderMode?: string;
  selectedObject?: string;
  requestedEdit?: string;
  protectedMask?: string;
  editMask?: string;
  renderProof?: {
    selectedMode: string;
    selectedRoute: string;
    selectedEngine: string;
    realAiCalled: boolean;
    inputVideoUrlPresent: boolean;
    inputImageUrlPresent: boolean;
    faceLockActive: boolean;
    backgroundReplaceActive: boolean;
    objectEditActive: boolean;
    colorGradeActive: boolean;
    finalOutputUrlPresent: boolean;
    errorMessage: string;
  };
  kontextColorUrl?: string;
  kontextError?: string;
  kontextCreditsCharged?: number;
  kontextCreditsRemaining?: number;
  inputVideoUrl?: string | null;
  colorPromptApplied?: string;
  cinematicStylePreset?: string;
  cinematicStyleLabel?: string;
  pipelineWarnings?: string[];
  replicateColorDebug?: {
    model?: string;
    replicateOutputUrl?: string;
    bgInputMethod?: string;
    bgPresetId?: string;
    referenceImageUrl?: string | null;
    prompt?: string;
    aspectRatio?: string;
    seed?: number;
    replicateInput?: Record<string, unknown>;
    errorMessage?: string;
  };
};

type RenderMode = "background_replace" | "character_lock" | "clothes_change" | "color_grade" | "object_edit";

const BG_PRESERVE_SUFFIX =
  " Keep the person, their face, clothing and all movement exactly the same.";

const BG_REFERENCE_DEFAULT_PROMPT =
  `Replace the background to match this reference image.${BG_PRESERVE_SUFFIX}`;

type BgPresetId =
  | "luxury_mansion"
  | "beach_sunset"
  | "nyc_rooftop"
  | "studio_black"
  | "studio_white"
  | "mountain_peak"
  | "private_jet"
  | "music_studio";

type BgInputMethod = "preset" | "custom" | "reference";

const BG_PRESET_BACKGROUNDS: Array<{
  id: BgPresetId;
  label: string;
  thumbClass: string;
  prompt: string;
}> = [
  {
    id: "luxury_mansion",
    label: "Luxury Mansion",
    thumbClass: "bg-gradient-to-br from-amber-900 via-stone-700 to-yellow-900/80",
    prompt:
      "Replace the background with an elegant luxury mansion living room with marble floors, large chandelier, modern furniture, soft warm lighting. Keep the person, their face, clothing and all movement exactly the same.",
  },
  {
    id: "beach_sunset",
    label: "Beach Sunset",
    thumbClass: "bg-gradient-to-br from-orange-500 via-rose-400 to-teal-600",
    prompt:
      "Replace the background with a tropical beach at golden hour sunset, palm trees, ocean waves, soft warm light. Keep the person, their face, clothing and all movement exactly the same.",
  },
  {
    id: "nyc_rooftop",
    label: "NYC Rooftop",
    thumbClass: "bg-gradient-to-br from-slate-950 via-indigo-950 to-amber-500/40",
    prompt:
      "Replace the background with a New York City rooftop at night, skyline lights, urban dramatic atmosphere. Keep the person, their face, clothing and all movement exactly the same.",
  },
  {
    id: "studio_black",
    label: "Studio (Black BG)",
    thumbClass: "bg-gradient-to-br from-zinc-900 via-black to-zinc-800",
    prompt:
      "Replace the background with a professional photography studio, solid black backdrop, dramatic studio lighting. Keep the person, their face, clothing and all movement exactly the same.",
  },
  {
    id: "studio_white",
    label: "Studio (White BG)",
    thumbClass: "bg-gradient-to-br from-white via-zinc-100 to-zinc-300",
    prompt:
      "Replace the background with a professional photography studio, solid white backdrop, soft even lighting. Keep the person, their face, clothing and all movement exactly the same.",
  },
  {
    id: "mountain_peak",
    label: "Mountain Peak",
    thumbClass: "bg-gradient-to-br from-sky-400 via-orange-300 to-slate-700",
    prompt:
      "Replace the background with a stunning mountain peak vista at sunrise, dramatic clouds, epic landscape. Keep the person, their face, clothing and all movement exactly the same.",
  },
  {
    id: "private_jet",
    label: "Private Jet",
    thumbClass: "bg-gradient-to-br from-stone-800 via-amber-950 to-zinc-900",
    prompt:
      "Replace the background with the interior of a luxury private jet, leather seats, ambient lighting, premium cabin. Keep the person, their face, clothing and all movement exactly the same.",
  },
  {
    id: "music_studio",
    label: "Music Studio",
    thumbClass: "bg-gradient-to-br from-violet-900 via-indigo-900 to-fuchsia-800",
    prompt:
      "Replace the background with a professional recording studio, mixing console, ambient purple/blue lighting, vinyl records on the wall. Keep the person, their face, clothing and all movement exactly the same.",
  },
];

export default function BgReplacePage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [bgPrompt, setBgPrompt] = useState("");
  const [mode, setMode] = useState<RenderMode>("background_replace");
  const [bgInputMethod, setBgInputMethod] = useState<BgInputMethod | null>(null);
  const [selectedBgPreset, setSelectedBgPreset] = useState<BgPresetId | null>(null);
  const [customBgPrompt, setCustomBgPrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const [refDragging, setRefDragging] = useState(false);
  const refFileRef = useRef<HTMLInputElement>(null);
  const [selectedObject, setSelectedObject] = useState<string>("");
  const [objectAnchor, setObjectAnchor] = useState<{ x: number; y: number } | null>(null);
  const [maskRadius, setMaskRadius] = useState(0.16);
  const [maskEngineWarning, setMaskEngineWarning] = useState<string | null>(OBJECT_MASK_ENGINE_WARNING);
  const objectMaskEngineRef = useRef<ObjectMaskEngineMode>("GEOMETRIC");
  const [objectMaskEngine, setObjectMaskEngine] = useState<ObjectMaskEngineMode>("GEOMETRIC");
  const [segmentTrackJobId, setSegmentTrackJobId] = useState<string | null>(null);
  const [segmentTrackBusy, setSegmentTrackBusy] = useState(false);
  const [segmentTrackError, setSegmentTrackError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<BgResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [replicateTokenMissing, setReplicateTokenMissing] = useState(false);
  // BASELINE: Real AI toggle disconnected — always local.
  const realAiMode = false;
  const setRealAiMode = (_value: boolean | ((prev: boolean) => boolean)) => {};
  const [dragging, setDragging] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [clipDuration, setClipDuration] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/render/targeted-mask-status")
      .then((r) => r.json())
      .then(
        (data: {
          fullyConnected?: boolean;
          clientWarnings?: string[];
          objectMaskEngine?: ObjectMaskEngineMode;
          replicateConfigured?: boolean;
        }) => {
          if (cancelled) return;
          const engine: ObjectMaskEngineMode = data?.objectMaskEngine === "SAM2" ? "SAM2" : "GEOMETRIC";
          objectMaskEngineRef.current = engine;
          setObjectMaskEngine(engine);
          if (engine === "SAM2" && data?.replicateConfigured) {
            setMaskEngineWarning(null);
          } else if (data?.fullyConnected) setMaskEngineWarning(null);
          else if (Array.isArray(data?.clientWarnings) && data.clientWarnings[0])
            setMaskEngineWarning(data.clientWarnings[0]);
          else setMaskEngineWarning(OBJECT_MASK_ENGINE_WARNING);
        },
      )
      .catch(() => {
        if (!cancelled) setMaskEngineWarning(OBJECT_MASK_ENGINE_WARNING);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollJobStatus = useCallback(
    (jobId: string) => {
      stopPolling();
      const token = localStorage.getItem("dreamframe_token");
      const pollOnce = async () => {
        try {
          const resp = await fetch(`/api/render/status?jobId=${encodeURIComponent(jobId)}`, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const raw = await resp.text();
          let data: Record<string, unknown> = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            return;
          }
          if (!resp.ok) return;

          const msg = typeof data.progressMessage === "string" ? data.progressMessage : "";
          if (msg) setProgressMessage(msg);

          const status = typeof data.status === "string" ? data.status : "";
          if (status === "done") {
            stopPolling();
            setActiveJobId(null);
            setResult(data as BgResult);
            setStage("done");
            setReplicateTokenMissing(false);
            return;
          }
          if (status === "failed" || status === "cancelled") {
            stopPolling();
            setActiveJobId(null);
            const errMsg =
              typeof data.error === "string" ? data.error : status === "cancelled" ? "Render cancelled." : "Render failed.";
            setError(errMsg);
            setStage("error");
          }
        } catch {
          /* keep polling */
        }
      };

      void pollOnce();
      pollRef.current = setInterval(() => void pollOnce(), 2000);
    },
    [stopPolling],
  );

  const handleCancelRender = async () => {
    stopPolling();
    const token = localStorage.getItem("dreamframe_token");
    if (activeJobId) {
      try {
        await fetch("/api/render/cancel", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ jobId: activeJobId }),
        });
      } catch {
        /* ignore */
      }
    }
    setActiveJobId(null);
    setProgressMessage("");
    setStage("idle");
    setError(null);
  };

  const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"];
  const isVideoFile = (f: File) => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    // For local Windows dev, browsers sometimes provide empty/odd MIME types.
    // Treat these extensions as authoritative.
    return f.type.startsWith("video/") || VIDEO_EXTS.includes(ext);
  };

  const handleFile = (f: File) => {
    console.log("[BG Replace] file.name", f.name);
    console.log("[BG Replace] file.type", f.type);
    console.log("[BG Replace] file.size", f.size);

    if (!isVideoFile(f)) { toast({ title: "Please upload a video file (MP4, MOV, WebM…)", variant: "destructive" }); return; }
    if (f.size > 100 * 1024 * 1024) { toast({ title: "Video must be under 100 MB (Wayne Cinema limit)", variant: "destructive" }); return; }
    const url = URL.createObjectURL(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setFile(f);
    setClipDuration(null);
    setResult(null);
    setError(null);
    setStage("idle");
    setSegmentTrackJobId(null);
    setSegmentTrackBusy(false);
    setSegmentTrackError(null);

    // Probe duration for display in the upload preview.
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      const d = probe.duration;
      if (Number.isFinite(d) && d > 0) setClipDuration(d);
      probe.removeAttribute("src");
      probe.load();
    };
    probe.onerror = () => {
      // Don't block uploads if metadata probing fails.
      console.log("[BG Replace] metadata probe failed");
      probe.removeAttribute("src");
      probe.load();
    };
    probe.src = url;
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const IMAGE_EXTS_REF = [".jpg", ".jpeg", ".png", ".webp"];
  const isReferenceImage = (f: File) => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    return f.type.startsWith("image/") || IMAGE_EXTS_REF.includes(ext);
  };

  const handleReferenceImage = (f: File) => {
    if (!isReferenceImage(f)) {
      toast({ title: "Please upload JPG, PNG, or WebP", variant: "destructive" });
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: "Reference image must be under 10 MB", variant: "destructive" });
      return;
    }
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceImage(f);
    setReferencePreviewUrl(URL.createObjectURL(f));
    setBgInputMethod("reference");
    setSelectedBgPreset(null);
    setCustomBgPrompt("");
  };

  const clearReferenceImage = () => {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceImage(null);
    setReferencePreviewUrl(null);
    if (bgInputMethod === "reference") setBgInputMethod(null);
  };

  const selectBgPreset = (preset: (typeof BG_PRESET_BACKGROUNDS)[number]) => {
    setBgInputMethod("preset");
    setSelectedBgPreset(preset.id);
    setCustomBgPrompt("");
    clearReferenceImage();
  };

  const buildBackgroundPrompt = (): string | null => {
    if (bgInputMethod === "preset" && selectedBgPreset) {
      return BG_PRESET_BACKGROUNDS.find((p) => p.id === selectedBgPreset)?.prompt ?? null;
    }
    if (bgInputMethod === "custom") {
      const trimmed = customBgPrompt.trim();
      if (!trimmed) return null;
      if (/keep the person/i.test(trimmed)) return trimmed;
      return `${trimmed}${BG_PRESERVE_SUFFIX}`;
    }
    if (bgInputMethod === "reference" && referenceImage) {
      const trimmed = customBgPrompt.trim();
      if (trimmed) {
        if (/keep the person/i.test(trimmed)) return trimmed;
        return `${trimmed}${BG_PRESERVE_SUFFIX}`;
      }
      return BG_REFERENCE_DEFAULT_PROMPT;
    }
    return null;
  };

  const canSubmitBgReplace = Boolean(file && bgInputMethod && buildBackgroundPrompt());

  const handleSubmit = async () => {
    if (!file) { toast({ title: "Upload a video first", variant: "destructive" }); return; }

    if (mode !== "background_replace") {
      toast({
        title: "This mode is disabled during rebuild",
        description: "Only Background Replace is active right now.",
        variant: "destructive",
      });
      return;
    }

    const backgroundPrompt = buildBackgroundPrompt();
    if (!backgroundPrompt || !bgInputMethod) {
      toast({
        title: "Choose a background method",
        description: "Pick a preset, enter a custom prompt, or upload a reference image.",
        variant: "destructive",
      });
      return;
    }

    setStage("processing");
    setError(null);
    setReplicateTokenMissing(false);
    setProgressMessage("Runway Aleph is re-rendering your scene…");
    setActiveJobId(null);
    stopPolling();

    const form = new FormData();
    form.append("video", file);
    form.append("selectedMode", "background_replace");
    form.append("backgroundPrompt", backgroundPrompt);
    form.append("bgInputMethod", bgInputMethod);
    if (selectedBgPreset) form.append("bgPresetId", selectedBgPreset);
    if (bgInputMethod === "reference" && referenceImage) {
      form.append("reference", referenceImage);
    }

    const token = localStorage.getItem("dreamframe_token");
    const route = "/api/render/production";
    try {
      const resp = await fetch(route, {
        method: "POST",
        body: form,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const raw = await resp.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (e: any) {
        console.log("[BG Replace] response JSON parse failed:", e?.message ?? e);
        console.log("[BG Replace] raw response:", raw);
      }
      if (!resp.ok) {
        console.log("[BG Replace] backend error:", data?.error ?? raw);
        if (typeof data?.error === "string" && data.error.includes("REPLICATE_API_TOKEN")) {
          setReplicateTokenMissing(true);
        }
        throw new Error(data?.error ?? raw ?? "Unknown error");
      }

      setResult(data);
      setStage("done");
      setReplicateTokenMissing(false);
    } catch (err: any) {
    console.log("[BG Replace] submit error:", err?.message ?? err);
    if (err instanceof Error && err.message.includes("REPLICATE_API_TOKEN")) {
      setReplicateTokenMissing(true);
    }
    setError(describeFetchFailure(err instanceof Error ? err : new Error(String(err?.message ?? err))));
    setStage("error");
    }
  };

  const handleFixFace = async () => {
    if (!result?.lumaUrl || !result?.sourceUrl) {
      toast({ title: "Missing source video for face fix", variant: "destructive" });
      return;
    }
    setFixing(true);
    setError(null);
    const token = localStorage.getItem("dreamframe_token");
    try {
      const resp = await fetch("/api/render/production", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          selectedMode: "face_swap",
          targetVideoUrl: result.lumaUrl,
          faceSourceUrl: result.sourceUrl,
        }),
      });
      const rawFix = await resp.text();
      let data: { error?: string; videoUrl?: string; thumbnailUrl?: string } = {};
      try {
        data = rawFix ? JSON.parse(rawFix) : {};
      } catch {
        throw new Error(rawFix.trim() ? rawFix.slice(0, 400) : `Face fix failed (${resp.status})`);
      }
      if (!resp.ok) throw new Error(typeof data?.error === "string" ? data.error : "Face fix failed");
      setResult({
        ...result,
        videoUrl: data.videoUrl ?? result.videoUrl,
        thumbnailUrl: data.thumbnailUrl ?? result.thumbnailUrl,
        faceLocked: true,
      });
      toast({ title: "Face locked back on", description: "Your original face is now stamped on the render." });
    } catch (err: any) {
      setError(describeFetchFailure(err instanceof Error ? err : new Error(String(err?.message ?? err))));
    } finally {
      setFixing(false);
    }
  };

  const reset = () => {
    stopPolling();
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResult(null); setError(null);
    setStage("idle"); setBgPrompt(""); setClipDuration(null);
    setProgressMessage("");
    setActiveJobId(null);
    setSelectedObject("");
    setObjectAnchor(null);
    setMaskRadius(0.16);
    setSegmentTrackJobId(null);
    setSegmentTrackBusy(false);
    setSegmentTrackError(null);
    setBgInputMethod(null);
    setSelectedBgPreset(null);
    setCustomBgPrompt("");
    clearReferenceImage();
  };

  const runSegmentTrack = async (vid: HTMLVideoElement, nx: number, ny: number) => {
    if (!file || objectMaskEngineRef.current !== "SAM2") return;
    setSegmentTrackBusy(true);
    setSegmentTrackError(null);
    setSegmentTrackJobId(null);
    const token = localStorage.getItem("dreamframe_token");
    const fd = new FormData();
    fd.append("video", file);
    fd.append("objectX", String(nx));
    fd.append("objectY", String(ny));
    fd.append("clickTimeSeconds", String(vid.currentTime));
    try {
      const resp = await fetch("/api/ai/segment-track", {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const raw = await resp.text();
      let data: { jobId?: string; error?: string; code?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(raw.trim().slice(0, 200) || `segment-track failed (${resp.status})`);
      }
      if (!resp.ok) {
        if (data?.code === "SAM2_DISABLED") return;
        throw new Error(typeof data?.error === "string" ? data.error : `segment-track failed (${resp.status})`);
      }
      if (typeof data.jobId === "string") {
        setSegmentTrackJobId(data.jobId);
        toast({ title: "Object tracked", description: "SAM2 mask spans the full video for your edit." });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSegmentTrackError(msg);
      toast({ title: "Tracking failed", description: msg, variant: "destructive" });
    } finally {
      setSegmentTrackBusy(false);
    }
  };

  const pickObjectAnchor = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (mode !== "object_edit") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const nx = Math.max(0, Math.min(1, x));
    const ny = Math.max(0, Math.min(1, y));
    setObjectAnchor({ x: nx, y: ny });
    void runSegmentTrack(e.currentTarget, nx, ny);
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-8 py-14">
        {/* Header */}
        <div className="mb-12">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Background Replace · Runway Gen-4 Aleph</p>
          <h1 className="text-4xl font-semibold text-white tracking-tight">Background Replace</h1>
          <p className="text-sm text-white/30 mt-2">
            Upload a video and describe a new background — Runway Gen-4 Aleph re-renders the scene from your preset, prompt, or reference image.
          </p>
          {mode !== "background_replace" && (
            <p className="text-xs text-amber-300/80 mt-3">
              Other modes are disabled during rebuild. Background Replace is active.
            </p>
          )}
        </div>

        {mode === "object_edit" && objectMaskEngine === "GEOMETRIC" && maskEngineWarning ? (
          <Alert
            className="mb-8 border-amber-500/45 bg-amber-950/35 text-amber-50 [&>svg]:text-amber-400"
            variant="default"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-amber-50/95">{maskEngineWarning}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left: inputs */}
          <div className="space-y-7">
            {/* Drop zone */}
            <div>
              <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">Your video</p>
              <div
                data-testid="drop-zone-video"
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => !file && fileRef.current?.click()}
                className={cn("relative rounded-2xl border-2 border-dashed transition-all overflow-hidden",
                  dragging ? "border-white/40 bg-white/5" : file ? "border-white/15 cursor-default" : "border-white/10 hover:border-white/25 cursor-pointer",
                  file ? "aspect-video" : "py-16"
                )}>
                {file && previewUrl ? (
                  <>
                    <video src={previewUrl} className="w-full h-full object-contain bg-black" muted onClick={pickObjectAnchor} />
                    <button onClick={(e) => { e.stopPropagation(); reset(); }}
                      className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/80 hover:bg-black flex items-center justify-center text-white transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                    {clipDuration ? (
                      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-medium">
                        {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB · {clipDuration.toFixed(1)}s
                      </div>
                    ) : (
                      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-medium">
                        {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                      </div>
                    )}
                    {mode === "object_edit" && objectMaskEngine === "SAM2" && (
                      <div className="absolute top-14 left-3 max-w-[70%] px-2.5 py-1 rounded-full bg-cyan-950/85 border border-cyan-500/35 text-cyan-100 text-[10px] font-medium leading-snug">
                        {segmentTrackBusy
                          ? "SAM2 tracking…"
                          : segmentTrackJobId
                            ? "SAM2 mask ready — you can render."
                            : "SAM2: click the object to track the full video."}
                      </div>
                    )}
                    {mode === "object_edit" && objectMaskEngine === "SAM2" && segmentTrackError ? (
                      <div className="absolute bottom-14 left-3 right-3 px-2 py-1 rounded-md bg-red-950/80 border border-red-500/40 text-red-100 text-[10px]">
                        {segmentTrackError}
                      </div>
                    ) : null}
                    {mode === "object_edit" && objectAnchor && (
                      <div
                        className="absolute w-4 h-4 rounded-full border border-cyan-300 bg-cyan-300/30 pointer-events-none"
                        style={{
                          left: `calc(${(objectAnchor.x * 100).toFixed(2)}% - 8px)`,
                          top: `calc(${(objectAnchor.y * 100).toFixed(2)}% - 8px)`,
                        }}
                      />
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4 text-center px-6">
                    <div className="w-12 h-12 rounded-full bg-white/6 flex items-center justify-center">
                      <Upload className={cn("w-5 h-5", dragging ? "text-white/70" : "text-white/25")} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white/50">Drop your video here</p>
                      <p className="text-xs text-white/20 mt-1">MP4, MOV, WebM · up to 100 MB</p>
                    </div>
                    <button onClick={() => fileRef.current?.click()}
                      className="text-xs text-white/40 hover:text-white transition-colors font-medium">Browse file</button>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="video/*,.mp4,.mov,.webm,.avi,.mkv,.m4v,.3gp" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </div>
            </div>

            {/* Background Replace — Runway Gen-4 Aleph via Replicate */}
            {mode === "background_replace" && (
              <div className="rounded-2xl border border-cyan-500/25 bg-cyan-950/20 px-4 py-3 space-y-4">
                <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-100">
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                  <AlertDescription className="text-xs leading-relaxed">
                    ⚠️ Each render costs ~$1.60 (Runway Gen-4 Aleph, up to 9 seconds of video)
                  </AlertDescription>
                </Alert>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.5em] text-cyan-300/70">Background Replace</p>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200 mt-1">
                    Runway Gen-4 Aleph · video-to-video
                  </p>
                  <p className="text-[11px] text-white/45 mt-1">
                    Pick one method below — preset, custom prompt, or reference image.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] text-white/40 uppercase tracking-widest">Preset backgrounds</p>
                  <div className="grid grid-cols-2 gap-2">
                    {BG_PRESET_BACKGROUNDS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => selectBgPreset(preset)}
                        className={cn(
                          "rounded-xl border overflow-hidden text-left transition-all",
                          bgInputMethod === "preset" && selectedBgPreset === preset.id
                            ? "border-cyan-400/50 ring-1 ring-cyan-400/30"
                            : "border-white/10 hover:border-white/25",
                        )}
                      >
                        <div className={cn("aspect-video w-full bg-black/40 overflow-hidden", preset.thumbClass)}>
                          <img
                            src={`/api/bg-presets/${preset.id}.jpg`}
                            alt={preset.label}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <p className="text-[11px] font-medium text-white/85 px-2 py-1.5">{preset.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] text-white/40 uppercase tracking-widest">Describe your background</label>
                  <textarea
                    value={customBgPrompt}
                    onChange={(e) => {
                      setCustomBgPrompt(e.target.value);
                      if (referenceImage) {
                        setBgInputMethod("reference");
                        setSelectedBgPreset(null);
                      } else {
                        setBgInputMethod("custom");
                        setSelectedBgPreset(null);
                      }
                    }}
                    placeholder="e.g., 'Replace background with a Lamborghini showroom, polished floors, bright modern lighting'"
                    rows={3}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-400/40"
                  />
                  <p className="text-[10px] text-white/25">
                    We auto-append: &quot;Keep the person, their face, clothing and all movement exactly the same.&quot;
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] text-white/40 uppercase tracking-widest">
                    Or upload a reference image of the background you want
                  </p>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setRefDragging(true); }}
                    onDragLeave={() => setRefDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setRefDragging(false);
                      const f = e.dataTransfer.files[0];
                      if (f) handleReferenceImage(f);
                    }}
                    onClick={() => !referenceImage && refFileRef.current?.click()}
                    className={cn(
                      "relative rounded-xl border-2 border-dashed transition-all overflow-hidden",
                      refDragging ? "border-cyan-400/50 bg-cyan-400/5" : "border-white/10",
                      referenceImage ? "cursor-default" : "cursor-pointer hover:border-white/25",
                    )}
                  >
                    {referenceImage && referencePreviewUrl ? (
                      <div className="relative aspect-video">
                        <img src={referencePreviewUrl} alt="Reference background" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); clearReferenceImage(); }}
                          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/80 hover:bg-black flex items-center justify-center text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-full bg-black/70 text-[10px] text-white">
                          {referenceImage.name}
                        </div>
                      </div>
                    ) : (
                      <div className="py-8 flex flex-col items-center gap-2 text-center px-4">
                        <Upload className="w-5 h-5 text-white/30" />
                        <p className="text-xs text-white/45">Drag & drop JPG, PNG, or WebP</p>
                        <p className="text-[10px] text-white/25">Up to 10 MB</p>
                      </div>
                    )}
                    <input
                      ref={refFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleReferenceImage(e.target.files[0])}
                    />
                  </div>
                  {bgInputMethod === "reference" && (
                    <p className="text-[10px] text-white/30">
                      Optional: add a custom prompt above to refine the reference-based background.
                    </p>
                  )}
                </div>
              </div>
            )}

            {mode === "color_grade" && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center">
                <p className="text-sm text-amber-200/90 font-medium">Mode disabled during rebuild</p>
                <p className="text-xs text-white/35 mt-2">Color Grade is paused. Use Background Replace.</p>
              </div>
            )}

            <div>
              <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">Mode</p>
              <div className="grid grid-cols-1 gap-2 mb-4">
                {[
                  { id: "character_lock" as const, title: "Character Lock", desc: "Protect full person. Only requested non-character areas should change." },
                  { id: "object_edit" as const, title: "Object Edit", desc: "Mask + composite: only the anchored region changes; video is not fully regenerated." },
                  { id: "clothes_change" as const, title: "Clothes Change", desc: "Modify clothing area only while preserving face/body/background." },
                  { id: "background_replace" as const, title: "Background Replace", desc: "Modify background scene while preserving subject motion." },
                  { id: "color_grade" as const, title: "Color Grade", desc: "Apply color/lighting grade without changing person or scene layout." },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (m.id !== "background_replace") {
                        toast({
                          title: "Mode disabled during rebuild",
                          description: m.id === "color_grade"
                            ? "Color Grade is paused. Background Replace is active."
                            : "Only Background Replace is active right now.",
                          variant: "destructive",
                        });
                        return;
                      }
                      setMode(m.id);
                    }}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition-all",
                      mode === m.id ? "border-white/40 bg-white/10" : "border-white/8 hover:border-white/20",
                      m.id !== "background_replace" && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    <p className={cn("text-xs font-medium", mode === m.id ? "text-white" : "text-white/45")}>{m.title}</p>
                    <p className="text-[10px] text-white/25 mt-1">{m.desc}</p>
                    {m.id === "color_grade" && (
                      <p className="text-[10px] text-amber-300/70 mt-1">Mode disabled during rebuild</p>
                    )}
                  </button>
                ))}
              </div>

              {mode !== "background_replace" && (
              <>
              <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">Describe the new scene</p>
              <Input data-testid="input-bg-prompt"
                placeholder='e.g. "Place the subject on a tropical beach at sunset"'
                value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus-visible:ring-white/20 mb-2" />
              <p className="text-[11px] text-white/20 mb-3">
                {mode === "character_lock"
                  ? "Character protected. No full-scene regeneration."
                  : mode === "object_edit"
                  ? "Uses FFmpeg masked composite — click optional (defaults to center). Describe color/remove/replace in the prompt."
                  : mode === "clothes_change"
                    ? "Only clothing region should be changed from your prompt."
                    : mode === "color_grade"
                      ? "Color/lighting grade only. Person and scene geometry are preserved."
                    : "Wayne Cinema re-renders the whole scene from this prompt while keeping your motion intact"}
              </p>
              </>
              )}
              {mode === "object_edit" && (
                <div className="mb-3 space-y-2">
                  <p className="text-[10px] text-white/30 uppercase tracking-widest">Select object</p>
                  <div className="flex flex-wrap gap-2">
                    {["couch", "chair", "table", "lamp", "wall"].map((obj) => (
                      <button
                        key={obj}
                        type="button"
                        onClick={() => setSelectedObject(obj)}
                        className={cn(
                          "text-xs px-3 py-1.5 rounded-full border transition-all",
                          selectedObject === obj
                            ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-200"
                            : "border-white/10 text-white/45 hover:border-white/25 hover:text-white/70",
                        )}
                      >
                        {obj}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/30">
                    Optional: click the video to anchor the mask. Otherwise the edit centers on frame — adjust radius below.
                  </p>
                  <label className="flex flex-col gap-1 text-[11px] text-white/40 pt-2">
                    <span className="text-white/50">Mask radius ({maskRadius.toFixed(2)})</span>
                    <input
                      type="range"
                      min={0.08}
                      max={0.4}
                      step={0.01}
                      value={maskRadius}
                      onChange={(e) => setMaskRadius(Number(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Submit */}
            <Button data-testid="button-replace-bg" onClick={handleSubmit}
              disabled={!canSubmitBgReplace || stage === "processing"}
              className="w-full bg-white text-black hover:bg-white/90 font-semibold gap-2 h-11 rounded-full">
              {stage === "processing" ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                  {progressMessage || "Runway Aleph is re-rendering your scene…"}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Replace Background with Runway
                </>
              )}
            </Button>

            {stage === "processing" && mode === "background_replace" && (
              <div className="border border-white/8 rounded-2xl p-5 space-y-4">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Pipeline</p>
                {[
                  "Uploading your video",
                  "Runway Gen-4 Aleph re-rendering the scene",
                  "Encoding final video",
                ].map((step, i) => (
                  <div key={step} className="flex items-center gap-3">
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", i < 2 ? "bg-white animate-pulse" : "bg-white/15")} />
                    <span className="text-xs text-white/40">{step}</span>
                  </div>
                ))}
                <p className="text-[11px] text-white/20 pt-1">
                  Takes about 2–4 minutes — Runway renders on Replicate
                </p>
              </div>
            )}

            {stage === "processing" && mode !== "background_replace" && (
              <div className="border border-white/8 rounded-2xl p-5 space-y-4">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Pipeline</p>
                {[
                  "Uploading your video",
                  "Wayne Cinema Ray-2 re-rendering the scene",
                  "Encoding final video",
                ].map((step, i) => (
                  <div key={step} className="flex items-center gap-3">
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", i < 2 ? "bg-white animate-pulse" : "bg-white/15")} />
                    <span className="text-xs text-white/40">{step}</span>
                  </div>
                ))}
                <p className="text-[11px] text-white/20 pt-1">
                  Takes about 3–4 minutes — Wayne Cinema renders in the cloud
                </p>
              </div>
            )}

            {error && (
              <div className="border border-red-500/20 bg-red-500/5 rounded-2xl p-4 text-sm text-red-400">
                {error}
              </div>
            )}
          </div>

          {/* Right: result */}
          <div>
          {stage === "done" && result ? (
            <div className="space-y-5">
              {/* Replicate token missing alert */}
              {replicateTokenMissing && (
                <Alert variant="destructive" className="px-4 py-3 text-xs">
                  <AlertDescription>
                    Background replace requires <span className="font-bold">REPLICATE_API_TOKEN</span> in{" "}
                    <span className="font-bold">.env.local</span>. Add your token and restart the API server.
                  </AlertDescription>
                </Alert>
              )}
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-white/60">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{mode === "background_replace" ? "Background replaced" : "Scene re-rendered"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.faceLocked && (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80 bg-emerald-400/5 px-2.5 py-1 rounded-full border border-emerald-400/15">
                        <ShieldCheck className="w-3 h-3" />
                        <span>Face locked</span>
                      </div>
                    )}
                  </div>
                </div>
                {(result.selectedMode || result.renderProof) && (
                  <div className="border border-amber-400/15 bg-amber-400/5 rounded-2xl p-4 space-y-1.5">
                    <p className="text-[11px] text-amber-200/80 uppercase tracking-widest">Render debug proof</p>
                    <p className="text-[10px] text-white/35 break-all">selectedMode: {result.renderProof?.selectedMode ?? result.selectedMode}</p>
                    <p className="text-[10px] text-white/35 break-all">selectedRoute: {result.renderProof?.selectedRoute ?? result.selectedRoute}</p>
                    <p className="text-[10px] text-white/35 break-all">selectedEngine: {result.renderProof?.selectedEngine ?? result.selectedEngine}</p>
                    <p className="text-[10px] text-white/35 break-all">realAiCalled: {String(result.renderProof?.realAiCalled ?? true)}</p>
                    <p className="text-[10px] text-white/35 break-all">inputVideoUrl present: {String(result.renderProof?.inputVideoUrlPresent ?? Boolean(previewUrl))}</p>
                    <p className="text-[10px] text-white/35 break-all">inputImageUrl present: {String(result.renderProof?.inputImageUrlPresent ?? false)}</p>
                    <p className="text-[10px] text-white/35 break-all">faceLock active: {String(result.renderProof?.faceLockActive ?? result.faceLocked ?? false)}</p>
                    <p className="text-[10px] text-white/35 break-all">backgroundReplace active: {String(result.renderProof?.backgroundReplaceActive ?? (mode === "background_replace" || mode === "character_lock"))}</p>
                    <p className="text-[10px] text-white/35 break-all">objectEdit active: {String(result.renderProof?.objectEditActive ?? mode === "object_edit")}</p>
                    <p className="text-[10px] text-white/35 break-all">colorGrade active: {String(result.renderProof?.colorGradeActive ?? mode === "color_grade")}</p>
                    {result.replicateColorDebug && (
                      <>
                        <p className="text-[10px] text-white/35 break-all">replicateOutputUrl: {String(result.replicateColorDebug.replicateOutputUrl ?? "—")}</p>
                        <p className="text-[10px] text-white/35 break-all">bgInputMethod: {result.replicateColorDebug.bgInputMethod ?? "—"}</p>
                        <p className="text-[10px] text-white/35 break-all">bgPresetId: {result.replicateColorDebug.bgPresetId ?? "—"}</p>
                        <p className="text-[10px] text-white/35 break-all">referenceImageUrl: {String(result.replicateColorDebug.referenceImageUrl ?? "—")}</p>
                        <p className="text-[10px] text-white/35 break-all">prompt: {result.replicateColorDebug.prompt ?? "—"}</p>
                        <p className="text-[10px] text-white/35 break-all">aspectRatio: {result.replicateColorDebug.aspectRatio ?? "—"}</p>
                        <p className="text-[10px] text-white/35 break-all">seed: {String(result.replicateColorDebug.seed ?? "—")}</p>
                        <p className="text-[10px] text-white/35 break-all">errorMessage: {result.replicateColorDebug.errorMessage || result.renderProof?.errorMessage || "—"}</p>
                      </>
                    )}
                    {(result.pipelineWarnings?.length ?? result.replicateColorDebug?.warnings?.length) ? (
                      <p className="text-[10px] text-amber-200/80 break-all">
                        warnings: {(result.pipelineWarnings ?? result.replicateColorDebug?.warnings ?? []).join(" · ")}
                      </p>
                    ) : null}
                    <p className="text-[10px] text-white/35 break-all">finalOutputUrl present: {String(result.renderProof?.finalOutputUrlPresent ?? Boolean(result.videoUrl))}</p>
                    <p className="text-[10px] text-white/35 break-all">errorMessage: {result.renderProof?.errorMessage || ""}</p>
                    {result.selectedObject && <p className="text-[10px] text-white/35 break-all">selectedObject: {result.selectedObject}</p>}
                    {result.requestedEdit && <p className="text-[10px] text-white/35 break-all">requestedEdit: {result.requestedEdit}</p>}
                    {result.protectedMask && <p className="text-[10px] text-white/35 break-all">protectedMask: {result.protectedMask}</p>}
                    {result.editMask && <p className="text-[10px] text-white/35 break-all">editMask: {result.editMask}</p>}
                  </div>
                )}
                {mode === "background_replace" || mode === "color_grade" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-widest text-white/40">Original</p>
                      <VideoPlayer
                        src={result.inputVideoUrl ?? previewUrl ?? ""}
                        thumbnail={result.thumbnailUrl}
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-widest text-cyan-300/70">
                        {mode === "background_replace" ? "New Background" : "Runway Graded"}
                      </p>
                      <VideoPlayer src={result.videoUrl} thumbnail={result.thumbnailUrl} />
                    </div>
                  </div>
                ) : (
                  <VideoPlayer src={result.videoUrl} thumbnail={result.thumbnailUrl} />
                )}
                {(result.pipelineWarnings?.length ?? 0) > 0 && (
                  <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-100">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    <AlertDescription className="text-xs leading-relaxed">
                      {result.pipelineWarnings!.join(" ")}
                    </AlertDescription>
                  </Alert>
                )}
                {result.kontextError && (
                  <Alert variant="destructive" className="pt-2 px-3">
                    <AlertDescription>{result.kontextError}</AlertDescription>
                  </Alert>
                )}
                {result.kontextColorUrl && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-widest text-white/40">Cinematic color grade preview</p>
                      {typeof result.kontextCreditsCharged === "number" && (
                        <span className="text-[11px] text-white/50">
                          -{result.kontextCreditsCharged} credits
                        </span>
                      )}
                    </div>
                    <img
                      src={result.kontextColorUrl}
                      alt="Cinematic color grade preview"
                      className="w-full rounded-2xl border border-white/10"
                    />
                    <a href={result.kontextColorUrl} download className="text-[11px] text-white/50 hover:text-white underline">
                      Download color grade still
                    </a>
                  </div>
                )}

                {/* Fix face button */}
                {result.lumaUrl && result.sourceUrl && (
                  <Button
                    data-testid="button-fix-face"
                    onClick={handleFixFace}
                    disabled={fixing}
                    variant="outline"
                    className="w-full border-white/10 text-white/70 hover:text-white hover:border-white/25 hover:bg-white/5 rounded-full gap-2"
                  >
                    {fixing ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        Re-locking face...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        {result.faceLocked ? "Re-run face lock" : "Fix face"}
                      </>
                    )}
                  </Button>
                )}

                <a href={result.videoUrl} download className="block">
                  <Button variant="outline" className="w-full border-white/10 text-white/50 hover:text-white hover:border-white/25 hover:bg-white/5 rounded-full">
                    Download video
                  </Button>
                </a>
                <button onClick={reset} className="w-full text-xs text-white/20 hover:text-white/40 transition-colors py-2">
                  Process another video
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/8 aspect-video flex flex-col items-center justify-center text-center p-10 gap-6">
                <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center">
                  <Layers className="w-7 h-7 text-white/15" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/25 mb-1">Result appears here</p>
                  <p className="text-xs text-white/15">Upload a video and describe the new scene</p>
                </div>
                <div className="text-[11px] text-white/15 space-y-1.5 text-left w-full max-w-xs">
                  <p className="text-white/25 font-medium mb-2">How it works</p>
                  <p>1. Runway Gen-4 Aleph re-renders your video with the new background</p>
                  <p>2. Pick a preset, custom prompt, or reference image</p>
                  <p>3. Compare original vs result side by side</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
