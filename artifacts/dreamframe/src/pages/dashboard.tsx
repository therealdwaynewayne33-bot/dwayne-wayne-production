import { Link } from "wouter";
import { useGetDashboardSummary, useGetRecentActivity, useGetStyleBreakdown, getGetDashboardSummaryQueryKey, getGetRecentActivityQueryKey, getGetStyleBreakdownQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { Plus, Video, FolderOpen, Users, TrendingUp, Clock, Zap, Crown } from "lucide-react";

const STYLE_COLORS: Record<string, string> = {
  realistic: "#8b5cf6",
  cartoon: "#06b6d4",
  "animated-3d": "#f59e0b",
  cinematic: "#ec4899",
};

const ACTIVITY_ICONS: Record<string, string> = {
  video_generated: "🎬",
  character_added: "👤",
  project_created: "📁",
  style_applied: "🎨",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StyleDonut({ data }: { data: { style: string; count: number }[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return null;
  let cumulative = 0;
  const stops = data.map((d) => {
    const pct = (d.count / total) * 100;
    const color = STYLE_COLORS[d.style] ?? "#8b5cf6";
    const stop = `${color} ${cumulative}% ${cumulative + pct}%`;
    cumulative += pct;
    return stop;
  });
  return (
    <div className="relative w-24 h-24 mx-auto mb-3">
      <div
        className="w-full h-full rounded-full"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      />
      <div className="absolute inset-[28%] rounded-full bg-card" />
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: activity } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const { data: styleBreakdown } = useGetStyleBreakdown({ query: { queryKey: getGetStyleBreakdownQueryKey() } });

  const usagePercent = summary ? Math.min(100, Math.round((summary.planUsed / summary.planLimit) * 100)) : 0;

  return (
    <AppLayout>
      <div className="p-8 max-w-6xl mx-auto">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Welcome back</p>
            <h1 className="text-3xl font-bold text-foreground">{user?.name ?? "Studio"}</h1>
          </div>
          <Link href="/create">
            <button data-testid="button-create-video" className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4" />
              Create Video
            </button>
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Projects", value: summary?.totalProjects ?? 0, icon: FolderOpen, color: "text-violet-400" },
            { label: "Total Videos", value: summary?.totalVideos ?? 0, icon: Video, color: "text-cyan-400" },
            { label: "Characters", value: summary?.totalCharacters ?? 0, icon: Users, color: "text-pink-400" },
            { label: "Processing", value: summary?.processingCount ?? 0, icon: Zap, color: "text-amber-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} data-testid={`stat-${label.toLowerCase().replace(" ", "-")}`} className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="text-3xl font-bold text-foreground">{summaryLoading ? "—" : value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Recent Activity</h2>
              <Clock className="w-4 h-4 text-muted-foreground" />
            </div>
            {!activity || activity.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No activity yet. Create your first video to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {activity.slice(0, 8).map((item) => (
                  <div key={item.id} data-testid={`activity-item-${item.id}`} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                    <span className="text-base">{ACTIVITY_ICONS[item.type] ?? "•"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{item.description}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(item.createdAt.toString())}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-card border border-card-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Plan Usage</h2>
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-muted-foreground capitalize">{user?.plan} plan</span>
                <span className="text-foreground font-medium">{summary?.planUsed ?? 0} / {summary?.planLimit ?? 10}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  data-testid="stat-plan-usage"
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">{usagePercent}% used</p>
              {user?.plan === "free" && (
                <Link href="/pricing">
                  <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20 cursor-pointer hover:bg-primary/15 transition-colors flex items-center gap-2">
                    <Crown className="w-3.5 h-3.5 text-primary shrink-0" />
                    <p className="text-xs text-primary font-medium">Upgrade to Pro — 100 videos/month</p>
                  </div>
                </Link>
              )}
              {user?.plan === "pro" && usagePercent >= 80 && (
                <Link href="/pricing">
                  <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 cursor-pointer hover:bg-amber-500/15 transition-colors flex items-center gap-2">
                    <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-400 font-medium">Running low — upgrade to Enterprise</p>
                  </div>
                </Link>
              )}
            </div>

            <div className="bg-card border border-card-border rounded-xl p-6">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Styles Used</h2>
              {!styleBreakdown || styleBreakdown.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Generate videos to see style stats</p>
              ) : (
                <>
                  <StyleDonut data={styleBreakdown} />
                  <div className="space-y-1 mt-2">
                    {styleBreakdown.map((s) => (
                      <div key={s.style} className="flex items-center gap-2 text-xs">
                        <div className="w-2 h-2 rounded-full" style={{ background: STYLE_COLORS[s.style] ?? "#8b5cf6" }} />
                        <span className="text-muted-foreground capitalize">{s.style}</span>
                        <span className="ml-auto text-foreground">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
