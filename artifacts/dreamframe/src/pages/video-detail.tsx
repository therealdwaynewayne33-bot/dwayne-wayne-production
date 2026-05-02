import { useState } from "react";
import { Link } from "wouter";
import { useGetVideo, useApplyStyle, useDeleteVideo, getGetVideoQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, Play, Trash2, Sparkles, X, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

type Style = "realistic" | "cartoon" | "animated-3d" | "cinematic";
const STYLES: Style[] = ["realistic", "cartoon", "animated-3d", "cinematic"];

function PreviewModal({ src, prompt, onClose }: { src: string; prompt: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        onClick={onClose}
      >
        <X className="w-5 h-5" />
      </button>
      <div
        className="relative max-w-4xl w-full rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={prompt} className="w-full object-contain" />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-5">
          <p className="text-xs text-white/60 uppercase tracking-widest mb-1">AI-Generated Preview Frame</p>
          <p className="text-sm text-white leading-snug">{prompt}</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-white/40">Click anywhere outside to close</p>
    </div>
  );
}

export default function VideoDetailPage({ id }: { id: number }) {
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(100);
  const [showPreview, setShowPreview] = useState(false);
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

  const applyStyle = useApplyStyle();
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

  return (
    <AppLayout>
      {showPreview && video.thumbnailUrl && (
        <PreviewModal
          src={video.thumbnailUrl}
          prompt={video.prompt}
          onClose={() => setShowPreview(false)}
        />
      )}

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
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video border border-card-border">
              {video.status === "completed" && video.thumbnailUrl ? (
                <>
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <button
                      data-testid="button-play-pause"
                      onClick={() => setShowPreview(true)}
                      className="w-16 h-16 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-2xl transition-all hover:scale-105"
                    >
                      <Play className="w-7 h-7 text-black ml-1" />
                    </button>
                  </div>
                  <button
                    onClick={() => setShowPreview(true)}
                    className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/60 hover:bg-black/80 text-white text-xs font-medium transition-all"
                  >
                    <ZoomIn className="w-3.5 h-3.5" /> View full preview
                  </button>
                  <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] uppercase tracking-widest font-semibold">
                    AI Preview Frame
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {video.status === "processing" || video.status === "queued" ? (
                    <>
                      <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-4 glow-pulse">
                        <Sparkles className="w-8 h-8 text-primary" />
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
              )}
            </div>

            {video.status === "completed" && (
              <div className="bg-card border border-card-border rounded-xl p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Trim</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Start: {Math.round((trimStart / 100) * (video.duration ?? 30))}s</span>
                      <span>End: {Math.round((trimEnd / 100) * (video.duration ?? 30))}s</span>
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
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-card border border-card-border rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Details</h3>
              <div className="space-y-2.5 text-sm">
                {[
                  { label: "Type", value: video.generationType.replace("-", " ") },
                  { label: "Style", value: video.style.replace("-", " ") },
                  { label: "Duration", value: video.duration ? `${video.duration}s` : "—" },
                  { label: "Face Lock", value: video.characterId ? "Enabled" : "Off" },
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
                      video.style === s ? "border-primary bg-primary/10 text-primary" : "border-card-border hover:border-primary/40 text-muted-foreground"
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
