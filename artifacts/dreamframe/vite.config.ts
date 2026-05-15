import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const merged = { ...env, ...process.env };

  /** Dev UI port — keep separate from API (default 3001) so concurrent dev never stacks both on 3001. */
  const rawPort = merged.VITE_PORT ?? merged.FRONTEND_PORT ?? "5173";
  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid dev server port: "${rawPort}"`);

  const basePath = merged.BASE_PATH ?? "/";

  const rawPoll = Number(merged.RENDER_POLL_TIMEOUT_MS);
  const renderPollTimeoutMs =
    Number.isFinite(rawPoll) && rawPoll >= 10_000 ? Math.min(rawPoll, 3_600_000) : 3_600_000;

  return {
    envDir: workspaceRoot,
    define: {
      __RENDER_POLL_TIMEOUT_MS__: JSON.stringify(renderPollTimeoutMs),
    },
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(((merged.NODE_ENV ?? mode) !== "production" && merged.REPL_ID !== undefined)
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) => m.devBanner()),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      /** Prefer PORT but avoid failing workspace `pnpm dev` when something else holds 3000. */
      strictPort: false,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        // Local dev: Vite (5173 by default) → api-server (PORT / default 3001)
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      strictPort: false,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
  };
});
