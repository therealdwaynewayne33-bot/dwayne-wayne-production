import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Sparkles, LogOut, Crown, ChevronDown, Coins, Plus } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useCredits, useGrantTestCredits } from "@/lib/credits";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { label: "Dashboard",   href: "/dashboard" },
  { label: "Create",      href: "/create" },
  { label: "Face Swap",   href: "/face-swap",      badge: "AI" },
  { label: "BG Replace",  href: "/bg-replace",     badge: "AI" },
  { label: "V2V",         href: "/video-to-video", badge: "AI" },
  { label: "Projects",    href: "/projects" },
  { label: "Characters",  href: "/characters" },
];

export function Topbar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: creditsData } = useCredits();
  const grant = useGrantTestCredits();
  const { toast } = useToast();
  const balance = creditsData?.credits ?? null;
  const lowCredits = balance !== null && balance < 100;

  const onGrant = () => {
    grant.mutate(undefined, {
      onSuccess: (d) =>
        toast({ title: `+${d.granted} test credits`, description: `New balance: ${d.credits.toLocaleString()}` }),
      onError: (e: any) =>
        toast({ title: "Couldn't grant credits", description: e.message }),
    });
  };

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-6 border-b border-white/[0.06] bg-black/80 backdrop-blur-xl">
      {/* Logo */}
      <Link href="/dashboard">
        <div className="flex items-center gap-2.5 cursor-pointer select-none">
          <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-black" />
          </div>
          <span className="text-[11px] font-bold text-white tracking-[0.14em] uppercase whitespace-nowrap">DwayneWayne Production<span className="text-white/40"> · AI System</span></span>
        </div>
      </Link>

      {/* Nav links */}
      <nav className="hidden md:flex items-center gap-0.5">
        {navItems.map(({ label, href, badge }) => {
          const active = href === "/dashboard"
            ? location === "/dashboard"
            : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <div
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                  active
                    ? "text-white bg-white/10"
                    : "text-white/45 hover:text-white hover:bg-white/5"
                )}
              >
                {label}
                {badge && (
                  <span className="text-[9px] uppercase tracking-widest bg-white/8 text-white/40 px-1.5 py-0.5 rounded font-semibold">
                    {badge}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Credits pill + user menu */}
      <div className="flex items-center gap-2">
        {user && balance !== null && (
          <Link href="/pricing">
            <div
              data-testid="credit-balance-pill"
              className={cn(
                "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors cursor-pointer",
                lowCredits
                  ? "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15"
                  : "border-white/10 bg-white/[0.03] text-white/80 hover:border-white/20",
              )}
              title="Click to view plans"
            >
              <Coins className={cn("w-3.5 h-3.5", lowCredits ? "text-amber-300" : "text-primary")} />
              <span data-testid="credit-balance" className="tabular-nums">
                {balance.toLocaleString()}
              </span>
              <span className="text-white/35 font-normal">credits</span>
            </div>
          </Link>
        )}

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-sm"
        >
          <div className="w-5 h-5 rounded-full bg-white/12 flex items-center justify-center text-[10px] font-bold text-white uppercase">
            {user?.name?.[0] ?? "U"}
          </div>
          <span className="hidden sm:block text-xs font-medium text-white/60 truncate max-w-[90px]">{user?.name}</span>
          {user?.plan !== "free" && <Crown className="w-3 h-3 text-amber-400 shrink-0" />}
          <ChevronDown className={cn("w-3 h-3 text-white/30 shrink-0 transition-transform", menuOpen && "rotate-180")} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-white/10 bg-[#0a0a0a] shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/6">
              <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
              <p className="text-[11px] text-white/35 truncate mt-0.5">{user?.email}</p>
              <Link href="/pricing">
                <span className="mt-2 inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/12 text-white/40 font-semibold cursor-pointer hover:text-white transition-colors">
                  {user?.plan} plan
                </span>
              </Link>
            </div>
            {balance !== null && (
              <div className="px-4 py-3 border-b border-white/6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-white/35 font-semibold">Credits</span>
                  <span className={cn("text-sm font-bold tabular-nums", lowCredits ? "text-amber-300" : "text-white")}>
                    {balance.toLocaleString()}
                  </span>
                </div>
                <button
                  data-testid="button-grant-credits"
                  onClick={(e) => { e.stopPropagation(); onGrant(); }}
                  disabled={grant.isPending}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-primary/15 hover:bg-primary/25 text-primary text-[11px] font-semibold py-1.5 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  {grant.isPending ? "…" : "+1,000 test credits"}
                </button>
              </div>
            )}
            {user?.plan === "free" && (
              <Link href="/pricing">
                <div className="px-4 py-3 border-b border-white/6 flex items-center gap-2 hover:bg-white/5 transition-colors cursor-pointer">
                  <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs text-amber-400 font-medium">Upgrade to Pro</span>
                </div>
              </Link>
            )}
            <button
              data-testid="button-logout"
              onClick={() => { setMenuOpen(false); logout(); }}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-white/40 hover:text-white hover:bg-white/5 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>
      </div>
    </header>
  );
}
