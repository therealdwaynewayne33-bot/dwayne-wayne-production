import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

setAuthTokenGetter(() => localStorage.getItem("dreamframe_token"));

// Prevent media element errors (video/audio can't load) from triggering
// Vite's development error overlay — they are handled in-component.
window.addEventListener("error", (e) => {
  if (e.target instanceof HTMLMediaElement) {
    e.stopImmediatePropagation();
  }
}, true);

createRoot(document.getElementById("root")!).render(<App />);
