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
    <div className="rounded-xl overflow-hidden border border-card-border bg-black">
      <div className="relative aspect-video">
        <video ref={ref} src={src} poster={thumbnail} className="w-full h-full object-contain" playsInline
          onPlay={() => { setPlaying(true); setEnded(false); }}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setEnded(true); }}
          onTimeUpdate={() => setElapsed(ref.current?.currentTime ?? 0)}
          onLoadedMetadata={() => setDuration(ref.current?.duration ?? 0)} />
        {!playing && !ended && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button onClick={toggle} className="w-16 h-16 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-2xl hover:scale-105 transition-all">
              <Play className="w-7 h-7 text-black ml-1" />
            </button>
          </div>
        )}
        {ended && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <button onClick={toggle} className="w-14 h-14 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-2xl hover:scale-105 transition-all mb-1">
              <RotateCcw className="w-6 h-6 text-black" />
            </button>
            <span className="text-white/70 text-xs">Replay</span>
          </div>
        )}
      </div>
      <div className="bg-zinc-950 px-4 pt-2.5 pb-3 space-y-2">
        <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="absolute left-0 top-0 h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
          <input type="range" min={0} max={100} step={0.1} value={progress}
            onChange={(e) => { const v = ref.current; if (v && duration) v.currentTime = (Number(e.target.value) / 100) * duration; }}
            className="absolute inset-0 w-full opacity-0 cursor-pointer" />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggle} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0">
            {playing ? <Pause className="w-3.5 h-3.5" /> : ended ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <button onClick={() => { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0">
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <span className="text-xs text-white/60 font-mono tabular-nums">{fmt(elapsed)} / {fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}

type Stage = "idle" | "processing" | "done" | "error";

export default function BgReplacePage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [bgPrompt, setBgPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ videoUrl: string; thumbnailUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = (f: File) => {
    if (!f.type.startsWith("video/")) { toast({ title: "Please upload a video file", variant: "destructive" }); return; }
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
    setProgress("Uploading your video...");

    const form = new FormData();
    form.append("video", file);
    form.append("backgroundPrompt", bgPrompt.trim());

    try {
      setProgress("Removing background with AI...");
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

  const reset = () => { setFile(null); setPreviewUrl(null); setResult(null); setError(null); setStage("idle"); setProgress(""); };

  const PRESETS = [
    "A tropical beach at sunset with golden waves",
    "A neon-lit cyberpunk city at night",
    "A misty mountain range at dawn",
    "A cozy modern office with city views",
    "A futuristic space station interior",
    "A lush green forest with rays of sunlight",
  ];

  return (
    <AppLayout>
      <div className="p-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
              <Layers className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Background Replace</h1>
              <p className="text-sm text-muted-foreground">Drop a video — AI removes the background and adds a new AI-generated scene</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: input */}
          <div className="space-y-5">
            {/* Video drop zone */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">Your video</label>
              <div
                data-testid="drop-zone-video"
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => !file && fileRef.current?.click()}
                className={cn("relative rounded-xl border-2 border-dashed transition-all overflow-hidden",
                  dragging ? "border-primary bg-primary/10" : file ? "border-primary/40 cursor-default" : "border-border hover:border-primary/50 cursor-pointer",
                  file ? "aspect-video" : "py-14"
                )}>
                {file && previewUrl ? (
                  <>
                    <video src={previewUrl} className="w-full h-full object-contain bg-black" muted />
                    <button onClick={(e) => { e.stopPropagation(); reset(); }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-black flex items-center justify-center text-white transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-semibold">
                      {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center px-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Upload className={cn("w-6 h-6", dragging ? "text-primary" : "text-primary/50")} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Drop your video here</p>
                      <p className="text-xs text-muted-foreground mt-0.5">MP4, MOV, WebM · up to 200 MB</p>
                    </div>
                    <button onClick={() => fileRef.current?.click()}
                      className="text-xs text-primary hover:underline font-medium">Browse file</button>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="video/*" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </div>
            </div>

            {/* Background prompt */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">New background</label>
              <Input data-testid="input-bg-prompt"
                placeholder="A futuristic city at night, neon lights..."
                value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)}
                className="bg-card mb-3" />
              <p className="text-[11px] text-muted-foreground mb-2">Quick presets:</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p} onClick={() => setBgPrompt(p)}
                    className={cn("text-[11px] px-2 py-1 rounded-full border transition-all",
                      bgPrompt === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                    {p.split(" with ")[0].split(" at ")[0].split(" with ")[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <Button data-testid="button-replace-bg" onClick={handleSubmit}
              disabled={!file || !bgPrompt.trim() || stage === "processing"}
              className="w-full bg-primary hover:bg-primary/90 gap-2 h-11">
              {stage === "processing" ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  {progress || "Processing..."}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Replace Background
                </>
              )}
            </Button>

            {stage === "processing" && (
              <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-foreground">Processing pipeline</p>
                {[
                  "Uploading your video",
                  "AI background removal (Robust Video Matting)",
                  "Generating new background with AI",
                  "Compositing foreground + background",
                  "Encoding final video",
                ].map((step, i) => (
                  <div key={step} className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full border border-primary/40 flex items-center justify-center shrink-0">
                      <div className={cn("w-2 h-2 rounded-full bg-primary animate-pulse", i > 1 ? "opacity-30" : "")} />
                    </div>
                    <span className="text-xs text-muted-foreground">{step}</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground/70 pt-1">This takes 2–4 minutes depending on video length</p>
              </div>
            )}

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* Right: result */}
          <div className="space-y-5">
            {stage === "done" && result ? (
              <>
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400 mb-1">
                  <CheckCircle2 className="w-4 h-4" /> Background replaced successfully
                </div>
                <VideoPlayer src={result.videoUrl} thumbnail={result.thumbnailUrl} />
                <a href={result.videoUrl} download className="block">
                  <Button variant="outline" className="w-full gap-2">
                    Download Video
                  </Button>
                </a>
                <Button onClick={reset} variant="ghost" className="w-full text-muted-foreground">
                  Process another video
                </Button>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border aspect-video flex flex-col items-center justify-center text-center p-8 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Layers className="w-8 h-8 text-primary/40" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">Result will appear here</p>
                  <p className="text-xs text-muted-foreground">Upload a video and choose a background to get started</p>
                </div>
                <div className="text-[11px] text-muted-foreground/60 space-y-1 text-left w-full max-w-xs">
                  <p className="font-semibold text-muted-foreground mb-2">How it works:</p>
                  <p>1. AI detects and removes the background from every frame</p>
                  <p>2. OpenAI generates a photorealistic background from your prompt</p>
                  <p>3. FFmpeg composites foreground + background into a clean MP4</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
