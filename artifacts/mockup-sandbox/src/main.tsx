import { createRoot } from "react-dom/client";
import { RootProviders } from "../../dreamframe/src/root-providers";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <RootProviders>
    <App />
  </RootProviders>,
);
