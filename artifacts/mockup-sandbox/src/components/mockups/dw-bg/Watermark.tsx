export function Watermark() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#050505] text-white font-['Inter']">
      {/* Subtle, large, centered watermark */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <img
          src="/__mockup/images/dw-logo-bg.jpg"
          alt=""
          className="h-[140%] w-[140%] max-w-none object-contain opacity-[0.12] [filter:grayscale(100%)_contrast(1.1)]"
        />
      </div>
      <div className="absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_0%,#050505_75%)]" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-8 py-5 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-white" />
          <span className="text-[11px] uppercase tracking-[0.35em] text-white/60">DwayneWayne</span>
        </div>
        <span className="text-[11px] uppercase tracking-widest text-white/30">Production AI System</span>
      </div>

      {/* Compact centered card */}
      <div className="relative z-10 flex min-h-[calc(100vh-65px)] items-center justify-center px-6">
        <div className="w-full max-w-[360px] rounded-xl border border-white/10 bg-black/60 p-7 backdrop-blur-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
          <h1 className="text-lg font-light tracking-tight text-white">Sign in</h1>
          <p className="mt-1 text-xs text-white/45">Welcome back to your studio.</p>

          <div className="mt-6 space-y-2.5">
            <input
              placeholder="Email"
              className="w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
            />
            <input
              placeholder="Password"
              type="password"
              className="w-full rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
            />
            <button className="mt-1 w-full rounded-md bg-white py-2.5 text-sm font-medium text-black transition hover:bg-white/90">
              Sign In
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3 text-[10px] uppercase tracking-widest text-white/25">
            <div className="h-px flex-1 bg-white/10" /> or <div className="h-px flex-1 bg-white/10" />
          </div>

          <button className="mt-3 w-full rounded-md border border-white/10 py-2.5 text-xs text-white/75 transition hover:bg-white/5">
            Continue with Google
          </button>

          <p className="mt-5 text-center text-[11px] text-white/40">
            New here? <span className="text-white">Create an account</span>
          </p>
        </div>
      </div>
    </div>
  );
}
