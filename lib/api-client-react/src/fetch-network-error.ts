/**
 * Turns opaque browser network failures ("Failed to fetch") into actionable text.
 * Safe for browser and Node / SSR (guards on `window`).
 */
export function describeFetchFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const looksLikeNetwork =
    msg === "Failed to fetch" ||
    msg.includes("NetworkError when attempting to fetch resource") ||
    msg.includes("Load failed") ||
    (err instanceof TypeError && msg.toLowerCase().includes("fetch"));

  if (!looksLikeNetwork) return msg;

  const hint =
    typeof window !== "undefined"
      ? " Start the API on port 3001 together with the app: from your workspace root run `pnpm dev`, or in two terminals run `pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start` and `pnpm --filter @workspace/dreamframe dev`."
      : "";

  return `${msg}.${hint}`;
}
