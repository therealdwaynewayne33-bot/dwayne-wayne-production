import { createContext, useContext, type ReactNode } from "react";
import { useGetMe, useLogoutUser, getGetMeQueryKey } from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, isLoading: true, logout: () => {} });

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useGetMe({ query: { retry: false, refetchOnWindowFocus: false, queryKey: getGetMeQueryKey() } });
  const logoutMutation = useLogoutUser();
  const [, setLocation] = useLocation();

  const logout = () => {
    localStorage.removeItem("dreamframe_token");
    logoutMutation.mutate(undefined, {
      onSuccess: () => setLocation("/"),
    });
  };

  // Local dev: auto-login as a demo user if auth isn't configured.
  const local = isLocalhost();
  const demoUser: User = {
    id: 1,
    email: "demo@localhost",
    name: "Demo User",
    plan: "free",
    credits: 1000,
    createdAt: new Date().toISOString() as any,
  } as any;

  const effectiveUser = local ? (user ?? demoUser) : (user ?? null);
  const effectiveLoading = local ? false : isLoading;

  return (
    <AuthContext.Provider value={{ user: effectiveUser, isLoading: effectiveLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
