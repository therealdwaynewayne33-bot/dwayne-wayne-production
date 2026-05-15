import { Link } from "wouter";
import { useGetProject, useListVideos, getGetProjectQueryKey, getListVideosQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Video, Clock } from "lucide-react";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(s?: number | null) {
  if (!s) return "—";
  return `${Math.floor(s)}s`;
}

export default function ProjectDetailPage({ id }: { id: number }) {
  const { data: project, isLoading: pLoading } = useGetProject(id, { query: { queryKey: getGetProjectQueryKey(id) } });
  const { data: videos, isLoading: vLoading } = useListVideos({ projectId: id }, { query: { queryKey: getListVideosQueryKey({ projectId: id }) } });

  const videoList = Array.isArray(videos) ? videos : [];

  if (pLoading) {
    return (
      <AppLayout>
        <div className="p-8 animate-pulse">
          <div className="h-8 bg-card rounded w-48 mb-4" />
          <div className="h-4 bg-card rounded w-96" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="p-8 text-muted-foreground">Project not found.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-8 max-w-6xl mx-auto">
        <Link href="/projects">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Projects
          </button>
        </Link>

        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-foreground">{project.title}</h1>
              <StatusBadge status={project.status} />
            </div>
            {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
            <p className="text-xs text-muted-foreground mt-1">Updated {formatDate(project.updatedAt.toString())}</p>
          </div>
          <Link href={`/create?projectId=${id}`}>
            <Button data-testid="button-add-video" className="bg-primary hover:bg-primary/90 gap-2">
              <Plus className="w-4 h-4" /> Add Video
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Videos", value: project.videoCount },
            { label: "Status", value: project.status },
            { label: "Created", value: formatDate(project.createdAt.toString()) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-card-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
              <p className="text-sm font-semibold text-foreground capitalize">{String(value)}</p>
            </div>
          ))}
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Videos</h2>

        {vLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-card rounded-lg shimmer" />
            ))}
          </div>
        ) : videoList.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
            <Video className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No videos in this project</p>
            <p className="text-sm mt-1">Add your first video to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {videoList.map((video) => (
              <Link key={video.id} href={`/videos/${video.id}`}>
                <div data-testid={`card-video-${video.id}`} className="flex items-center gap-4 p-4 bg-card border border-card-border rounded-xl hover:border-primary/40 cursor-pointer transition-all duration-200">
                  <div className="w-16 h-10 rounded-lg bg-background overflow-hidden shrink-0">
                    {video.thumbnailUrl ? (
                      <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-primary/10">
                        <Video className="w-4 h-4 text-primary/40" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p data-testid={`text-video-title-${video.id}`} className="text-sm font-semibold text-foreground truncate">{video.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{video.prompt}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground capitalize">{video.style.replace("-", " ")}</span>
                    {video.duration && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />{formatDuration(video.duration)}
                      </span>
                    )}
                    <StatusBadge status={video.status} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
