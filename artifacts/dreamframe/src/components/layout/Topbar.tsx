import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Sparkles, LogOut, Crown, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Create", href: "/create" },
  { label: "BG Replace", href: "/bg-replace" },
  { label: "Projects", href: "/projects" },
  { label: "Characters", href: "/characters" },
];

export function Topbar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
          <span className="text-sm font-semibold text-white tracking-tight">DreamFrame</span>
        </div>
      </Link>

      {/* Nav links */}
      <nav className="hidden md:flex items-center gap-1">
        {navItems.map(({ label, href }) => {
          const active = href === "/dashboard"
            ? location === "/dashboard"
            : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <div
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer",
                  active
                    ? "text-white bg-white/10"
                    : "text-white/50 hover:text-white hover:bg-white/6"
                )}
              >
                {label}
                {href === "/bg-replace" && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-widest bg-white/10 text-white/70 px-1.5 py-0.5 rounded font-semibold">New</span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-sm text-white/70 hover:text-white"
        >
          <div className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold text-white uppercase">
            {user?.name?.[0] ?? "U"}
          </div>
          <span className="hidden sm:block text-xs font-medium truncate max-w-[100px]">{user?.name}</span>
          {user?.plan !== "free" && (
            <Crown className="w-3 h-3 text-amber-400 shrink-0" />
          )}
          <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform", menuOpen && "rotate-180")} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-white/10 bg-[#0a0a0a] shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/6">
              <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
              <p className="text-[11px] text-white/40 truncate mt-0.5">{user?.email}</p>
              <Link href="/pricing">
                <span className="mt-2 inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/15 text-white/60 font-semibold cursor-pointer hover:text-white transition-colors">
                  {user?.plan} plan
                </span>
              </Link>
            </div>
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
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-white/50 hover:text-white hover:bg-white/5 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
