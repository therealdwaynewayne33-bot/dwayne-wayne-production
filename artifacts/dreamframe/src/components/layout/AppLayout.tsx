import { type ReactNode } from "react";
import { Topbar } from "./Topbar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-black">
      <Topbar />
      <main className="pt-14 min-h-screen">
        {children}
      </main>
    </div>
  );
}
