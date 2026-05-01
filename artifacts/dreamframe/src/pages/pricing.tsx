import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Zap, Crown, Building2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    id: "free",
    name: "Free",
    icon: Sparkles,
    price: 0,
    priceYearly: 0,
    period: "forever",
    videoLimit: "10 videos / mo",
    color: "text-muted-foreground",
    borderColor: "border-card-border",
    badgeColor: "",
    features: [
      "10 videos per month",
      "Text-to-video generation",
      "4 visual styles",
      "720p output",
      "Community support",
    ],
    notIncluded: [
      "Image-to-video",
      "Character face-lock",
      "Background replacement",
      "Priority processing",
      "API access",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    icon: Zap,
    price: 29,
    priceYearly: 290,
    period: "per month",
    videoLimit: "100 videos / mo",
    popular: true,
    color: "text-primary",
    borderColor: "border-primary/50",
    badgeColor: "bg-primary text-white",
    features: [
      "100 videos per month",
      "Text-to-video + Image-to-video",
      "4 visual styles",
      "1080p output",
      "Character face-lock",
      "Background replacement",
      "Priority processing",
      "Email support",
    ],
    notIncluded: [
      "Custom style training",
      "API access",
      "Dedicated manager",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    icon: Crown,
    price: 99,
    priceYearly: 990,
    period: "per month",
    videoLimit: "Unlimited videos",
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    badgeColor: "bg-amber-500/20 text-amber-400",
    features: [
      "Unlimited videos",
      "All Pro features",
      "4K output",
      "Custom style training",
      "Full API access",
      "Dedicated account manager",
      "SLA guarantee",
      "Custom integrations",
    ],
    notIncluded: [],
  },
];

export default function PricingPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const { toast } = useToast();

  const handleUpgrade = async (planId: string) => {
    if (planId === user?.plan) return;
    setUpgrading(planId);
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: planId }),
      });
      if (!res.ok) throw new Error("Failed to upgrade");
      toast({ title: `Upgraded to ${planId} plan!`, description: "Your plan has been updated." });
      window.location.href = "/dashboard";
    } catch {
      toast({ title: "Upgrade failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setUpgrading(null);
    }
  };

  return (
    <AppLayout>
      <div className="p-8 max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold mb-4">
            <Crown className="w-3 h-3" />
            Plans & Pricing
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-3">
            Scale your creativity
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Generate stunning AI videos with character consistency and cinematic style control.
          </p>

          <div className="inline-flex items-center gap-1 mt-6 p-1 rounded-lg bg-card border border-card-border">
            <button
              onClick={() => setBilling("monthly")}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                billing === "monthly"
                  ? "bg-primary text-white shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling("yearly")}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5",
                billing === "yearly"
                  ? "bg-primary text-white shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                -17%
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            const isCurrentPlan = user?.plan === plan.id;
            const isPopular = plan.popular;
            const displayPrice = billing === "yearly" ? Math.round(plan.priceYearly / 12) : plan.price;

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-2xl border bg-card p-7 flex flex-col transition-all duration-200",
                  plan.borderColor,
                  isPopular && "ring-1 ring-primary/40 shadow-xl shadow-primary/10",
                  isCurrentPlan && "ring-1 ring-primary/60"
                )}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-primary text-white shadow-lg shadow-primary/30">
                      Most Popular
                    </span>
                  </div>
                )}

                {isCurrentPlan && (
                  <div className="absolute -top-3 right-4">
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Current Plan
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3", plan.id === "free" ? "bg-secondary" : plan.id === "pro" ? "bg-primary/15" : "bg-amber-500/15")}>
                    <Icon className={cn("w-5 h-5", plan.color)} />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                  <p className={cn("text-xs font-medium mt-0.5", plan.color)}>{plan.videoLimit}</p>
                </div>

                <div className="mb-6">
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-bold text-foreground">
                      {displayPrice === 0 ? "Free" : `$${displayPrice}`}
                    </span>
                    {displayPrice > 0 && (
                      <span className="text-muted-foreground text-sm mb-1.5">/month</span>
                    )}
                  </div>
                  {billing === "yearly" && plan.price > 0 && (
                    <p className="text-xs text-emerald-400 mt-1">
                      Billed ${plan.priceYearly}/year · Save ${(plan.price * 12 - plan.priceYearly)}
                    </p>
                  )}
                </div>

                <div className="space-y-2.5 flex-1 mb-8">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-center gap-2.5">
                      <div className={cn("w-4 h-4 rounded-full flex items-center justify-center shrink-0", plan.id === "free" ? "bg-secondary" : plan.id === "pro" ? "bg-primary/20" : "bg-amber-500/20")}>
                        <Check className={cn("w-2.5 h-2.5", plan.color)} />
                      </div>
                      <span className="text-sm text-foreground">{f}</span>
                    </div>
                  ))}
                  {plan.notIncluded.map((f) => (
                    <div key={f} className="flex items-center gap-2.5 opacity-40">
                      <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-secondary">
                        <X className="w-2.5 h-2.5 text-muted-foreground" />
                      </div>
                      <span className="text-sm text-muted-foreground">{f}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={isCurrentPlan || upgrading === plan.id}
                  className={cn(
                    "w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-150",
                    isCurrentPlan
                      ? "bg-secondary text-muted-foreground cursor-default"
                      : plan.id === "pro"
                      ? "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20"
                      : plan.id === "enterprise"
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
                      : "bg-secondary text-foreground hover:bg-secondary/80 border border-card-border"
                  )}
                >
                  {upgrading === plan.id
                    ? "Upgrading…"
                    : isCurrentPlan
                    ? "Current Plan"
                    : plan.id === "free"
                    ? "Downgrade to Free"
                    : `Upgrade to ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-12 rounded-2xl border border-card-border bg-card p-8 text-center">
          <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Need a custom solution?</h3>
          <p className="text-muted-foreground text-sm mb-4">
            White-label, on-premise, or volume pricing — let's talk.
          </p>
          <button className="px-5 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium border border-card-border hover:bg-secondary/80 transition-colors">
            Contact Sales
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          This is a demo — no real payments are processed. Stripe will be connected when you're ready to go live.
        </p>
      </div>
    </AppLayout>
  );
}
