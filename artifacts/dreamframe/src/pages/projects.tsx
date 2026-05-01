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
      <div className="p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">{projects?.length ?? 0} projects</p>
          </div>
          <Button data-testid="button-new-project" onClick={() => setOpen(true)} className="bg-primary hover:bg-primary/90 gap-2">
            <Plus className="w-4 h-4" /> New Project
          </Button>
        </div>

        <div className="mb-6">
          <Input
            data-testid="input-search"
            type="search"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs bg-card"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-48 rounded-xl bg-card border border-card-border shimmer" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No projects yet</p>
            <p className="text-sm mt-1">Create your first project to organize your videos</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((project) => (
              <div key={project.id} data-testid={`card-project-${project.id}`} className="group bg-card border border-card-border rounded-xl overflow-hidden hover:border-primary/40 transition-all duration-200">
                <div className="h-32 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent relative">
                  {project.thumbnailUrl && (
                    <img src={project.thumbnailUrl} alt={project.title} className="w-full h-full object-cover opacity-60" />
                  )}
                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    <StatusBadge status={project.status} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button data-testid={`button-project-menu-${project.id}`} className="p-1.5 rounded-md bg-black/40 hover:bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          data-testid={`button-delete-project-${project.id}`}
                          onClick={() => onDelete(project.id, project.title)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="p-4">
                  <Link href={`/projects/${project.id}`}>
                    <h3 data-testid={`text-project-title-${project.id}`} className="font-semibold text-foreground hover:text-primary transition-colors cursor-pointer">{project.title}</h3>
                  </Link>
                  {project.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{project.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Video className="w-3 h-3" /> {project.videoCount} videos</span>
                    <span>{formatDate(project.updatedAt.toString())}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="bg-card border-card-border">
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project title</FormLabel>
                    <FormControl>
                      <Input data-testid="input-project-title" placeholder="My AI Film" {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description <span className="text-muted-foreground">(optional)</span></FormLabel>
                    <FormControl>
                      <Input data-testid="input-project-description" placeholder="A brief description..." {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex gap-3 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button data-testid="button-create-project-submit" type="submit" className="bg-primary hover:bg-primary/90" disabled={createProject.isPending}>
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
