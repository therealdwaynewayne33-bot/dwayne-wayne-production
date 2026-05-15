import { useState } from "react";
import { useLocation } from "wouter";
import { useRegisterUser, useLoginUser } from "@workspace/api-client-react";
import { Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import dwLogoBg from "@assets/IMG_4084_(1)_1777826749985.jpg";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useLoginUser();
  const registerMutation = useRegisterUser();

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError("");
    setName("");
    setEmail("");
    setPassword("");
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setError("");
    loginMutation.mutate({ data: { email, password } }, {
      onSuccess: (response) => {
        localStorage.setItem("dreamframe_token", response.token);
        queryClient.setQueryData(getGetMeQueryKey(), response.user);
        setLocation("/dashboard");
      },
      onError: () => setError("Invalid email or password."),
    });
  }

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email || !password) { setError("Please fill in all fields."); return; }
    if (name.length < 2) { setError("Name must be at least 2 characters."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!email.includes("@")) { setError("Please enter a valid email."); return; }
    setError("");
    registerMutation.mutate({ data: { name, email, password } }, {
      onSuccess: (response) => {
        localStorage.setItem("dreamframe_token", response.token);
        queryClient.setQueryData(getGetMeQueryKey(), response.user);
        setLocation("/dashboard");
      },
      onError: (err: any) => {
        if (err?.data?.error?.includes("already")) {
          setError("That email is already registered. Try signing in.");
        } else {
          setError("Registration failed. Please try again.");
        }
      },
    });
  }

  const isPending = loginMutation.isPending || registerMutation.isPending;

  const inputCls = "w-full px-4 py-3 rounded-md border border-white/10 bg-white/[0.03] text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 text-sm transition-all";

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] bg-black text-white">
      {/* Left: logo hero */}
      <div className="relative overflow-hidden border-r border-white/10 hidden lg:block">
        <img
          src={dwLogoBg}
          alt="Dwayne Wayne Production"
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
      <div className="relative flex items-center justify-center bg-[#0a0a0a] px-6 sm:px-8 py-12 lg:py-16">
        {/* Mobile logo background (only visible when left panel is hidden) */}
        <div className="absolute inset-0 lg:hidden">
          <img src={dwLogoBg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80" />
        </div>

        <div className="relative w-full max-w-sm">
          <p className="text-[11px] uppercase tracking-[0.4em] text-white/40">
            {mode === "login" ? "Welcome back" : "Get started"}
          </p>
          <h1 className="mt-3 text-2xl font-light tracking-tight text-white">
            {mode === "login" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-white/50">
            {mode === "login"
              ? "to your Dwayne Wayne Production workspace"
              : "Join the Dwayne Wayne Production AI System"}
          </p>

          {/* Tab switcher */}
          <div className="mt-7 flex border border-white/10 rounded-md p-1 bg-white/[0.03]">
            <button type="button" onClick={() => switchMode("login")}
              className={`flex-1 py-2 rounded text-xs uppercase tracking-wider font-medium transition-all ${mode === "login" ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}>
              Sign in
            </button>
            <button type="button" onClick={() => switchMode("register")}
              className={`flex-1 py-2 rounded text-xs uppercase tracking-wider font-medium transition-all ${mode === "register" ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}>
              Create
            </button>
          </div>

          {error && (
            <div className="mt-5 px-4 py-3 rounded-md bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="mt-5 space-y-3">
              <div>
                <label htmlFor="l-email" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Email</label>
                <input id="l-email" type="email" autoComplete="email" placeholder="you@studio.com"
                  value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="l-password" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Password</label>
                <div className="relative">
                  <input id="l-password" type={showPassword ? "text" : "password"} autoComplete="current-password"
                    placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)}
                    className={`${inputCls} pr-11`} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isPending}
                className="w-full py-3 mt-2 rounded-md bg-white text-black font-medium text-sm hover:bg-white/90 transition-all disabled:opacity-50">
                {isPending ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="mt-5 space-y-3">
              <div>
                <label htmlFor="r-name" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Full name</label>
                <input id="r-name" type="text" autoComplete="name" placeholder="Alex Chen"
                  value={name} onChange={e => setName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="r-email" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Email</label>
                <input id="r-email" type="email" autoComplete="email" placeholder="you@studio.com"
                  value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="r-password" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Password</label>
                <div className="relative">
                  <input id="r-password" type={showPassword ? "text" : "password"} autoComplete="new-password"
                    placeholder="Min 8 characters" value={password} onChange={e => setPassword(e.target.value)}
                    className={`${inputCls} pr-11`} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isPending}
                className="w-full py-3 mt-2 rounded-md bg-white text-black font-medium text-sm hover:bg-white/90 transition-all disabled:opacity-50">
                {isPending ? "Creating account..." : "Create account"}
              </button>
            </form>
          )}

          <p className="mt-7 text-xs text-white/40">
            {mode === "login" ? (
              <>New here?{" "}
                <button type="button" onClick={() => switchMode("register")} className="text-white underline-offset-4 hover:underline transition-colors font-medium">Create an account</button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button type="button" onClick={() => switchMode("login")} className="text-white underline-offset-4 hover:underline transition-colors font-medium">Sign in</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
