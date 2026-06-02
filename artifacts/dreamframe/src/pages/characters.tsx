import { useState, useRef } from "react";
import { useListCharacters, useCreateCharacter, useDeleteCharacter, getListCharactersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Plus, Users, Trash2, Video, Upload, ImageIcon, Sparkles, Loader2Icon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
});
type CreateData = z.infer<typeof createSchema>;

export default function CharactersPage() {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: characters, isLoading } = useListCharacters({ query: { queryKey: getListCharactersQueryKey() } });
  const createCharacter = useCreateCharacter();
  const deleteCharacter = useDeleteCharacter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [videoChar, setVideoChar] = useState<{ id: number; name: string; imageUrl: string | null } | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoResult, setVideoResult] = useState<string | null>(null);
  const [podAvailable, setPodAvailable] = useState<boolean | null>(null);

  const checkPodStatus = async () => {
    try {
      const res = await fetch("/api/video/consistent/status");
      const data = await res.json();
      setPodAvailable(data.available === true);
    } catch {
      setPodAvailable(false);
    }
  };

  const openVideoDialog = (char: { id: number; name: string; imageUrl: string | null }) => {
    setVideoChar(char);
    setVideoResult(null);
    setPodAvailable(null);
    checkPodStatus();
  };

  const generateVideo = async (mode: "background" | "clothes") => {
    if (!videoChar?.imageUrl) return;
    setVideoLoading(true);
    setVideoResult(null);
    try {
      const res = await fetch("/api/video/consistent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: videoChar.imageUrl, mode }),
      });
      const data = await res.json();
      if (data.code === "RUNPOD_UNAVAILABLE") {
        setPodAvailable(false);
        toast({ title: data.error, variant: "destructive" });
      } else if (data.success && data.video) {
        setVideoResult(data.video);
      } else {
        toast({ title: data.error ?? "Generation failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to reach server", variant: "destructive" });
    } finally {
      setVideoLoading(false);
    }
  };

  const characterList = Array.isArray(characters) ? characters : [];

  const form = useForm<CreateData>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", description: "" },
  });

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setPreviewUrl(url);
      setImageDataUrl(url);
    };
    reader.readAsDataURL(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const onSubmit = (data: CreateData) => {
    if (!imageDataUrl) {
      toast({ title: "Please upload a character image", variant: "destructive" });
      return;
    }
    createCharacter.mutate({
      data: { name: data.name, description: data.description, imageUrl: imageDataUrl }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCharactersQueryKey() });
        setOpen(false);
        form.reset();
        setPreviewUrl(null);
        setImageDataUrl(null);
        toast({ title: "Character added to library" });
      },
    });
  };

  const onDelete = (id: number, name: string) => {
    deleteCharacter.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCharactersQueryKey() });
        toast({ title: `"${name}" removed` });
      },
    });
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-8 py-14">
        <div className="flex items-end justify-between mb-12">
          <div>
            <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Face-lock consistency</p>
            <h1 className="text-4xl font-semibold text-white tracking-tight">Characters</h1>
          </div>
          <Button data-testid="button-add-character" onClick={() => setOpen(true)}
            className="bg-white text-black hover:bg-white/90 rounded-full px-5 gap-2 font-semibold">
            <Plus className="w-4 h-4" /> Add character
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-52 rounded-2xl bg-white/4 shimmer" />
            ))}
          </div>
        ) : characterList.length === 0 ? (
          <div className="text-center py-28 border border-dashed border-white/8 rounded-2xl">
            <Users className="w-10 h-10 mx-auto mb-5 text-white/15" />
            <p className="text-lg font-medium text-white/25">No characters yet</p>
            <p className="text-sm mt-2 text-white/15">Upload a face to enable face-lock consistency across videos</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {characterList.map((char) => (
              <div key={char.id} data-testid={`card-character-${char.id}`}
                className="group border border-white/8 rounded-2xl overflow-hidden hover:border-white/20 transition-all duration-200 bg-white/[0.02]">
                <div className="h-40 bg-white/5 flex items-center justify-center relative overflow-hidden">
                  {char.imageUrl ? (
                    <img src={char.imageUrl} alt={char.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                      <Users className="w-7 h-7 text-white/20" />
                    </div>
                  )}
                  <button
                    data-testid={`button-delete-character-${char.id}`}
                    onClick={() => onDelete(char.id, char.name)}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {char.imageUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openVideoDialog(char); }}
                      className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-white/20 text-white opacity-0 group-hover:opacity-100 transition-all"
                      title="Generate consistent video"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="p-4">
                  <h3 data-testid={`text-character-name-${char.id}`}
                    className="text-sm font-semibold text-white">{char.name}</h3>
                  {char.description && <p className="text-xs text-white/30 mt-1 line-clamp-1">{char.description}</p>}
                  <div className="flex items-center gap-1 mt-3 text-xs text-white/20">
                    <Video className="w-3 h-3" />
                    <span data-testid={`text-character-videocount-${char.id}`}>{char.videoCount} videos</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPreviewUrl(null); setImageDataUrl(null); form.reset(); } }}>
          <DialogContent className="bg-[#0a0a0a] border-white/10 max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">Add character</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div
                  data-testid="drop-zone"
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${dragging ? "border-white/40 bg-white/5" : "border-white/10 hover:border-white/20"}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  {previewUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <img src={previewUrl} alt="Preview" className="w-24 h-24 rounded-full object-cover border-2 border-white/20" />
                      <p className="text-xs text-white/30">Click to change</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-white/6 flex items-center justify-center">
                        {dragging ? <ImageIcon className="w-6 h-6 text-white/60" /> : <Upload className="w-6 h-6 text-white/30" />}
                      </div>
                      <div>
                        <p className="text-sm text-white/60 font-medium">Drop image here or click to upload</p>
                        <p className="text-xs text-white/25 mt-0.5">PNG, JPG, WEBP — face clearly visible</p>
                      </div>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                </div>
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/40 text-xs uppercase tracking-wide">Character name</FormLabel>
                    <FormControl>
                      <Input data-testid="input-character-name" placeholder="e.g. Maya Chen" {...field}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/40 text-xs uppercase tracking-wide">Description <span className="normal-case text-white/20">(optional)</span></FormLabel>
                    <FormControl>
                      <Input data-testid="input-character-description" placeholder="Role or notes..." {...field}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex gap-3 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}
                    className="border-white/10 text-white/40 hover:text-white hover:bg-white/5">Cancel</Button>
                  <Button data-testid="button-save-character" type="submit"
                    className="bg-white text-black hover:bg-white/90 font-semibold" disabled={createCharacter.isPending}>
                    {createCharacter.isPending ? "Saving..." : "Save character"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Dialog open={!!videoChar} onOpenChange={(v) => { if (!v) { setVideoChar(null); setVideoResult(null); setVideoLoading(false); } }}>
          <DialogContent className="bg-[#0a0a0a] border-white/10 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-white">Consistent character video</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {videoChar?.imageUrl && (
                <div className="flex items-center gap-3 mb-2">
                  <img src={videoChar.imageUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-white/10" />
                  <span className="text-sm text-white/60">{videoChar.name}</span>
                </div>
              )}
              {podAvailable === false ? (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                  <p className="text-sm text-white/50">RunPod video generation is currently unavailable.</p>
                </div>
              ) : (
                <div className="flex gap-3">
                  <Button onClick={() => generateVideo("background")}
                    disabled={videoLoading || podAvailable === null}
                    className="flex-1 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-xl py-6">
                    {videoLoading ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                    Animate Background Only
                  </Button>
                  <Button onClick={() => generateVideo("clothes")}
                    disabled={videoLoading || podAvailable === null}
                    className="flex-1 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-xl py-6">
                    {videoLoading ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                    Animate Clothes Only
                  </Button>
                </div>
              )}
              {videoLoading && (
                <p className="text-xs text-white/30 text-center">AI is locking character coordinates and animating frames...</p>
              )}
              {videoResult && (
                <video src={videoResult} autoPlay loop muted controls
                  className="w-full rounded-xl border border-white/10 mt-2" />
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
