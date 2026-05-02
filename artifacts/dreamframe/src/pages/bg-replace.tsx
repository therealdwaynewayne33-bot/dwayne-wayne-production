import { useState, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Upload, Sparkles, Layers, Play, Pause, RotateCcw, Volume2, VolumeX, CheckCircle2, X } from "lucide-react";

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

const PRESETS = [
  { label: "Tropical beach", prompt: "A tropical beach at sunset with golden waves" },
  { label: "Cyberpunk city", prompt: "A neon-lit cyberpunk city at night" },
  { label: "Mountain range", prompt: "A misty mountain range at dawn" },
  { label: "Modern office", prompt: "A cozy modern office with city views" },
  { label: "Space station", prompt: "A futuristic space station interior" },
  { label: "Forest", prompt: "A lush green forest with rays of sunlight" },
];

export default function BgReplacePage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [bgPrompt, setBgPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<{ videoUrl: string; thumbnailUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"];
  const isVideoFile = (f: File) => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    return f.type.startsWith("video/") || f.type === "application/octet-stream" && VIDEO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
  };

  const handleFile = (f: File) => {
    if (!isVideoFile(f)) { toast({ title: "Please upload a video file (MP4, MOV, WebM…)", variant: "destructive" }); return; }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setStage("idle");
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleSubmit = async () => {
    if (!file) { toast({ title: "Upload a video first", variant: "destructive" }); return; }
    if (!bgPrompt.trim()) { toast({ title: "Enter a background description", variant: "destructive" }); return; }

    setStage("processing");
    setError(null);

    const form = new FormData();
    form.append("video", file);
    form.append("backgroundPrompt", bgPrompt.trim());

    try {
      const resp = await fetch("/api/videos/bg-replace", { method: "POST", body: form, credentials: "include" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Unknown error");
      setResult(data);
      setStage("done");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
      setStage("error");
    }
  };

  const reset = () => { setFile(null); setPreviewUrl(null); setResult(null); setError(null); setStage("idle"); };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-8 py-14">
        {/* Header */}
        <div className="mb-12">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-2">AI compositing</p>
          <h1 className="text-4xl font-semibold text-white tracking-tight">Background Replace</h1>
          <p className="text-sm text-white/30 mt-2">Drop a video — AI removes the background and renders a new AI-generated scene behind it</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left: inputs */}
          <div className="space-y-8">
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
                    <video src={previewUrl} className="w-full h-full object-contain bg-black" muted />
                    <button onClick={(e) => { e.stopPropagation(); reset(); }}
                      className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/80 hover:bg-black flex items-center justify-center text-white transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-medium">
                      {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4 text-center px-6">
                    <div className="w-12 h-12 rounded-full bg-white/6 flex items-center justify-center">
                      <Upload className={cn("w-5 h-5", dragging ? "text-white/70" : "text-white/25")} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white/50">Drop your video here</p>
                      <p className="text-xs text-white/20 mt-1">MP4, MOV, WebM · up to 200 MB</p>
                    </div>
                    <button onClick={() => fileRef.current?.click()}
                      className="text-xs text-white/40 hover:text-white transition-colors font-medium">Browse file</button>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="video/*,.mp4,.mov,.webm,.avi,.mkv,.m4v,.3gp" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </div>
            </div>

            {/* Background prompt */}
            <div>
              <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">New background</p>
              <Input data-testid="input-bg-prompt"
                placeholder="A futuristic city at night, neon lights..."
                value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus-visible:ring-white/20 mb-4" />
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => setBgPrompt(p.prompt)}
                    className={cn("text-xs px-3 py-1.5 rounded-full border transition-all",
                      bgPrompt === p.prompt
                        ? "border-white/40 bg-white/10 text-white"
                        : "border-white/8 text-white/30 hover:border-white/20 hover:text-white/60")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <Button data-testid="button-replace-bg" onClick={handleSubmit}
              disabled={!file || !bgPrompt.trim() || stage === "processing"}
              className="w-full bg-white text-black hover:bg-white/90 font-semibold gap-2 h-11 rounded-full">
              {stage === "processing" ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Replace background
                </>
              )}
            </Button>

            {stage === "processing" && (
              <div className="border border-white/8 rounded-2xl p-5 space-y-4">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Pipeline</p>
                {[
                  "Uploading your video",
                  "AI background removal",
                  "Generating new background",
                  "Compositing foreground + background",
                  "Encoding final video",
                ].map((step, i) => (
                  <div key={step} className="flex items-center gap-3">
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", i < 2 ? "bg-white animate-pulse" : "bg-white/15")} />
                    <span className="text-xs text-white/40">{step}</span>
                  </div>
                ))}
                <p className="text-[11px] text-white/20 pt-1">Takes 2–4 minutes depending on video length</p>
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
                  <span>Background replaced</span>
                </div>
                <VideoPlayer src={result.videoUrl} thumbnail={result.thumbnailUrl} />
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
                  <p className="text-xs text-white/15">Upload a video and describe the background</p>
                </div>
                <div className="text-[11px] text-white/15 space-y-1.5 text-left w-full max-w-xs">
                  <p className="text-white/25 font-medium mb-2">How it works</p>
                  <p>1. AI removes background from every frame</p>
                  <p>2. OpenAI generates your new background</p>
                  <p>3. FFmpeg composites the final video</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
