export function SplitHero() {
  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-black text-white font-['Inter'] lg:grid-cols-[1.2fr_1fr]">
      {/* Left: logo hero */}
      <div className="relative overflow-hidden border-r border-white/10">
        <img
          src="/__mockup/images/dw-logo-bg.jpg"
          alt="DwayneWayne"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-black/60" />

        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-white" />
            <span className="text-[11px] uppercase tracking-[0.4em] text-white/70">DW Studio</span>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.45em] text-white/50">A new kind of studio</p>
            <h2 className="mt-3 text-4xl font-light leading-tight tracking-tight text-white max-w-md">
              Direct cinema-grade AI video, scene by scene.
            </h2>
            <div className="mt-6 flex items-center gap-6 text-xs text-white/50">
              <div>
                <div className="text-white text-lg font-light">Ray3</div>
                <div>Hero engine</div>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <div className="text-white text-lg font-light">Luma</div>
                <div>Motion engine</div>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <div className="text-white text-lg font-light">FaceFix</div>
                <div>Identity engine</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center bg-[#0a0a0a] px-8 py-16">
        <div className="w-full max-w-sm">
          <p className="text-[11px] uppercase tracking-[0.4em] text-white/40">Welcome back</p>
          <h1 className="mt-3 text-2xl font-light tracking-tight text-white">Sign in</h1>
          <p className="mt-2 text-sm text-white/50">to your DwayneWayne workspace</p>

          <div className="mt-8 space-y-3">
            <input
              placeholder="you@studio.com"
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
            />
            <input
              placeholder="Password"
              type="password"
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
            />
            <button className="w-full rounded-md bg-white py-3 text-sm font-medium text-black transition hover:bg-white/90">
              Sign In
            </button>
            <button className="w-full rounded-md border border-white/15 py-3 text-sm text-white/80 transition hover:bg-white/5">
              Continue with Google
            </button>
          </div>

          <p className="mt-8 text-xs text-white/40">
            New here? <span className="text-white underline-offset-4 hover:underline cursor-pointer">Create an account</span>
          </p>
        </div>
      </div>
    </div>
  );
}
