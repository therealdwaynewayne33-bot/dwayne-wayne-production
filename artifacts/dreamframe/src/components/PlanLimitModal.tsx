import { useLocation } from "wouter";
import { Zap, X, Crown } from "lucide-react";

interface PlanLimitModalProps {
  plan: string;
  planUsed: number;
  planLimit: number;
  onClose: () => void;
}

export function PlanLimitModal({ plan, planUsed, planLimit, onClose }: PlanLimitModalProps) {
  const [, setLocation] = useLocation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-card-border bg-card shadow-2xl shadow-black/50 p-8 text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-5">
          <Zap className="w-8 h-8 text-primary" />
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-2">
          Monthly limit reached
        </h2>
        <p className="text-muted-foreground text-sm mb-6">
          You've used <span className="text-foreground font-semibold">{planUsed} of {planLimit}</span> videos
          on your <span className="capitalize text-foreground font-semibold">{plan}</span> plan this month.
          Upgrade to keep creating.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
            <div className="text-xs text-primary font-bold uppercase tracking-wide mb-1">Pro</div>
            <div className="text-2xl font-bold text-foreground">$29<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
            <div className="text-xs text-muted-foreground mt-1">100 videos / month</div>
            <ul className="mt-3 space-y-1">
              {["Face-lock", "Bg replace", "1080p", "Priority queue"].map((f) => (
                <li key={f} className="text-xs text-foreground flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-primary inline-block" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-left">
            <div className="text-xs text-amber-400 font-bold uppercase tracking-wide mb-1 flex items-center gap-1">
              <Crown className="w-3 h-3" /> Enterprise
            </div>
            <div className="text-2xl font-bold text-foreground">$99<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
            <div className="text-xs text-muted-foreground mt-1">Unlimited videos</div>
            <ul className="mt-3 space-y-1">
              {["4K output", "API access", "Custom styles", "Dedicated mgr"].map((f) => (
                <li key={f} className="text-xs text-foreground flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-amber-400 inline-block" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <button
          onClick={() => { onClose(); setLocation("/pricing"); }}
          className="w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
        >
          View all plans & upgrade
        </button>

        <button onClick={onClose} className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  );
}
