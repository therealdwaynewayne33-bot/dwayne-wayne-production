import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useGetVideo, useApplyStyle, useDeleteVideo, getGetVideoQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, Play, Pause, Trash2, Sparkles, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

type Style = "realistic" | "cartoon" | "animated-3d" | "cinematic";
const STYLES: Style[] = ["realistic", "cartoon", "animated-3d", "cinematic"];

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Canvas Video Player ───────────────────────────────────────────────────
// Simulates motion by animating the AI image with running physics on each frame:
//  • horizontal parallax  – background scrolls left (scene movement)
//  • vertical bounce      – subject bobs up/down (footstep rhythm)
//  • lateral sway         – slight left/right torso swing
//  • motion streak        – semi-transparent trailing frames at stride peaks
function VideoPlayer({ src, duration, prompt }: { src: string; duration: number; prompt: string }) {
  const firstFrame = src.startsWith("multi:") ? src.slice(6).split(",")[0] : src;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef    = useRef<HTMLImageElement | null>(null);
  const rafRef    = useRef<number>(0);
  const tRef      = useRef<number>(0);   // elapsed seconds
  const lastRef   = useRef<number>(-1);  // last rAF timestamp

  const [playing,   setPlaying]   = useState(false);
  const [elapsed,   setElapsed]   = useState(0);
  const [ended,     setEnded]     = useState(false);
  const [imgReady,  setImgReady]  = useState(false);

  // ── draw one frame ────────────────────────────────────────────────────────
  const draw = useCallback((t: number, isPlaying: boolean) => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Motion parameters
    const STEPS_PER_SEC  = 2.6;          // footstep cadence
    const BOUNCE_AMP     = 0.022;         // vertical bounce (fraction of height)
    const SWAY_AMP       = 0.008;         // lateral sway (fraction of width)
    const PARALLAX_RATE  = 0.08;          // how fast background scrolls (fraction/sec)
    const ZOOM           = 1.18;          // zoom-in so we have room to pan

    const step   = t * STEPS_PER_SEC * Math.PI * 2;
    const bounce = isPlaying ? Math.abs(Math.sin(step)) * BOUNCE_AMP : 0;   // always up
    const sway   = isPlaying ? Math.sin(step * 0.5)     * SWAY_AMP   : 0;
    const panX   = (t * PARALLAX_RATE) % 1;  // wraps 0→1

    const iW = img.naturalWidth;
    const iH = img.naturalHeight;
    const sw = iW / ZOOM;
    const sh = iH / ZOOM;

    // Source origin – clamp so we never go out of bounds
    const maxSX = iW - sw;
    const maxSY = iH - sh;
    const sx = Math.min(Math.max(panX * maxSX + sway * iW, 0), maxSX);
    const sy = Math.min(Math.max(bounce * iH, 0), maxSY);

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);

    // Ghosting / motion streak at stride peaks
    if (isPlaying) {
      const stridePhase = Math.abs(Math.cos(step));
      if (stridePhase > 0.65) {
        const ghost = (stridePhase - 0.65) / 0.35; // 0→1 at peak
        const streakSX = Math.min(Math.max(sx + 14, 0), maxSX);
        ctx.globalAlpha = ghost * 0.18;
        ctx.drawImage(img, streakSX, sy, sw, sh, 0, 0, W, H);
        const streakSX2 = Math.min(Math.max(sx + 28, 0), maxSX);
        ctx.globalAlpha = ghost * 0.09;
        ctx.drawImage(img, streakSX2, sy, sw, sh, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    // Vignette overlay
    const vignette = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.85);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }, []);

  // ── load image ────────────────────────────────────────────────────────────
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
      draw(0, false);
    };
    img.src = firstFrame;
  }, [firstFrame, draw]);

  // ── animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !imgReady) return;

    function loop(ts: number) {
      if (lastRef.current < 0) lastRef.current = ts;
      const dt = Math.min((ts - lastRef.current) / 1000, 0.05); // cap at 50ms
      lastRef.current = ts;
      tRef.current = Math.min(tRef.current + dt, duration);

      draw(tRef.current, true);
      setElapsed(tRef.current);

      if (tRef.current >= duration) {
        setPlaying(false);
        setEnded(true);
        lastRef.current = -1;
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    lastRef.current = -1;
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, imgReady, duration, draw]);

  const handlePlayPause = () => {
    if (ended) {
      tRef.current = 0;
      setElapsed(0);
      setEnded(false);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = (Number(e.target.value) / 100) * duration;
    tRef.current = t;
    setElapsed(t);
    setEnded(false);
    draw(t, false);
  };

  const progress = duration > 0 ? (elapsed / duration) * 100 : 0;

  return (
    <div className="rounded-xl overflow-hidden border border-card-border bg-black">
      {/* Canvas viewport */}
      <div className="relative aspect-video bg-black">
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          className="w-full h-full"
        />

        {/* Black letterbox bars */}
        <div className="absolute inset-x-0 top-0 h-5 bg-black pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-5 bg-black pointer-events-none" />

        {/* Centre play button – only before first press */}
        {!playing && elapsed === 0 && !ended && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              data-testid="button-play-pause"
              onClick={handlePlayPause}
              className="w-16 h-16 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-2xl transition-all hover:scale-105"
            >
              <Play className="w-7 h-7 text-black ml-1" />
            </button>
          </div>
        )}

        {/* Replay */}
        {ended && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <button
              onClick={handlePlayPause}
              className="w-14 h-14 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-2xl hover:scale-105 transition-all mb-2"
            >
              <RotateCcw className="w-6 h-6 text-black" />
            </button>
            <span className="text-white/80 text-xs">Replay</span>
          </div>
        )}

        <div className="absolute top-6 left-3 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] uppercase tracking-widest font-semibold pointer-events-none">
          AI Generated
        </div>
      </div>

      {/* Controls */}
      <div className="bg-zinc-950 px-4 pt-2.5 pb-3 space-y-2">
        <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="absolute left-0 top-0 h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
          <input
            type="range" min={0} max={100} step={0.1} value={progress}
            onChange={handleSeek}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            data-testid="button-play-pause"
            onClick={handlePlayPause}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0"
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : ended ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <span className="text-xs text-white/60 font-mono tabular-nums">
            {fmt(elapsed)} / {fmt(duration)}
          </span>
          <span className="ml-auto text-[10px] text-white/40 truncate max-w-[200px]">{prompt}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function VideoDetailPage({ id }: { id: number }) {
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd,   setTrimEnd]   = useState(100);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: video, isLoading } = useGetVideo(id, {
    query: {
      queryKey: getGetVideoQueryKey(id),
      refetchInterval: (query) => {
        const v = query.state.data;
        if (v && (v.status === "queued" || v.status === "processing")) return 3000;
        return false;
      },
    },
  });

  const applyStyle  = useApplyStyle();
  const deleteVideo = useDeleteVideo();

  const onApplyStyle = (style: Style) => {
    applyStyle.mutate({ id, data: { style } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetVideoQueryKey(id) });
        toast({ title: `Applying ${style} style...` });
      },
    });
  };

  const onDelete = () => {
    deleteVideo.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Video deleted" });
        setLocation("/projects");
      },
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 animate-pulse">
          <div className="h-8 bg-card rounded w-48 mb-4" />
          <div className="h-64 bg-card rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!video) {
    return (
      <AppLayout>
        <div className="p-8 text-muted-foreground">Video not found.</div>
      </AppLayout>
    );
  }

  const duration = video.duration ?? 30;

  return (
    <AppLayout>
      <div className="p-8 max-w-5xl mx-auto">
        <Link href={`/projects/${video.projectId}`}>
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Project
          </button>
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-foreground">{video.title}</h1>
              <StatusBadge status={video.status} />
            </div>
            <p className="text-sm text-muted-foreground">{video.prompt}</p>
          </div>
          <button
            data-testid="button-delete-video"
            onClick={onDelete}
            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {video.status === "completed" && video.thumbnailUrl ? (
              <VideoPlayer src={video.thumbnailUrl} duration={duration} prompt={video.prompt} />
            ) : (
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video border border-card-border">
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {video.status === "processing" || video.status === "queued" ? (
                    <>
                      <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-4">
                        <Sparkles className="w-8 h-8 text-primary animate-pulse" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {video.status === "queued" ? "Waiting in queue..." : "Generating your video..."}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Auto-refreshing every 3 seconds</p>
                    </>
                  ) : video.status === "failed" ? (
                    <p className="text-sm text-destructive">Generation failed</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No preview available</p>
                  )}
                </div>
              </div>
            )}

            {video.status === "completed" && (
              <div className="bg-card border border-card-border rounded-xl p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Trim</h3>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Start: {Math.round((trimStart / 100) * duration)}s</span>
                    <span>End: {Math.round((trimEnd / 100) * duration)}s</span>
                  </div>
                  <div className="relative h-6 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="absolute h-full bg-primary/30 rounded-full"
                      style={{ left: `${trimStart}%`, width: `${trimEnd - trimStart}%` }}
                    />
                    <input
                      data-testid="slider-trim-start"
                      type="range" min={0} max={trimEnd - 5} value={trimStart}
                      onChange={(e) => setTrimStart(Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-card border border-card-border rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Details</h3>
              <div className="space-y-2.5 text-sm">
                {[
                  { label: "Type",     value: video.generationType.replace("-", " ") },
                  { label: "Style",    value: video.style.replace("-", " ") },
                  { label: "Duration", value: `${duration}s` },
                  { label: "Face Lock",  value: video.characterId ? "Enabled" : "Off" },
                  { label: "BG Replace", value: video.backgroundReplaced ? "On" : "Off" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-foreground capitalize font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Apply Style</h3>
              <div className="grid grid-cols-2 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s}
                    data-testid={`button-apply-style-${s}`}
                    onClick={() => onApplyStyle(s)}
                    disabled={applyStyle.isPending}
                    className={cn(
                      "px-2 py-2 rounded-lg border text-xs font-medium transition-all capitalize",
                      video.style === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-card-border hover:border-primary/40 text-muted-foreground"
                    )}
                  >
                    {s.replace("-", " ")}
                  </button>
                ))}
              </div>
              {applyStyle.isPending && (
                <p className="text-xs text-muted-foreground mt-2 text-center">Applying style...</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
