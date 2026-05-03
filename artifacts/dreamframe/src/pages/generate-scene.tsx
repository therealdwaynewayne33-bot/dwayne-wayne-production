import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { CREDIT_COSTS } from "@/lib/credits";
import {
  Upload, Sparkles, Play, Pause, RotateCcw, Volume2, VolumeX,
  CheckCircle2, X, Wand2, ImageIcon, Coins,
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

type Stage = "idle" | "processing" | "done" | "error";

type SceneResult = {
  videoUrl: string;
  thumbnailUrl?: string;
  engine: string;
  engineLabel: string;
};

type EngineId = "kling-2.1" | "hailuo-02" | "pixverse-4.5" | "wan-2.2-i2v";

// Static engine catalog rendered as the tab strip. The server validates the
// id again, so this is purely UI metadata (descriptions, cost hints, which
// fields to show). Cost ranges are rough Replicate list prices and will
// change — we display them as estimates only.
const ENGINES: Array<{
  id: EngineId;
  label: string;
  tagline: string;
  needsImage: boolean;
  durations: number[];
  cost: string;
  best: string;
}> = [
  {
    id: "kling-2.1",
    label: "Kling 2.1",
    tagline: "Cinematic, premium quality",
    needsImage: true,
    durations: [5, 10],
    cost: "≈ $0.50 (5s) / $1.00 (10s)",
    best: "Hero shots, polished cinematic motion. Needs a starting image.",
  },
  {
    id: "hailuo-02",
    label: "Hailuo 02",
    tagline: "Most economical, great motion",
    needsImage: false,
    durations: [6, 10],
    cost: "≈ $0.27 (6s) / $0.45 (10s)",
    best: "B-roll and quick iterations. Works from text alone.",
  },
  {
    id: "pixverse-4.5",
    label: "Pixverse 4.5",
    tagline: "Special effects + sound",
    needsImage: false,
    durations: [5, 8],
    cost: "≈ $0.20–0.40 per clip",
    best: "Stylized clips and built-in effects. Image is optional.",
  },
  {
    id: "wan-2.2-i2v",
    label: "Wan 2.2 i2v",
    tagline: "Open-source backbone, controllable",
    needsImage: true,
    durations: [],
    cost: "≈ $0.15–0.30 per clip",
    best: "Predictable motion from a still. Image required, ~3s output.",
  },
];

const PROMPT_PRESETS = [
  "Slow cinematic dolly-in with soft natural light",
  "Drone shot pulling back to reveal the wider landscape",
  "Subject turns toward camera, golden hour rim light",
  "Slow motion handheld with shallow depth of field",
  "Static locked-off shot, gentle ambient movement",
  "Rain pours down, neon reflections on wet pavement",
];

export default function GenerateScenePage() {
  const [engineId, setEngineId] = useState<EngineId>("hailuo-02");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<SceneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const engine = ENGINES.find((e) => e.id === engineId)!;
  const effectiveDuration = duration ?? engine.durations[0] ?? null;
  const creditCost = CREDIT_COSTS.scene[engineId]?.(effectiveDuration ?? 0) ?? 0;

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      toast({ title: "Image required", description: "Please pick a PNG, JPG, or WebP image." });
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 25 MB. Try a smaller file." });
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  }, []);

  const generate = async () => {
    setError(null);
    if (!prompt.trim()) {
      setError("Add a prompt describing the shot you want.");
      return;
    }
    if (engine.needsImage && !file) {
      setError(`${engine.label} needs a starting image. Upload one or pick a different engine.`);
      return;
    }

    setStage("processing");
    setResult(null);

    const fd = new FormData();
    fd.append("engine", engineId);
    fd.append("prompt", prompt.trim());
    if (effectiveDuration) fd.append("duration", String(effectiveDuration));
    if (file) fd.append("image", file);

    try {
      const resp = await fetch("/api/scene/generate", {
        method:      "POST",
        credentials: "include",
        body:        fd,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Scene generation failed");
      setResult(data);
      setStage("done");
      // Refresh sidebar balance immediately so the user sees the deduction.
      qc.invalidateQueries({ queryKey: ["credits"] });
      toast({
        title: "Scene ready",
        description: `${data.engineLabel} finished. ${data.creditsCharged ?? 0} credits used · ${data.creditsRemaining?.toLocaleString() ?? "?"} left.`,
      });
    } catch (err: any) {
      setError(err.message ?? "Scene generation failed");
      setStage("error");
    }
  };

  const reset = () => {
    setFile(null); setPreviewUrl(null); setResult(null); setError(null);
    setStage("idle"); setPrompt(""); setDuration(null);
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs text-white/40 uppercase tracking-widest mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate Scene</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Make a new clip from a still or a prompt</h1>
          <p className="text-sm text-white/50 max-w-2xl">
            Pick an AI engine, drop in a starting image (optional for some), describe the shot, and get back a 5–10 second clip. Useful for B-roll, establishing shots, and anything you can't film yourself.
          </p>
        </div>

        {/* Engine tab strip */}
        <div className="mb-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {ENGINES.map((e) => {
              const active = e.id === engineId;
              return (
                <button
                  key={e.id}
                  data-testid={`engine-tab-${e.id}`}
                  onClick={() => { setEngineId(e.id); setDuration(null); }}
                  className={cn(
                    "text-left rounded-xl border px-4 py-3 transition-all",
                    active
                      ? "border-primary/50 bg-primary/10 text-white"
                      : "border-white/8 bg-white/[0.02] text-white/70 hover:border-white/20 hover:bg-white/5",
                  )}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold">{e.label}</span>
                    {active && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                  </div>
                  <p className="text-[11px] text-white/40 leading-snug">{e.tagline}</p>
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-xs text-white/50 flex flex-wrap items-center gap-x-6 gap-y-1">
            <span><span className="text-white/30">Best for:</span> {engine.best}</span>
            <span className="flex items-center gap-1.5">
              <Coins className="w-3 h-3 text-primary/70" />
              <span className="text-white/30">Costs</span>
              <span className="text-white font-semibold tabular-nums">{creditCost}</span>
              <span className="text-white/30">credits</span>
              <span className="text-white/20">({engine.cost})</span>
            </span>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: inputs */}
          <div className="space-y-6">
            {/* Image dropzone */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-white/40 uppercase tracking-widest">
                  Starting image {engine.needsImage ? <span className="text-amber-300/80 normal-case">required</span> : <span className="text-white/30 normal-case">(optional)</span>}
                </label>
                {file && (
                  <button onClick={() => { setFile(null); setPreviewUrl(null); }} className="text-[11px] text-white/30 hover:text-white/60 flex items-center gap-1">
                    <X className="w-3 h-3" /> Remove
                  </button>
                )}
              </div>
              {previewUrl ? (
                <div className="relative rounded-2xl overflow-hidden border border-white/8 aspect-video bg-black">
                  <img src={previewUrl} alt="Starting frame" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div
                  data-testid="image-dropzone"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cn(
                    "rounded-2xl border-2 border-dashed cursor-pointer transition-all aspect-video flex flex-col items-center justify-center gap-2",
                    dragging ? "border-primary/60 bg-primary/5" : "border-white/10 hover:border-white/25 bg-white/[0.02]",
                  )}
                >
                  <ImageIcon className="w-7 h-7 text-white/30" />
                  <p className="text-sm text-white/60">Drop an image or click to browse</p>
                  <p className="text-[11px] text-white/30">PNG, JPG, WebP · max 25 MB</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>

            {/* Prompt */}
            <div>
              <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Prompt</label>
              <textarea
                data-testid="prompt-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the motion, lighting, mood…"
                rows={4}
                className="w-full rounded-xl bg-white/[0.03] border border-white/8 px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 resize-none"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {PROMPT_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrompt(p)}
                    className="text-[11px] text-white/40 hover:text-white border border-white/8 hover:border-white/20 rounded-full px-2.5 py-1 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            {engine.durations.length > 0 && (
              <div>
                <label className="text-xs text-white/40 uppercase tracking-widest mb-2 block">Duration</label>
                <div className="flex gap-2">
                  {engine.durations.map((d) => {
                    const active = (duration ?? engine.durations[0]) === d;
                    return (
                      <button
                        key={d}
                        onClick={() => setDuration(d)}
                        className={cn(
                          "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "border-primary/50 bg-primary/10 text-white"
                            : "border-white/8 bg-white/[0.02] text-white/60 hover:border-white/20 hover:bg-white/5",
                        )}
                      >
                        {d}s
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Button
              data-testid="button-generate"
              onClick={generate}
              disabled={stage === "processing"}
              className="w-full bg-white text-black hover:bg-white/90 rounded-full h-11 text-sm font-semibold gap-2"
            >
              {stage === "processing" ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                  Generating with {engine.label}…
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Generate scene · {creditCost} credits
                </>
              )}
            </Button>

            {error && (
              <div className="rounded-lg border border-red-400/20 bg-red-500/5 px-4 py-3 text-sm text-red-300/90">
                {error}
              </div>
            )}
          </div>

          {/* Right: result */}
          <div>
            {stage === "done" && result ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-white/60">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Scene generated</span>
                  </div>
                  <div className="text-[11px] text-white/40 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
                    {result.engineLabel}
                  </div>
                </div>
                <VideoPlayer src={result.videoUrl} thumbnail={result.thumbnailUrl} />
                <a href={result.videoUrl} download className="block">
                  <Button variant="outline" className="w-full border-white/10 text-white/60 hover:text-white hover:border-white/25 hover:bg-white/5 rounded-full">
                    Download video
                  </Button>
                </a>
                <button onClick={reset} className="w-full text-xs text-white/20 hover:text-white/40 transition-colors py-2">
                  Generate another
                </button>
              </div>
            ) : stage === "processing" ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] aspect-video flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white animate-spin" />
                <p className="text-sm text-white/60">Rendering with {engine.label}…</p>
                <p className="text-[11px] text-white/30">This usually takes 30 seconds to 3 minutes.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/8 aspect-video flex flex-col items-center justify-center gap-2 text-white/30">
                <Upload className="w-8 h-8" />
                <p className="text-sm">Your generated scene will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
