import { Link } from "wouter";
import { useGetDashboardSummary, useGetRecentActivity, useGetStyleBreakdown, getGetDashboardSummaryQueryKey, getGetRecentActivityQueryKey, getGetStyleBreakdownQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { Plus, Video, FolderOpen, Users, TrendingUp, Clock, Zap, Crown } from "lucide-react";

const STYLE_COLORS: Record<string, string> = {
  realistic: "#ffffff",
  cartoon: "#a0a0a0",
  "animated-3d": "#606060",
  cinematic: "#303030",
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

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: activity } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const { data: styleBreakdown } = useGetStyleBreakdown({ query: { queryKey: getGetStyleBreakdownQueryKey() } });

  const usagePercent = summary ? Math.min(100, Math.round((summary.planUsed / summary.planLimit) * 100)) : 0;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-8 py-14">
        {/* Header */}
        <div className="mb-12 flex items-end justify-between">
          <div>
            <p className="text-sm text-white/30 mb-2 uppercase tracking-widest font-medium">Welcome back</p>
            <h1 className="text-4xl font-semibold text-white tracking-tight">{user?.name ?? "Studio"}</h1>
          </div>
          <Link href="/create">
            <button data-testid="button-create-video"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-all">
              <Plus className="w-4 h-4" />
              Create video
            </button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/6 rounded-2xl overflow-hidden mb-14">
          {[
            { label: "Projects", value: summary?.totalProjects ?? 0, icon: FolderOpen },
            { label: "Videos", value: summary?.totalVideos ?? 0, icon: Video },
            { label: "Characters", value: summary?.totalCharacters ?? 0, icon: Users },
            { label: "Processing", value: summary?.processingCount ?? 0, icon: Zap },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} data-testid={`stat-${label.toLowerCase().replace(" ", "-")}`}
              className="bg-black px-7 py-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-white/30 uppercase tracking-widest">{label}</span>
                <Icon className="w-4 h-4 text-white/20" />
              </div>
              <div className="text-4xl font-semibold text-white tracking-tight">{summaryLoading ? "—" : value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Recent Activity */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xs font-semibold text-white/30 uppercase tracking-widest">Recent Activity</h2>
              <Clock className="w-3.5 h-3.5 text-white/20" />
            </div>
            {!activity || activity.length === 0 ? (
              <div className="text-center py-16 text-white/20 text-sm">
                No activity yet. Create your first video to get started.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {activity.slice(0, 8).map((item) => (
                  <div key={item.id} data-testid={`activity-item-${item.id}`}
                    className="flex items-center gap-4 py-3.5">
                    <span className="text-base opacity-60">{ACTIVITY_ICONS[item.type] ?? "•"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/70 truncate">{item.description}</p>
                    </div>
                    <span className="text-xs text-white/25 shrink-0 tabular-nums">{timeAgo(item.createdAt.toString())}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-10">
            {/* Plan usage */}
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xs font-semibold text-white/30 uppercase tracking-widest">Usage</h2>
                <TrendingUp className="w-3.5 h-3.5 text-white/20" />
              </div>
              <div className="mb-3 flex justify-between text-sm">
                <span className="text-white/40 capitalize">{user?.plan}</span>
                <span className="text-white/60 font-medium tabular-nums">{summary?.planUsed ?? 0} / {summary?.planLimit ?? 10}</span>
              </div>
              <div className="w-full h-px bg-white/8 overflow-visible relative mb-1">
                <div
                  data-testid="stat-plan-usage"
                  className="h-px bg-white transition-all duration-700"
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <p className="text-xs text-white/25">{usagePercent}% used</p>
              {user?.plan === "free" && (
                <Link href="/pricing">
                  <div className="mt-5 flex items-center gap-2 cursor-pointer group">
                    <Crown className="w-3.5 h-3.5 text-white/30 group-hover:text-white/60 transition-colors" />
                    <p className="text-xs text-white/30 group-hover:text-white/60 transition-colors font-medium">Upgrade to Pro — 100 videos/month</p>
                  </div>
                </Link>
              )}
            </div>

            {/* Style breakdown */}
            <div>
              <h2 className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-5">Styles</h2>
              {!styleBreakdown || styleBreakdown.length === 0 ? (
                <p className="text-xs text-white/20 py-2">Generate videos to see style stats</p>
              ) : (
                <div className="space-y-3">
                  {styleBreakdown.map((s) => {
                    const total = styleBreakdown.reduce((sum, d) => sum + d.count, 0);
                    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                    return (
                      <div key={s.style}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-white/40 capitalize">{s.style}</span>
                          <span className="text-white/25 tabular-nums">{s.count}</span>
                        </div>
                        <div className="w-full h-px bg-white/6">
                          <div className="h-px bg-white/40 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
