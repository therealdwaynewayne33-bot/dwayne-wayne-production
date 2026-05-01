import { Link, useLocation } from "wouter";
import { LayoutDashboard, FolderOpen, Video, Users, Plus, LogOut, Sparkles, Crown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Create Video", href: "/create", icon: Plus },
  { label: "Projects", href: "/projects", icon: FolderOpen },
  { label: "Characters", href: "/characters", icon: Users },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 shrink-0 flex flex-col h-screen bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="text-sm font-bold text-foreground tracking-wide">DreamFrame</span>
          <span className="block text-[10px] text-muted-foreground uppercase tracking-widest">AI Studio</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = href === "/dashboard" ? location === "/dashboard" : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <div
                data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium cursor-pointer transition-all duration-150",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "")} />
                {label}
                {href === "/create" && (
                  <span className="ml-auto text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-semibold">NEW</span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border space-y-1">
        {user?.plan === "free" && (
          <Link href="/pricing">
            <div className="mx-1 mb-3 rounded-lg bg-primary/10 border border-primary/20 p-3 cursor-pointer hover:bg-primary/15 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <Crown className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-primary">Upgrade to Pro</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                100 videos/mo, face-lock, 1080p output
              </p>
            </div>
          </Link>
        )}
        {user && (
          <div className="px-3 py-2 mb-1">
            <p className="text-xs font-semibold text-foreground truncate">{user.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
            <Link href="/pricing">
              <span className="mt-1 inline-block text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold hover:bg-primary/30 transition-colors cursor-pointer">
                {user.plan}
              </span>
            </Link>
          </div>
        )}
        <button
          data-testid="button-logout"
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-destructive transition-all duration-150"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
