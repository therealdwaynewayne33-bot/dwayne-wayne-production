import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useRegisterUser, useLoginUser } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sparkles, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginData = z.infer<typeof loginSchema>;
type RegisterData = z.infer<typeof registerSchema>;

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const loginMutation = useLoginUser();
  const registerMutation = useRegisterUser();

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const onLogin = (data: LoginData) => {
    setError("");
    loginMutation.mutate({ data }, {
      onSuccess: (response) => {
        queryClient.setQueryData(getGetMeQueryKey(), response.user);
        setLocation("/dashboard");
      },
      onError: () => setError("Invalid email or password. Please try again."),
    });
  };

  const onRegister = (data: RegisterData) => {
    setError("");
    registerMutation.mutate({ data }, {
      onSuccess: (response) => {
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
  };

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
              onClick={() => { setMode("login"); setError(""); loginForm.clearErrors(); }}
              className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${mode === "login" ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(""); registerForm.clearErrors(); }}
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
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
              <div>
                <Label htmlFor="login-email" className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 block">Email</Label>
                <Input
                  id="login-email"
                  data-testid="input-email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="bg-input/50"
                  {...loginForm.register("email")}
                />
                {loginForm.formState.errors.email && (
                  <p className="text-destructive text-xs mt-1">{loginForm.formState.errors.email.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="login-password" className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 block">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    data-testid="input-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="bg-input/50 pr-10"
                    {...loginForm.register("password")}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {loginForm.formState.errors.password && (
                  <p className="text-destructive text-xs mt-1">{loginForm.formState.errors.password.message}</p>
                )}
              </div>
              <Button data-testid="button-submit" type="submit" className="w-full bg-primary hover:bg-primary/90 mt-2" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
              <div>
                <Label htmlFor="reg-name" className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 block">Full name</Label>
                <Input
                  id="reg-name"
                  data-testid="input-name"
                  type="text"
                  placeholder="Alex Chen"
                  autoComplete="name"
                  className="bg-input/50"
                  {...registerForm.register("name")}
                />
                {registerForm.formState.errors.name && (
                  <p className="text-destructive text-xs mt-1">{registerForm.formState.errors.name.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="reg-email" className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 block">Email</Label>
                <Input
                  id="reg-email"
                  data-testid="input-email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="bg-input/50"
                  {...registerForm.register("email")}
                />
                {registerForm.formState.errors.email && (
                  <p className="text-destructive text-xs mt-1">{registerForm.formState.errors.email.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="reg-password" className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5 block">Password</Label>
                <div className="relative">
                  <Input
                    id="reg-password"
                    data-testid="input-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min 8 characters"
                    autoComplete="new-password"
                    className="bg-input/50 pr-10"
                    {...registerForm.register("password")}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {registerForm.formState.errors.password && (
                  <p className="text-destructive text-xs mt-1">{registerForm.formState.errors.password.message}</p>
                )}
              </div>
              <Button data-testid="button-submit" type="submit" className="w-full bg-primary hover:bg-primary/90 mt-2" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? "Creating account..." : "Create account"}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>Don&apos;t have an account?{" "}
                <button data-testid="button-switch-mode" type="button" onClick={() => { setMode("register"); setError(""); }} className="text-primary hover:underline font-medium">Sign up</button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button data-testid="button-switch-mode" type="button" onClick={() => { setMode("login"); setError(""); }} className="text-primary hover:underline font-medium">Sign in</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
