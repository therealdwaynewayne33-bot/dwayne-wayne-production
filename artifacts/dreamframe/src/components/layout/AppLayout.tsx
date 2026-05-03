import { type ReactNode } from "react";
import { Topbar } from "./Topbar";
import dwLogoBg from "@assets/IMG_4084_(1)_1777826749985.jpg";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Global DW logo backdrop — bold logo, but darkened heavily over the
          content zone so text and UI are highly legible. Logo reads strongest
          along the edges; the center is near-black for readability. */}
      <div aria-hidden className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <img
          src={dwLogoBg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Heavy dark wash so words pop everywhere */}
        <div className="absolute inset-0 bg-black/75" />
        {/* Inverted vignette: even darker in the middle (where content sits),
            slightly lighter at the edges so the logo still shows through */}
        <div className="absolute inset-0 [background:radial-gradient(ellipse_at_center,rgba(0,0,0,0.65)_0%,rgba(0,0,0,0.2)_70%,transparent_100%)]" />
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
