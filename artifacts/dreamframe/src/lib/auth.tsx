import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useGetMe, useLogoutUser } from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ user: null, isLoading: true, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useGetMe({ query: { retry: false } });
  const logoutMutation = useLogoutUser();
  const [, setLocation] = useLocation();

  const logout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => setLocation("/"),
    });
  };

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
