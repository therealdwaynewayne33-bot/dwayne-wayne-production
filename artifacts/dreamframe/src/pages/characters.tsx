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
import { Plus, Users, Trash2, Video, Upload, ImageIcon } from "lucide-react";
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
      data: { name: data.name, description: data.description, imageUrl: imageDataUrl.substring(0, 500) }
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
      <div className="p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Character Library</h1>
            <p className="text-sm text-muted-foreground mt-1">{characters?.length ?? 0} characters saved</p>
          </div>
          <Button data-testid="button-add-character" onClick={() => setOpen(true)} className="bg-primary hover:bg-primary/90 gap-2">
            <Plus className="w-4 h-4" /> Add Character
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-52 rounded-xl bg-card border border-card-border shimmer" />
            ))}
          </div>
        ) : !characters || characters.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground border border-dashed border-border rounded-xl">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No characters yet</p>
            <p className="text-sm mt-1">Upload a character to enable face-lock consistency across videos</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {characters.map((char) => (
              <div key={char.id} data-testid={`card-character-${char.id}`} className="group bg-card border border-card-border rounded-xl overflow-hidden hover:border-primary/40 transition-all duration-200">
                <div className="h-36 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center relative overflow-hidden">
                  {char.imageUrl && char.imageUrl.startsWith("data:image") ? (
                    <img src={char.imageUrl} alt={char.name} className="w-full h-full object-cover" />
                  ) : char.imageUrl ? (
                    <img src={char.imageUrl} alt={char.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                      <Users className="w-8 h-8 text-primary/40" />
                    </div>
                  )}
                  <button
                    data-testid={`button-delete-character-${char.id}`}
                    onClick={() => onDelete(char.id, char.name)}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 hover:bg-destructive text-white opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  <h3 data-testid={`text-character-name-${char.id}`} className="text-sm font-semibold text-foreground">{char.name}</h3>
                  {char.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{char.description}</p>}
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Video className="w-3 h-3" />
                    <span data-testid={`text-character-videocount-${char.id}`}>{char.videoCount} videos</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPreviewUrl(null); setImageDataUrl(null); form.reset(); } }}>
          <DialogContent className="bg-card border-card-border max-w-md">
            <DialogHeader>
              <DialogTitle>Add Character</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div
                  data-testid="drop-zone"
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  {previewUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <img src={previewUrl} alt="Preview" className="w-24 h-24 rounded-full object-cover border-2 border-primary" />
                      <p className="text-xs text-muted-foreground">Click to change</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        {dragging ? <ImageIcon className="w-6 h-6 text-primary" /> : <Upload className="w-6 h-6 text-primary/60" />}
                      </div>
                      <div>
                        <p className="text-sm text-foreground font-medium">Drop image here or click to upload</p>
                        <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, WEBP — face clearly visible</p>
                      </div>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                </div>
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Character name</FormLabel>
                    <FormControl>
                      <Input data-testid="input-character-name" placeholder="e.g. Maya Chen" {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description <span className="text-muted-foreground">(optional)</span></FormLabel>
                    <FormControl>
                      <Input data-testid="input-character-description" placeholder="Role or notes..." {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex gap-3 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button data-testid="button-save-character" type="submit" className="bg-primary hover:bg-primary/90" disabled={createCharacter.isPending}>
                    {createCharacter.isPending ? "Saving..." : "Save Character"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
