import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useCreateProject, useDeleteProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Plus, FolderOpen, Video, MoreHorizontal, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const createSchema = z.object({
  title: z.string().min(1, "Title required"),
  description: z.string().optional(),
});
type CreateData = z.infer<typeof createSchema>;

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: projects, isLoading } = useListProjects({ query: { queryKey: getListProjectsQueryKey() } });
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<CreateData>({
    resolver: zodResolver(createSchema),
    defaultValues: { title: "", description: "" },
  });

  const filtered = (projects ?? []).filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const onSubmit = (data: CreateData) => {
    createProject.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setOpen(false);
        form.reset();
        toast({ title: "Project created" });
      },
    });
  };

  const onDelete = (id: number, title: string) => {
    deleteProject.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: `"${title}" deleted` });
      },
    });
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-8 py-14">
        <div className="flex items-end justify-between mb-12">
          <div>
            <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Your work</p>
            <h1 className="text-4xl font-semibold text-white tracking-tight">Projects</h1>
          </div>
          <Button data-testid="button-new-project" onClick={() => setOpen(true)}
            className="bg-white text-black hover:bg-white/90 rounded-full px-5 gap-2 font-semibold">
            <Plus className="w-4 h-4" /> New project
          </Button>
        </div>

        <div className="mb-8">
          <Input
            data-testid="input-search"
            type="search"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs bg-white/5 border-white/10 text-white placeholder:text-white/25 focus-visible:ring-white/20"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-48 rounded-2xl bg-white/4 shimmer" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-28 text-white/20">
            <FolderOpen className="w-10 h-10 mx-auto mb-5 opacity-40" />
            <p className="text-lg font-medium text-white/30">No projects yet</p>
            <p className="text-sm mt-2">Create your first project to organize your videos</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((project) => (
              <div key={project.id} data-testid={`card-project-${project.id}`}
                className="group border border-white/8 rounded-2xl overflow-hidden hover:border-white/20 transition-all duration-200 bg-white/[0.02]">
                <div className="h-36 bg-white/4 relative">
                  {project.thumbnailUrl && (
                    <img src={project.thumbnailUrl} alt={project.title} className="w-full h-full object-cover opacity-50" />
                  )}
                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    <StatusBadge status={project.status} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button data-testid={`button-project-menu-${project.id}`}
                          className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          data-testid={`button-delete-project-${project.id}`}
                          onClick={() => onDelete(project.id, project.title)}
                          className="text-destructive focus:text-destructive">
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="p-5">
                  <Link href={`/projects/${project.id}`}>
                    <h3 data-testid={`text-project-title-${project.id}`}
                      className="font-semibold text-white hover:text-white/70 transition-colors cursor-pointer">{project.title}</h3>
                  </Link>
                  {project.description && (
                    <p className="text-xs text-white/35 mt-1.5 line-clamp-2">{project.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-4 text-xs text-white/25">
                    <span className="flex items-center gap-1"><Video className="w-3 h-3" /> {project.videoCount} videos</span>
                    <span>{formatDate(project.updatedAt.toString())}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="bg-[#0a0a0a] border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white">New project</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/50 text-xs uppercase tracking-wide">Title</FormLabel>
                    <FormControl>
                      <Input data-testid="input-project-title" placeholder="My AI Film" {...field}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/50 text-xs uppercase tracking-wide">Description <span className="normal-case text-white/25">(optional)</span></FormLabel>
                    <FormControl>
                      <Input data-testid="input-project-description" placeholder="A brief description..." {...field}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex gap-3 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}
                    className="border-white/10 text-white/50 hover:text-white hover:bg-white/5">Cancel</Button>
                  <Button data-testid="button-create-project-submit" type="submit"
                    className="bg-white text-black hover:bg-white/90 font-semibold" disabled={createProject.isPending}>
                    {createProject.isPending ? "Creating..." : "Create project"}
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
