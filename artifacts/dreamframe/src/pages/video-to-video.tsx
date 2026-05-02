import { useState, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Sparkles, Film, Play, Pause, RotateCcw, Volume2, VolumeX,
  CheckCircle2, X, ArrowRight,
} from "lucide-react";

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

const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"];
const isVideoFile = (f: File) => {
  const ext = "." + f.name.split(".").pop()?.toLowerCase();
  return f.type.startsWith("video/")
    || (f.type === "application/octet-stream" && VIDEO_EXTS.includes(ext))
    || VIDEO_EXTS.includes(ext);
};

function VideoDropZone({
  label, file, previewUrl, onFile, onClear, dataTestId,
}: {
  label: string;
  file: File | null;
  previewUrl: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
  dataTestId: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handle = (f: File) => {
    if (!isVideoFile(f)) {
      toast({ title: "Please upload a video file (MP4, MOV, WebM…)", variant: "destructive" });
      return;
    }
    onFile(f);
  };

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
            <video src={previewUrl} className="w-full h-full object-contain bg-black" muted />
            <button onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/80 hover:bg-black flex items-center justify-center text-white transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-medium truncate max-w-[90%]">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-10 h-10 rounded-full bg-white/6 flex items-center justify-center">
              <Upload className={cn("w-4 h-4", dragging ? "text-white/70" : "text-white/25")} />
            </div>
            <div>
              <p className="text-xs font-medium text-white/50">Drop video</p>
              <p className="text-[10px] text-white/20 mt-0.5">MP4, MOV, WebM</p>
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.webm,.avi,.mkv,.m4v,.3gp" className="hidden"
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      </div>
    </div>
  );
}

type Stage = "idle" | "processing" | "done" | "error";

const PRESETS = [
  { label: "Color grade",   prompt: "the overall color grade and tone" },
  { label: "Lighting mood", prompt: "the lighting mood and ambient atmosphere" },
  { label: "Cinematic look",prompt: "the cinematic film look — contrast, colors, and mood" },
  { label: "Warm sunset",   prompt: "the warm sunset glow and golden hour lighting" },
  { label: "Cool teal",     prompt: "the cool teal and blue color grade" },
  { label: "Moody dark",    prompt: "the moody dark cinematic atmosphere" },
];

export default function VideoToVideoPage() {
  const [target,   setTarget]   = useState<File | null>(null);
  const [reference,setReference]= useState<File | null>(null);
  const [targetUrl,   setTargetUrl]    = useState<string | null>(null);
  const [referenceUrl,setReferenceUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<{ videoUrl: string; thumbnailUrl?: string; previewUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const setT = useCallback((f: File) => { setTarget(f);    setTargetUrl(URL.createObjectURL(f));    setResult(null); setError(null); setStage("idle"); }, []);
  const setR = useCallback((f: File) => { setReference(f); setReferenceUrl(URL.createObjectURL(f)); setResult(null); setError(null); setStage("idle"); }, []);
  const clearT = () => { setTarget(null); setTargetUrl(null); };
  const clearR = () => { setReference(null); setReferenceUrl(null); };

  const handleSubmit = async () => {
    if (!target)    { toast({ title: "Upload a target video first",    variant: "destructive" }); return; }
    if (!reference) { toast({ title: "Upload a reference video first", variant: "destructive" }); return; }
    if (!prompt.trim()) { toast({ title: "Describe what to transfer", variant: "destructive" }); return; }

    setStage("processing");
    setError(null);

    const form = new FormData();
    form.append("target",    target);
    form.append("reference", reference);
    form.append("transferPrompt", prompt.trim());

    const token = localStorage.getItem("dreamframe_token");
    try {
      const resp = await fetch("/api/videos/v2v", {
        method: "POST",
        body: form,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Unknown error");
      setResult(data);
      setStage("done");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
      setStage("error");
    }
  };

  const reset = () => {
    setTarget(null); setReference(null);
    setTargetUrl(null); setReferenceUrl(null);
    setPrompt(""); setResult(null); setError(null); setStage("idle");
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-8 py-14">
        {/* Header */}
        <div className="mb-12">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-2">AI transfer</p>
          <h1 className="text-4xl font-semibold text-white tracking-tight">Video to Video</h1>
          <p className="text-sm text-white/30 mt-2">
            Drop two videos — describe what to copy from the reference (color grade, lighting, an object) and we apply it to your target
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left: inputs */}
          <div className="space-y-7">
            {/* Two video drop zones side-by-side */}
            <div className="grid grid-cols-2 gap-4 items-start">
              <VideoDropZone
                label="Your video (target)"
                file={target} previewUrl={targetUrl}
                onFile={setT} onClear={clearT}
                dataTestId="drop-zone-target"
              />
              <VideoDropZone
                label="Reference video"
                file={reference} previewUrl={referenceUrl}
                onFile={setR} onClear={clearR}
                dataTestId="drop-zone-reference"
              />
            </div>

            {/* Visual flow indicator */}
            <div className="flex items-center justify-center gap-3 text-[10px] text-white/30 uppercase tracking-widest">
              <span>Reference</span>
              <ArrowRight className="w-3 h-3" />
              <span>Target</span>
            </div>

            {/* Transfer prompt */}
            <div>
              <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">What to transfer</p>
              <Input
                data-testid="input-transfer-prompt"
                placeholder='e.g. "the warm color grade", "the lamp on the table", "the rainy mood"'
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus-visible:ring-white/20 mb-2"
              />
              <p className="text-[11px] text-white/20 mb-3">
                AI sees both videos and copies the element you describe from the reference into your target
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
              disabled={!target || !reference || !prompt.trim() || stage === "processing"}
              className="w-full bg-white text-black hover:bg-white/90 font-semibold gap-2 h-11 rounded-full">
              {stage === "processing" ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                  Transferring...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Apply transfer
                </>
              )}
            </Button>

            {stage === "processing" && (
              <div className="border border-white/8 rounded-2xl p-5 space-y-4">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Pipeline</p>
                {[
                  "Uploading both videos",
                  "Extracting reference frames",
                  "AI generating transfer",
                  "Applying to target video",
                  "Encoding final video",
                ].map((step, i) => (
                  <div key={step} className="flex items-center gap-3">
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", i < 3 ? "bg-white animate-pulse" : "bg-white/15")} />
                    <span className="text-xs text-white/40">{step}</span>
                  </div>
                ))}
                <p className="text-[11px] text-white/20 pt-1">Takes 1–3 minutes</p>
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
                <div className="flex items-center gap-2 text-sm font-medium text-white/60 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Transfer complete</span>
                </div>
                <VideoPlayer src={result.videoUrl} thumbnail={result.thumbnailUrl} />
                {result.previewUrl && (
                  <div className="border border-white/8 rounded-2xl p-4">
                    <p className="text-[11px] text-white/30 uppercase tracking-widest mb-2.5">AI-generated reference frame</p>
                    <img src={result.previewUrl} alt="AI transfer preview" className="w-full rounded-lg border border-white/5" />
                    <p className="text-[10px] text-white/20 mt-2.5">This single frame was AI-generated to define the new look — its color cast was then applied to every frame of your target video</p>
                  </div>
                )}
                <a href={result.videoUrl} download className="block">
                  <Button variant="outline" className="w-full border-white/10 text-white/50 hover:text-white hover:border-white/25 hover:bg-white/5 rounded-full">
                    Download video
                  </Button>
                </a>
                <button onClick={reset} className="w-full text-xs text-white/20 hover:text-white/40 transition-colors py-2">
                  New transfer
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/8 aspect-video flex flex-col items-center justify-center text-center p-10 gap-6">
                <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center">
                  <Film className="w-7 h-7 text-white/15" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/25 mb-1">Result appears here</p>
                  <p className="text-xs text-white/15">Drop two videos and describe what to transfer</p>
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
