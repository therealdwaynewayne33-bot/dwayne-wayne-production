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
      onError: () => setError("Invalid email or password. Please try again."),
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
          setError("That email is already registered. Try signing in instead.");
        } else {
          setError("Registration failed. Please try again.");
        }
      },
    });
  }

  const isPending = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/30">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">DreamFrame AI Studio</h1>
          <p className="text-muted-foreground text-sm mt-1">Professional AI video generation</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
          <div className="flex rounded-lg border border-border bg-secondary/40 p-1 mb-6">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${mode === "login" ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("register")}
              className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${mode === "register" ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              Create account
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
              {error}
            </div>
          )}

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="l-email" className="block text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Email</label>
                <input
                  id="l-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-input bg-input/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
              <div>
                <label htmlFor="l-password" className="block text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Password</label>
                <div className="relative">
                  <input
                    id="l-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 rounded-md border border-input bg-input/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="w-full py-2.5 rounded-md bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 mt-2"
              >
                {isPending ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label htmlFor="r-name" className="block text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Full name</label>
                <input
                  id="r-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Alex Chen"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-input bg-input/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
              <div>
                <label htmlFor="r-email" className="block text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Email</label>
                <input
                  id="r-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-input bg-input/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
              <div>
                <label htmlFor="r-password" className="block text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Password</label>
                <div className="relative">
                  <input
                    id="r-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Min 8 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 rounded-md border border-input bg-input/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="w-full py-2.5 rounded-md bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 mt-2"
              >
                {isPending ? "Creating account..." : "Create account"}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>Don&apos;t have an account?{" "}
                <button type="button" onClick={() => switchMode("register")} className="text-primary hover:underline font-medium">Sign up</button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button type="button" onClick={() => switchMode("login")} className="text-primary hover:underline font-medium">Sign in</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
