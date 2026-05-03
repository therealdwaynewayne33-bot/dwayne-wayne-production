import { useState } from "react";

export function FullBleed() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black text-white font-['Inter']">
      <img
        src="/__mockup/images/dw-logo-bg.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/80" />
      <div className="absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.7)_85%)]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <p className="text-[11px] uppercase tracking-[0.45em] text-white/50">DwayneWayne</p>
            <h1 className="mt-3 text-2xl font-light tracking-tight text-white">
              Production AI System
            </h1>
            <p className="mt-2 text-sm text-white/50">Sign in to continue your work</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 p-6 backdrop-blur-xl shadow-2xl">
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
              <button
                onClick={() => setMode("signin")}
                className={`rounded-md py-2 text-xs uppercase tracking-wider transition ${
                  mode === "signin" ? "bg-white text-black" : "text-white/60 hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => setMode("signup")}
                className={`rounded-md py-2 text-xs uppercase tracking-wider transition ${
                  mode === "signup" ? "bg-white text-black" : "text-white/60 hover:text-white"
                }`}
              >
                Create
              </button>
            </div>

            <div className="space-y-3">
              <input
                placeholder="Email"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
              />
              <input
                placeholder="Password"
                type="password"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
              />
              <button className="w-full rounded-lg bg-white py-3 text-sm font-medium text-black transition hover:bg-white/90">
                {mode === "signin" ? "Sign In" : "Create Account"}
              </button>
            </div>

            <div className="mt-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-white/30">
              <div className="h-px flex-1 bg-white/10" />
              or
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <button className="mt-4 w-full rounded-lg border border-white/15 bg-transparent py-3 text-sm text-white/80 transition hover:bg-white/5">
              Continue with Google
            </button>
          </div>

          <p className="mt-6 text-center text-[11px] text-white/30">
            By continuing you agree to the Terms & Privacy.
          </p>
        </div>
      </div>
    </div>
  );
}
