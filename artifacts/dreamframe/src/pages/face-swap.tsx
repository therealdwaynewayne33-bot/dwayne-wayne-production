import { useState, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Upload, Sparkles, UserCircle2, CheckCircle2, X, ArrowRight, ImageIcon } from "lucide-react";
import { useListCharacters, describeFetchFailure } from "@workspace/api-client-react";

type Stage = "idle" | "processing" | "done" | "error";

function DropZone({
  label,
  sublabel,
  preview,
  onFile,
  onClear,
  testId,
}: {
  label: string;
  sublabel: string;
  preview: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
  testId?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("image/")) onFile(f);
  }, [onFile]);

  return (
    <div>
      <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">{label}</p>
      <div
        data-testid={testId}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !preview && ref.current?.click()}
        className={cn(
          "relative rounded-2xl border-2 border-dashed transition-all overflow-hidden",
          dragging ? "border-white/40 bg-white/5" : preview ? "border-white/15 cursor-default" : "border-white/10 hover:border-white/25 cursor-pointer",
          "aspect-square"
        )}
      >
        {preview ? (
          <>
            <img src={preview} alt={label} className="w-full h-full object-cover" />
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/80 hover:bg-black flex items-center justify-center text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <div className={cn("w-12 h-12 rounded-full bg-white/6 flex items-center justify-center", dragging && "bg-white/12")}>
              <Upload className={cn("w-5 h-5", dragging ? "text-white/60" : "text-white/20")} />
            </div>
            <div>
              <p className="text-sm font-medium text-white/40">{sublabel}</p>
              <p className="text-xs text-white/15 mt-1">PNG, JPG, WEBP</p>
            </div>
          </div>
        )}
        <input ref={ref} type="file" accept="image/*" className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>
    </div>
  );
}

export default function FaceSwapPage() {
  const [swapFile, setSwapFile]     = useState<File | null>(null);
  const [swapPreview, setSwapPreview]   = useState<string | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [targetPreview, setTargetPreview] = useState<string | null>(null);
  const [stage, setStage]           = useState<Stage>("idle");
  const [result, setResult]         = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<number | null>(null);
  const { data: characters }        = useListCharacters();
  const { toast }                   = useToast();

  const characterList = Array.isArray(characters) ? characters : [];

  const loadFile = (file: File, setFile: typeof setSwapFile, setPreview: typeof setSwapPreview) => {
    setFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const useCharacter = async (charId: number) => {
    const char = characterList.find((c) => c.id === charId);
    if (!char?.imageUrl) return;
    setSelectedCharId(charId);
    // Convert URL or data URL to a File
    const resp = await fetch(char.imageUrl);
    const blob = await resp.blob();
    const file = new File([blob], `char-${charId}.png`, { type: "image/png" });
    loadFile(file, setSwapFile, setSwapPreview);
  };

  const handleSubmit = async () => {
    if (!swapFile || !targetFile) {
      toast({ title: "Upload both images first", variant: "destructive" });
      return;
    }
    setStage("processing");
    setError(null);

    const form = new FormData();
    form.append("swapImage",  swapFile);
    form.append("targetImage", targetFile);

    try {
      const token = localStorage.getItem("dreamframe_token");
      form.append("selectedMode", "face_swap");
      const resp = await fetch("/api/render/production", {
        method: "POST",
        body: form,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const raw = await resp.text();
      let data: { error?: string; imageUrl?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(raw.trim() ? raw.slice(0, 400) : `Face swap failed (${resp.status})`);
      }
      if (!resp.ok) throw new Error(typeof data?.error === "string" ? data.error : "Unknown error");
      if (!data.imageUrl) throw new Error("Face swap succeeded but no image URL was returned");
      setResult(data.imageUrl);
      setStage("done");
    } catch (err: any) {
      setError(describeFetchFailure(err instanceof Error ? err : new Error(String(err?.message ?? err))));
      setStage("error");
    }
  };

  const reset = () => {
    setSwapFile(null); setSwapPreview(null);
    setTargetFile(null); setTargetPreview(null);
    setResult(null); setError(null);
    setStage("idle"); setSelectedCharId(null);
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-8 py-14">
        {/* Header */}
        <div className="mb-12">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-2">AI face replacement</p>
          <h1 className="text-4xl font-semibold text-white tracking-tight">Face Swap</h1>
          <p className="text-sm text-white/30 mt-2">
            Put any face onto any photo — upload a face source and a target image, AI composites them together
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left: inputs */}
          <div className="space-y-7">
            {/* Character library shortcut */}
            {characterList.length > 0 && (
              <div>
                <p className="text-[11px] text-white/30 uppercase tracking-widest mb-3">Use a character</p>
                <div className="flex flex-wrap gap-2">
                  {characterList.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => useCharacter(c.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-full border text-xs font-medium transition-all",
                        selectedCharId === c.id
                          ? "border-white/40 bg-white/10 text-white"
                          : "border-white/10 text-white/40 hover:border-white/25 hover:text-white/70"
                      )}
                    >
                      {c.imageUrl && (
                        <img src={c.imageUrl} alt={c.name} className="w-5 h-5 rounded-full object-cover" />
                      )}
                      {c.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-5 mb-2">
                  <div className="flex-1 h-px bg-white/6" />
                  <span className="text-xs text-white/20">or upload directly</span>
                  <div className="flex-1 h-px bg-white/6" />
                </div>
              </div>
            )}

            {/* Two drop zones */}
            <div className="grid grid-cols-2 gap-4">
              <DropZone
                label="Face source"
                sublabel="The face to use"
                preview={swapPreview}
                onFile={(f) => { loadFile(f, setSwapFile, setSwapPreview); setSelectedCharId(null); }}
                onClear={() => { setSwapFile(null); setSwapPreview(null); setSelectedCharId(null); }}
                testId="drop-zone-swap"
              />
              <DropZone
                label="Target photo"
                sublabel="Where to put the face"
                preview={targetPreview}
                onFile={(f) => loadFile(f, setTargetFile, setTargetPreview)}
                onClear={() => { setTargetFile(null); setTargetPreview(null); }}
                testId="drop-zone-target"
              />
            </div>

            {/* Arrow hint */}
            {swapPreview && targetPreview && (
              <div className="flex items-center gap-3 text-xs text-white/25">
                <div className="w-8 h-8 rounded-full overflow-hidden border border-white/15 shrink-0">
                  <img src={swapPreview} className="w-full h-full object-cover" />
                </div>
                <ArrowRight className="w-4 h-4 shrink-0 text-white/20" />
                <div className="w-8 h-8 rounded-full overflow-hidden border border-white/15 shrink-0">
                  <img src={targetPreview} className="w-full h-full object-cover" />
                </div>
                <span className="ml-1">Face will be swapped onto the target</span>
              </div>
            )}

            {/* Submit */}
            <Button
              data-testid="button-face-swap"
              onClick={handleSubmit}
              disabled={!swapFile || !targetFile || stage === "processing"}
              className="w-full bg-white text-black hover:bg-white/90 font-semibold gap-2 h-11 rounded-full"
            >
              {stage === "processing" ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                  Swapping faces...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Swap Face
                </>
              )}
            </Button>

            {stage === "processing" && (
              <div className="border border-white/8 rounded-2xl p-5 space-y-3">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Processing</p>
                {["Uploading images", "Detecting faces", "Compositing with face enhancer", "Finalizing result"].map((s, i) => (
                  <div key={s} className="flex items-center gap-3">
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", i < 2 ? "bg-white animate-pulse" : "bg-white/15")} />
                    <span className="text-xs text-white/35">{s}</span>
                  </div>
                ))}
                <p className="text-[11px] text-white/20 pt-1">Usually takes 30–60 seconds</p>
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
                <div className="flex items-center gap-2 text-sm font-medium text-white/50 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Face swap complete</span>
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/8">
                  <img src={result} alt="Face swap result" className="w-full object-contain" />
                </div>
                <a href={result} download className="block">
                  <Button variant="outline"
                    className="w-full border-white/10 text-white/50 hover:text-white hover:border-white/25 hover:bg-white/5 rounded-full">
                    Download image
                  </Button>
                </a>
                <button onClick={reset} className="w-full text-xs text-white/20 hover:text-white/40 transition-colors py-2">
                  Swap another
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/8 aspect-square flex flex-col items-center justify-center text-center p-10 gap-6">
                <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center">
                  <UserCircle2 className="w-8 h-8 text-white/12" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/25 mb-1">Result appears here</p>
                  <p className="text-xs text-white/15">Upload a face source and a target photo</p>
                </div>
                <div className="text-[11px] text-white/15 space-y-1.5 text-left w-full max-w-xs">
                  <p className="text-white/25 font-medium mb-2">How it works</p>
                  <p>1. Upload the face you want to use (swap image)</p>
                  <p>2. Upload the photo to put it on (target image)</p>
                  <p>3. AI detects and replaces the face with enhancement</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Face Lock info banner */}
        <div className="mt-14 border border-white/6 rounded-2xl p-6 flex items-start gap-5">
          <div className="w-10 h-10 rounded-xl bg-white/6 flex items-center justify-center shrink-0">
            <ImageIcon className="w-5 h-5 text-white/25" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white/60 mb-1">Face Lock for video generation</p>
            <p className="text-xs text-white/25 leading-relaxed">
              Want consistent character faces across a generated video? Use <strong className="text-white/40">Create Video → Step 3 → Face Lock</strong>.
              Upload your character in the Characters page, then enable Face Lock and select them when creating a video.
              The AI will use that face as the first frame reference.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
