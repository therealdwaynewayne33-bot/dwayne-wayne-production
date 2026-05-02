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
  { id: "realistic",   label: "Realistic",   icon: Film,     desc: "Photorealistic output" },
  { id: "cartoon",     label: "Cartoon",     icon: Layers,   desc: "Animated cartoon look" },
  { id: "animated-3d", label: "3D Animated", icon: Sparkles, desc: "Pixar-style 3D render" },
  { id: "cinematic",   label: "Cinematic",   icon: Video,    desc: "Film-grade visuals" },
];

const AI_MODELS = [
  { id: "wan-2.1",      label: "Wan 2.1",       badge: "Fast",    icon: Zap,   desc: "Sharp 720p · Best speed" },
  { id: "hunyuan",      label: "HunyuanVideo",   badge: "Premium", icon: Crown, desc: "Tencent · Kling-level quality" },
  { id: "minimax-live", label: "MiniMax Live",   badge: "Smooth",  icon: Cpu,   desc: "Luma-style fluid motion" },
];

type GenType  = "text-to-video" | "image-to-video";
type Style    = "realistic" | "cartoon" | "animated-3d" | "cinematic";
type AiModel  = "wan-2.1" | "hunyuan" | "minimax-live";

export default function CreatePage() {
  const [step, setStep]                   = useState(1);
  const [projectId, setProjectId]         = useState<number | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [genType, setGenType]             = useState<GenType>("text-to-video");
  const [prompt, setPrompt]               = useState("");
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [sourceImagePreview, setSourceImagePreview] = useState<string | null>(null);
  const [style, setStyle]                 = useState<Style>("cinematic");
  const [aiModel, setAiModel]             = useState<AiModel>("wan-2.1");
  const [characterId, setCharacterId]     = useState<number | null>(null);
  const [faceLock, setFaceLock]           = useState(false);
  const [bgReplace, setBgReplace]         = useState(false);
  const [bgPrompt, setBgPrompt]           = useState("");
  const [title, setTitle]                 = useState("");
  const [generatedVideoId, setGeneratedVideoId] = useState<number | null>(null);
  const [planLimitInfo, setPlanLimitInfo] = useState<{ plan: string; planUsed: number; planLimit: number } | null>(null);
  const [, setLocation]                   = useLocation();
  const fileRef                           = useRef<HTMLInputElement>(null);

  const { data: projects }   = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });
  const { data: characters } = useListCharacters();
  const generateVideo        = useGenerateVideo();
  const createProject        = useCreateProject();
  const queryClient          = useQueryClient();
  const { toast }            = useToast();

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
    if (!pid)              { toast({ title: "Select or create a project", variant: "destructive" }); return; }
    if (!prompt.trim())    { toast({ title: "Enter a prompt", variant: "destructive" }); return; }
    if (genType === "image-to-video" && !sourceImageUrl) {
      toast({ title: "Upload or paste an image to animate", variant: "destructive" }); return;
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

  const steps = ["Project", "Prompt", "Options", "Done"];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-8 py-14">

        {/* Header + step indicator */}
        <div className="mb-12">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Studio</p>
          <h1 className="text-4xl font-semibold text-white tracking-tight mb-8">Create Video</h1>
          <div className="flex items-center gap-2">
            {steps.map((s, i) => {
              const n    = i + 1;
              const done = step > n;
              const active = step === n;
              return (
                <div key={s} className="flex items-center gap-2">
                  <div className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                    done   ? "bg-white/10 text-white/50"
                           : active ? "bg-white text-black"
                           : "bg-white/5 text-white/20"
                  )}>
                    {done ? <Check className="w-3 h-3" /> : <span>{n}</span>}
                    {s}
                  </div>
                  {i < steps.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-white/15" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── STEP 1: Project ─────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <p className="text-white/40 text-sm">Videos are organized into projects</p>
            <div className="grid grid-cols-2 gap-3">
              {(projects ?? []).map((p) => (
                <button key={p.id} data-testid={`button-select-project-${p.id}`}
                  onClick={() => { setProjectId(p.id); setNewProjectTitle(""); }}
                  className={cn(
                    "p-4 rounded-2xl border text-left transition-all",
                    projectId === p.id
                      ? "border-white/40 bg-white/6"
                      : "border-white/8 bg-white/[0.02] hover:border-white/20"
                  )}>
                  <p className="text-sm font-semibold text-white">{p.title}</p>
                  <p className="text-xs text-white/30 mt-1">{p.videoCount} videos</p>
                </button>
              ))}
            </div>
            <div className="border border-dashed border-white/8 rounded-2xl p-5">
              <p className="text-xs text-white/25 mb-3 uppercase tracking-wide">Or create new</p>
              <Input data-testid="input-new-project-title" placeholder="New project name..."
                value={newProjectTitle}
                onChange={(e) => { setNewProjectTitle(e.target.value); setProjectId(null); }}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
            </div>
            <div className="flex justify-end">
              <Button data-testid="button-next-step" onClick={() => setStep(2)}
                disabled={!projectId && !newProjectTitle.trim()}
                className="bg-white text-black hover:bg-white/90 font-semibold rounded-full px-6">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Prompt ──────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Generation type tabs */}
            <div className="flex gap-3">
              {([
                { id: "text-to-video",  label: "Text to Video",    Icon: Video, desc: "Generate from a prompt" },
                { id: "image-to-video", label: "Modify / Animate", Icon: Image, desc: "Animate a still image" },
              ] as const).map(({ id, label, Icon, desc }) => (
                <button key={id} data-testid={`button-gen-type-${id}`}
                  onClick={() => setGenType(id)}
                  className={cn(
                    "flex-1 flex flex-col items-start gap-1 px-4 py-3.5 rounded-2xl border text-sm font-medium transition-all",
                    genType === id
                      ? "border-white/40 bg-white/6 text-white"
                      : "border-white/8 bg-white/[0.02] text-white/30 hover:border-white/20"
                  )}>
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" /> {label}
                  </div>
                  <span className="text-xs font-normal opacity-60">{desc}</span>
                </button>
              ))}
            </div>

            <div>
              <label className="text-[11px] text-white/30 uppercase tracking-widest mb-2 block">Video title</label>
              <Input data-testid="input-title" placeholder="My cinematic video" value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
            </div>

            <div>
              <label className="text-[11px] text-white/30 uppercase tracking-widest mb-2 block">
                {genType === "image-to-video" ? "Motion prompt" : "Prompt"}
              </label>
              <textarea data-testid="input-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/25 resize-none"
                placeholder={genType === "image-to-video"
                  ? "The camera slowly zooms in, the person walks forward..."
                  : "A lone astronaut walks across a dusty alien landscape at golden hour..."} />
            </div>

            {genType === "image-to-video" && (
              <div>
                <label className="text-[11px] text-white/30 uppercase tracking-widest mb-2 block">Source image</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) handleImageFile(f); }}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all",
                    sourceImagePreview ? "border-white/25" : "border-white/10 hover:border-white/20"
                  )}>
                  {sourceImagePreview ? (
                    <div className="flex flex-col items-center gap-2">
                      <img src={sourceImagePreview} alt="Source" className="max-h-40 rounded-xl object-contain mx-auto" />
                      <p className="text-xs text-white/30">Click to change</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4">
                      <Upload className="w-8 h-8 text-white/15" />
                      <p className="text-sm text-white/40 font-medium">Drop image or click to upload</p>
                      <p className="text-xs text-white/20">PNG, JPG, WEBP</p>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleImageFile(e.target.files[0])} />
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex-1 h-px bg-white/6" />
                  <span className="text-xs text-white/20">or paste URL</span>
                  <div className="flex-1 h-px bg-white/6" />
                </div>
                <Input data-testid="input-source-image" placeholder="https://example.com/photo.jpg"
                  value={sourceImageUrl.startsWith("data:") ? "" : sourceImageUrl}
                  onChange={(e) => { setSourceImageUrl(e.target.value); setSourceImagePreview(null); }}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 mt-2" />
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}
                className="border-white/10 text-white/40 hover:text-white hover:bg-white/5 rounded-full">Back</Button>
              <Button data-testid="button-next-step" onClick={() => setStep(3)}
                disabled={!prompt.trim()}
                className="bg-white text-black hover:bg-white/90 font-semibold rounded-full px-6">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Options ─────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-8">
            {/* Style picker */}
            <div>
              <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">Visual style</p>
              <div className="grid grid-cols-2 gap-3">
                {STYLES.map(({ id, label, icon: Icon, desc }) => (
                  <button key={id} data-testid={`button-style-${id}`} onClick={() => setStyle(id as Style)}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all",
                      style === id
                        ? "border-white/40 bg-white/6"
                        : "border-white/8 bg-white/[0.02] hover:border-white/20"
                    )}>
                    <Icon className={cn("w-5 h-5 mb-2", style === id ? "text-white" : "text-white/25")} />
                    <p className={cn("text-sm font-semibold", style === id ? "text-white" : "text-white/60")}>{label}</p>
                    <p className="text-xs text-white/25 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* AI Engine */}
            {genType === "text-to-video" && (
              <div>
                <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">AI engine</p>
                <div className="grid grid-cols-3 gap-2">
                  {AI_MODELS.map(({ id, label, badge, icon: Icon, desc }) => (
                    <button key={id} data-testid={`button-model-${id}`}
                      onClick={() => setAiModel(id as AiModel)}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all",
                        aiModel === id
                          ? "border-white/40 bg-white/6"
                          : "border-white/8 bg-white/[0.02] hover:border-white/20"
                      )}>
                      <div className="flex items-center justify-between mb-2">
                        <Icon className={cn("w-4 h-4", aiModel === id ? "text-white" : "text-white/25")} />
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                          aiModel === id ? "bg-white/15 text-white/70" : "bg-white/5 text-white/20")}>{badge}</span>
                      </div>
                      <p className={cn("text-xs font-semibold", aiModel === id ? "text-white" : "text-white/50")}>{label}</p>
                      <p className="text-[10px] text-white/20 mt-0.5 leading-tight">{desc}</p>
                    </button>
                  ))}
                </div>
                {aiModel === "hunyuan" && (
                  <p className="text-xs text-white/30 mt-2 flex items-center gap-1">
                    <Crown className="w-3 h-3" /> HunyuanVideo takes 3–5 min but delivers cinematic quality
                  </p>
                )}
              </div>
            )}

            {genType === "image-to-video" && (
              <div className="p-4 rounded-2xl border border-white/8 bg-white/[0.02] text-xs text-white/30 flex items-center gap-2">
                <Sparkles className="w-4 h-4 shrink-0" />
                Modify uses Wan 2.1 Image-to-Video — your image becomes the first frame, the AI animates it
              </div>
            )}

            {/* Face Lock */}
            <div className="border border-white/8 rounded-2xl overflow-hidden">
              <div className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-white/40" /> Face Lock
                  </p>
                  <p className="text-xs text-white/25 mt-0.5">Keep a character's face consistent across all frames</p>
                </div>
                <button data-testid="toggle-face-lock" onClick={() => setFaceLock(!faceLock)}
                  className={cn("w-10 h-5.5 rounded-full transition-all relative shrink-0",
                    faceLock ? "bg-white" : "bg-white/10")}>
                  <div className={cn("w-4 h-4 rounded-full absolute top-0.5 transition-all shadow",
                    faceLock ? "left-5 bg-black" : "left-0.5 bg-white/60")} />
                </button>
              </div>

              {faceLock && (
                <div className="px-5 pb-5 border-t border-white/6 pt-4">
                  <p className="text-[11px] text-white/25 uppercase tracking-widest mb-3">Select character</p>
                  {(!characters || characters.length === 0) ? (
                    <p className="text-xs text-white/25">
                      No characters yet.{" "}
                      <a href="/characters" className="text-white/50 hover:text-white underline">Add one in Characters</a>
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {characters.map((c) => (
                        <button key={c.id} data-testid={`button-character-${c.id}`}
                          onClick={() => setCharacterId(c.id)}
                          className={cn(
                            "p-2.5 rounded-xl border text-center text-xs font-medium transition-all flex flex-col items-center gap-1.5",
                            characterId === c.id
                              ? "border-white/40 bg-white/8 text-white"
                              : "border-white/8 text-white/35 hover:border-white/20"
                          )}>
                          {c.imageUrl && (
                            <img src={c.imageUrl} alt={c.name}
                              className="w-10 h-10 rounded-full object-cover border border-white/10" />
                          )}
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Background Replace */}
            <div className="border border-white/8 rounded-2xl overflow-hidden">
              <div className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-white/40" /> Background Replace
                  </p>
                  <p className="text-xs text-white/25 mt-0.5">AI green-screen replacement on generated video</p>
                </div>
                <button data-testid="toggle-bg-replace" onClick={() => setBgReplace(!bgReplace)}
                  className={cn("w-10 h-5.5 rounded-full transition-all relative shrink-0",
                    bgReplace ? "bg-white" : "bg-white/10")}>
                  <div className={cn("w-4 h-4 rounded-full absolute top-0.5 transition-all shadow",
                    bgReplace ? "left-5 bg-black" : "left-0.5 bg-white/60")} />
                </button>
              </div>
              {bgReplace && (
                <div className="px-5 pb-5 border-t border-white/6 pt-4">
                  <Input data-testid="input-bg-prompt" placeholder="A futuristic city at night..."
                    value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20" />
                </div>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)}
                className="border-white/10 text-white/40 hover:text-white hover:bg-white/5 rounded-full">Back</Button>
              <Button data-testid="button-generate" onClick={handleGenerate}
                disabled={generateVideo.isPending}
                className="bg-white text-black hover:bg-white/90 font-semibold rounded-full px-6 gap-2">
                <Sparkles className="w-4 h-4" />
                {generateVideo.isPending ? "Generating..." : "Generate Video"}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Queued ──────────────────────────────────────── */}
        {step === 4 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-white/6 flex items-center justify-center mx-auto mb-8">
              <Sparkles className="w-8 h-8 text-white/60" />
            </div>
            <h2 className="text-2xl font-semibold text-white mb-3">Video queued</h2>
            <p className="text-white/35 text-sm mb-2 max-w-sm mx-auto">
              Your video is being generated by AI. This typically takes 1–5 minutes depending on the engine.
            </p>
            {aiModel === "hunyuan" && (
              <p className="text-xs text-white/25 mb-8">HunyuanVideo is processing — allow up to 5 min for cinematic quality.</p>
            )}
            <div className="flex gap-4 justify-center mt-8">
              <Button data-testid="button-view-video"
                onClick={() => generatedVideoId && setLocation(`/videos/${generatedVideoId}`)}
                className="bg-white text-black hover:bg-white/90 font-semibold rounded-full px-6">
                View Video
              </Button>
              <Button data-testid="button-create-another" variant="outline"
                onClick={() => {
                  setStep(1); setPrompt(""); setTitle(""); setProjectId(null);
                  setNewProjectTitle(""); setFaceLock(false); setBgReplace(false);
                  setCharacterId(null); setSourceImageUrl(""); setSourceImagePreview(null);
                  setAiModel("wan-2.1");
                }}
                className="border-white/10 text-white/40 hover:text-white hover:bg-white/5 rounded-full">
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
