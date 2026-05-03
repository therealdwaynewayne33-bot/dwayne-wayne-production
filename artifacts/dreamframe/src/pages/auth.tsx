import { useState } from "react";
import { useLocation } from "wouter";
import { useRegisterUser, useLoginUser } from "@workspace/api-client-react";
import { Sparkles, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";

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

  const inputCls = "w-full px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/25 focus:outline-none focus:border-white/30 focus:bg-white/8 text-sm transition-all";

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center mx-auto mb-5">
          <Sparkles className="w-6 h-6 text-black" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight uppercase">DwayneWayne Production<span className="block text-base font-semibold text-white/60 tracking-[0.2em] mt-1">AI System</span></h1>
        <p className="text-white/30 text-sm mt-1.5">Professional AI video generation</p>
      </div>

      <div className="w-full max-w-sm">
        {/* Tab switcher */}
        <div className="flex border border-white/10 rounded-2xl p-1 mb-6 bg-white/[0.03]">
          <button type="button" onClick={() => switchMode("login")}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${mode === "login" ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}>
            Sign in
          </button>
          <button type="button" onClick={() => switchMode("register")}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${mode === "register" ? "bg-white text-black" : "text-white/40 hover:text-white/70"}`}>
            Create account
          </button>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label htmlFor="l-email" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Email</label>
              <input id="l-email" type="email" autoComplete="email" placeholder="you@example.com"
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
              className="w-full py-3 mt-2 rounded-xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all disabled:opacity-50">
              {isPending ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-3">
            <div>
              <label htmlFor="r-name" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Full name</label>
              <input id="r-name" type="text" autoComplete="name" placeholder="Alex Chen"
                value={name} onChange={e => setName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="r-email" className="block text-[11px] text-white/30 uppercase tracking-widest mb-2">Email</label>
              <input id="r-email" type="email" autoComplete="email" placeholder="you@example.com"
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
              className="w-full py-3 mt-2 rounded-xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all disabled:opacity-50">
              {isPending ? "Creating account..." : "Create account"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-white/25">
          {mode === "login" ? (
            <>No account?{" "}
              <button type="button" onClick={() => switchMode("register")} className="text-white/50 hover:text-white transition-colors font-medium">Sign up</button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")} className="text-white/50 hover:text-white transition-colors font-medium">Sign in</button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
