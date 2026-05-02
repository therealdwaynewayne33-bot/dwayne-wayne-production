import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useListProjects, useListCharacters, useGenerateVideo, useCreateProject, getListProjectsQueryKey, getListVideosQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronRight, Video, Image, Sparkles, Users, Layers, Film, Upload, Zap, Crown, Cpu } from "lucide-react";
import { PlanLimitModal } from "@/components/PlanLimitModal";

const STYLES = [
  { id: "realistic", label: "Realistic", icon: Film, desc: "Photorealistic output" },
  { id: "cartoon", label: "Cartoon", icon: Layers, desc: "Animated cartoon look" },
  { id: "animated-3d", label: "3D Animated", icon: Sparkles, desc: "Pixar-style 3D render" },
  { id: "cinematic", label: "Cinematic", icon: Video, desc: "Film-grade visuals" },
];

const AI_MODELS = [
  {
    id: "wan-2.1",
    label: "Wan 2.1",
    badge: "Fast",
    badgeColor: "bg-emerald-500/20 text-emerald-400",
    icon: Zap,
    desc: "Sharp 720p · Best speed",
  },
  {
    id: "hunyuan",
    label: "HunyuanVideo",
    badge: "Premium",
    badgeColor: "bg-violet-500/20 text-violet-400",
    icon: Crown,
    desc: "Tencent · Kling-level quality",
  },
  {
    id: "minimax-live",
    label: "MiniMax Live",
    badge: "Smooth",
    badgeColor: "bg-blue-500/20 text-blue-400",
    icon: Cpu,
    desc: "Luma-style fluid motion",
  },
];

type GenType = "text-to-video" | "image-to-video";
type Style = "realistic" | "cartoon" | "animated-3d" | "cinematic";
type AiModel = "wan-2.1" | "hunyuan" | "minimax-live";

export default function CreatePage() {
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [genType, setGenType] = useState<GenType>("text-to-video");
  const [prompt, setPrompt] = useState("");
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [sourceImagePreview, setSourceImagePreview] = useState<string | null>(null);
  const [style, setStyle] = useState<Style>("cinematic");
  const [aiModel, setAiModel] = useState<AiModel>("wan-2.1");
  const [characterId, setCharacterId] = useState<number | null>(null);
  const [faceLock, setFaceLock] = useState(false);
  const [bgReplace, setBgReplace] = useState(false);
  const [bgPrompt, setBgPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [generatedVideoId, setGeneratedVideoId] = useState<number | null>(null);
  const [planLimitInfo, setPlanLimitInfo] = useState<{ plan: string; planUsed: number; planLimit: number } | null>(null);
  const [, setLocation] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: projects } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });
  const { data: characters } = useListCharacters();
  const generateVideo = useGenerateVideo();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setSourceImagePreview(url);
      setSourceImageUrl(url);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    let pid = projectId;
    if (!pid && newProjectTitle.trim()) {
      const result = await new Promise<number | null>((resolve) => {
        createProject.mutate({ data: { title: newProjectTitle.trim() } }, {
          onSuccess: (p) => { queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }); resolve(p.id); },
          onError: () => resolve(null),
        });
      });
      if (!result) { toast({ title: "Could not create project", variant: "destructive" }); return; }
      pid = result;
    }
    if (!pid) { toast({ title: "Select or create a project", variant: "destructive" }); return; }
    if (!prompt.trim()) { toast({ title: "Enter a prompt", variant: "destructive" }); return; }
    if (genType === "image-to-video" && !sourceImageUrl) {
      toast({ title: "Upload or paste an image URL to modify", variant: "destructive" }); return;
    }

    generateVideo.mutate({
      data: {
        projectId: pid,
        title: title || `Video ${new Date().toLocaleTimeString()}`,
        prompt: prompt.trim(),
        generationType: genType,
        style,
        aiModel: genType === "image-to-video" ? undefined : aiModel,
        characterId: faceLock && characterId ? characterId : undefined,
        sourceImageUrl: genType === "image-to-video" ? sourceImageUrl : undefined,
        backgroundReplaced: bgReplace,
        backgroundPrompt: bgReplace ? bgPrompt : undefined,
      }
    }, {
      onSuccess: (video) => {
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setGeneratedVideoId(video.id);
        setStep(4);
      },
      onError: (err: any) => {
        if (err?.status === 402 && err?.data) {
          setPlanLimitInfo({ plan: err.data.plan, planUsed: err.data.planUsed, planLimit: err.data.planLimit });
        } else {
          toast({ title: "Generation failed", variant: "destructive" });
        }
      },
    });
  };

  const steps = ["Project", "Prompt", "Options", "Processing"];

  return (
    <AppLayout>
      <div className="p-8 max-w-3xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-foreground mb-6">Create Video</h1>
          <div className="flex items-center gap-0">
            {steps.map((s, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              return (
                <div key={s} className="flex items-center">
                  <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all", done ? "bg-primary/20 text-primary" : active ? "bg-primary text-white" : "bg-secondary text-muted-foreground")}>
                    {done ? <Check className="w-3 h-3" /> : <span>{n}</span>}
                    {s}
                  </div>
                  {i < steps.length - 1 && <ChevronRight className="w-4 h-4 text-border mx-1" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── STEP 1: Project ─────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Choose a project</h2>
              <p className="text-sm text-muted-foreground mb-4">Videos are organized into projects</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {(projects ?? []).map((p) => (
                  <button key={p.id} data-testid={`button-select-project-${p.id}`}
                    onClick={() => { setProjectId(p.id); setNewProjectTitle(""); }}
                    className={cn("p-4 rounded-xl border text-left transition-all", projectId === p.id ? "border-primary bg-primary/10" : "border-card-border bg-card hover:border-primary/40")}>
                    <p className="text-sm font-semibold text-foreground">{p.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{p.videoCount} videos</p>
                  </button>
                ))}
              </div>
              <div className="border border-dashed border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Or create new project</p>
                <Input data-testid="input-new-project-title" placeholder="New project name..."
                  value={newProjectTitle} onChange={(e) => { setNewProjectTitle(e.target.value); setProjectId(null); }} className="bg-background" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button data-testid="button-next-step" onClick={() => setStep(2)}
                disabled={!projectId && !newProjectTitle.trim()} className="bg-primary hover:bg-primary/90">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Prompt ──────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-4">Compose your prompt</h2>

              {/* Generation type tabs */}
              <div className="flex gap-3 mb-6">
                {([
                  { id: "text-to-video", label: "Text to Video", Icon: Video, desc: "Generate from a prompt" },
                  { id: "image-to-video", label: "Modify / Animate", Icon: Image, desc: "Animate a still image" },
                ] as const).map(({ id, label, Icon, desc }) => (
                  <button key={id} data-testid={`button-gen-type-${id}`}
                    onClick={() => setGenType(id)}
                    className={cn("flex-1 flex flex-col items-start gap-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all", genType === id ? "border-primary bg-primary/10 text-primary" : "border-card-border bg-card text-muted-foreground hover:border-primary/40")}>
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" /> {label}
                    </div>
                    <span className="text-xs font-normal opacity-70">{desc}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Video title</label>
                  <Input data-testid="input-title" placeholder="My cinematic video" value={title}
                    onChange={(e) => setTitle(e.target.value)} className="bg-card" />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">
                    {genType === "image-to-video" ? "Motion prompt (how should it move?)" : "Prompt"}
                  </label>
                  <textarea data-testid="input-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
                    className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    placeholder={genType === "image-to-video"
                      ? "The camera slowly zooms in, the person walks forward..."
                      : "A lone astronaut walks across a dusty alien landscape at golden hour..."} />
                </div>

                {/* Image-to-video: upload or paste URL */}
                {genType === "image-to-video" && (
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Source image</label>
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) handleImageFile(f); }}
                      className={cn("border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all", sourceImagePreview ? "border-primary/40" : "border-border hover:border-primary/50")}>
                      {sourceImagePreview ? (
                        <div className="flex flex-col items-center gap-2">
                          <img src={sourceImagePreview} alt="Source" className="max-h-40 rounded-lg object-contain mx-auto" />
                          <p className="text-xs text-muted-foreground">Click to change</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 py-4">
                          <Upload className="w-8 h-8 text-primary/40" />
                          <p className="text-sm text-foreground font-medium">Drop image or click to upload</p>
                          <p className="text-xs text-muted-foreground">PNG, JPG, WEBP</p>
                        </div>
                      )}
                      <input ref={fileRef} type="file" accept="image/*" className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleImageFile(e.target.files[0])} />
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs text-muted-foreground">or paste URL</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <Input data-testid="input-source-image" placeholder="https://example.com/photo.jpg"
                      value={sourceImageUrl.startsWith("data:") ? "" : sourceImageUrl}
                      onChange={(e) => { setSourceImageUrl(e.target.value); setSourceImagePreview(null); }}
                      className="bg-card mt-2" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button data-testid="button-next-step" onClick={() => setStep(3)}
                disabled={!prompt.trim()} className="bg-primary hover:bg-primary/90">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Options ─────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-4">Style and options</h2>

              {/* Style picker */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                {STYLES.map(({ id, label, icon: Icon, desc }) => (
                  <button key={id} data-testid={`button-style-${id}`} onClick={() => setStyle(id as Style)}
                    className={cn("p-4 rounded-xl border text-left transition-all", style === id ? "border-primary bg-primary/10" : "border-card-border bg-card hover:border-primary/40")}>
                    <Icon className={cn("w-5 h-5 mb-2", style === id ? "text-primary" : "text-muted-foreground")} />
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>

              {/* AI Model picker — only for text-to-video */}
              {genType === "text-to-video" && (
                <div className="mb-5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">AI Engine</label>
                  <div className="grid grid-cols-3 gap-2">
                    {AI_MODELS.map(({ id, label, badge, badgeColor, icon: Icon, desc }) => (
                      <button key={id} data-testid={`button-model-${id}`}
                        onClick={() => setAiModel(id as AiModel)}
                        className={cn("p-3 rounded-xl border text-left transition-all", aiModel === id ? "border-primary bg-primary/10" : "border-card-border bg-card hover:border-primary/40")}>
                        <div className="flex items-center justify-between mb-1.5">
                          <Icon className={cn("w-4 h-4", aiModel === id ? "text-primary" : "text-muted-foreground")} />
                          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide", badgeColor)}>{badge}</span>
                        </div>
                        <p className={cn("text-xs font-semibold", aiModel === id ? "text-primary" : "text-foreground")}>{label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{desc}</p>
                      </button>
                    ))}
                  </div>
                  {aiModel === "hunyuan" && (
                    <p className="text-xs text-amber-400/80 mt-2 flex items-center gap-1">
                      <Crown className="w-3 h-3" /> HunyuanVideo takes 3–5 min but delivers cinematic quality
                    </p>
                  )}
                </div>
              )}

              {genType === "image-to-video" && (
                <div className="mb-5 p-3 rounded-xl border border-primary/20 bg-primary/5 text-xs text-primary/80 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  Modify uses Wan 2.1 Image-to-Video — your image becomes the first frame, the AI animates it
                </div>
              )}

              {/* Face lock + background replace */}
              <div className="space-y-4 p-4 bg-card border border-card-border rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" /> Face Lock
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Keep character consistent across all frames</p>
                  </div>
                  <button data-testid="toggle-face-lock" onClick={() => setFaceLock(!faceLock)}
                    className={cn("w-10 h-5 rounded-full transition-all relative", faceLock ? "bg-primary" : "bg-secondary")}>
                    <div className={cn("w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all", faceLock ? "left-5" : "left-0.5")} />
                  </button>
                </div>
                {faceLock && (
                  <div className="pl-6 space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Select character</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(characters ?? []).map((c) => (
                        <button key={c.id} data-testid={`button-character-${c.id}`}
                          onClick={() => setCharacterId(c.id)}
                          className={cn("p-2 rounded-lg border text-center text-xs transition-all", characterId === c.id ? "border-primary bg-primary/10" : "border-card-border hover:border-primary/40")}>
                          {c.name}
                        </button>
                      ))}
                      {(!characters || characters.length === 0) && (
                        <p className="col-span-3 text-xs text-muted-foreground">No characters yet. Add one in the Character Library.</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="border-t border-border pt-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Layers className="w-4 h-4 text-primary" /> Background Replace
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">AI green-screen replacement</p>
                  </div>
                  <button data-testid="toggle-bg-replace" onClick={() => setBgReplace(!bgReplace)}
                    className={cn("w-10 h-5 rounded-full transition-all relative", bgReplace ? "bg-primary" : "bg-secondary")}>
                    <div className={cn("w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all", bgReplace ? "left-5" : "left-0.5")} />
                  </button>
                </div>
                {bgReplace && (
                  <div className="pl-6">
                    <Input data-testid="input-bg-prompt" placeholder="A futuristic city at night..."
                      value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)} className="bg-background text-sm" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button data-testid="button-generate" onClick={handleGenerate}
                disabled={generateVideo.isPending} className="bg-primary hover:bg-primary/90 gap-2">
                <Sparkles className="w-4 h-4" />
                {generateVideo.isPending ? "Generating..." : "Generate Video"}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Queued ──────────────────────────────────────── */}
        {step === 4 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6 glow-pulse">
              <Sparkles className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Video queued</h2>
            <p className="text-muted-foreground mb-2 max-w-sm mx-auto">
              Your video is being generated by AI. This typically takes 1–5 minutes depending on the engine selected.
            </p>
            {aiModel === "hunyuan" && (
              <p className="text-xs text-amber-400/80 mb-6">HunyuanVideo is processing — allow up to 5 min for cinematic quality.</p>
            )}
            <div className="flex gap-4 justify-center mt-6">
              <Button data-testid="button-view-video"
                onClick={() => generatedVideoId && setLocation(`/videos/${generatedVideoId}`)}
                className="bg-primary hover:bg-primary/90">
                View Video
              </Button>
              <Button data-testid="button-create-another" variant="outline"
                onClick={() => { setStep(1); setPrompt(""); setTitle(""); setProjectId(null); setNewProjectTitle(""); setFaceLock(false); setBgReplace(false); setCharacterId(null); setSourceImageUrl(""); setSourceImagePreview(null); setAiModel("wan-2.1"); }}>
                Create Another
              </Button>
            </div>
          </div>
        )}
      </div>

      {planLimitInfo && (
        <PlanLimitModal plan={planLimitInfo.plan} planUsed={planLimitInfo.planUsed}
          planLimit={planLimitInfo.planLimit} onClose={() => setPlanLimitInfo(null)} />
      )}
    </AppLayout>
  );
}
