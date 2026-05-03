import { type ReactNode } from "react";
import { Topbar } from "./Topbar";
import dwLogoBg from "@assets/IMG_4084_(1)_1777826749985.jpg";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Global DW logo backdrop — bold, full-color, like the Split Hero panel */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <img
          src={dwLogoBg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Cinematic gradients — same recipe as the SplitHero left panel,
            scaled to read across a full-width app while keeping content legible */}
        <div className="absolute inset-0 bg-gradient-to-tr from-black/75 via-black/40 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />
      </div>

      {/* Foreground app */}
      <div className="relative z-10">
        <Topbar />
        <main className="pt-14 min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}
