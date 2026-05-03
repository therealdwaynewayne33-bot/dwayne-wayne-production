import { type ReactNode } from "react";
import { Topbar } from "./Topbar";
import dwLogoBg from "@assets/IMG_4084_(1)_1777826749985.jpg";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Global DW logo backdrop — fixed so it stays put as the page scrolls */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <img
          src={dwLogoBg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-25 [filter:grayscale(100%)_contrast(1.05)]"
        />
        {/* Dark gradient + vignette to keep content readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/85" />
        <div className="absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.55)_80%)]" />
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
