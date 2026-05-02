import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

setAuthTokenGetter(() => localStorage.getItem("dreamframe_token"));

// Stop media element errors from reaching Vite's dev error overlay.
// HTMLMediaElement fires "error" events that bubble to window,
// and failed .play() calls produce unhandledrejection — both are harmless
// in-app states, not real runtime errors.
window.addEventListener(
  "error",
  (e) => { if (e.target instanceof HTMLMediaElement) e.stopImmediatePropagation(); },
  true,
);
window.addEventListener("unhandledrejection", (e) => {
  if (
    typeof e.reason?.message === "string" &&
    (e.reason.message.includes("no supported sources") ||
      e.reason.message.includes("play() request was interrupted") ||
      e.reason.message.includes("The media"))
  ) {
    e.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
