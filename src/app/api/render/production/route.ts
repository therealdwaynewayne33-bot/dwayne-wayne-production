/**
 * Compatibility shim for deployments that expose Next-style `POST /api/render/production`.
 *
 * The canonical handler lives in:
 *   artifacts/api-server/src/routes/production.ts
 * mounted at `/api/render/production` on the Express api-server.
 *
 * Set `API_SERVER_URL` (e.g. `http://127.0.0.1:3001`) when this route runs in a different
 * process than the API server. Defaults to `http://127.0.0.1:3001`.
 */
export async function POST(req: Request): Promise<Response> {
  const base =
    (typeof process !== "undefined" && process.env.API_SERVER_URL?.replace(/\/$/, "")) ||
    "http://127.0.0.1:3001";

  const buf = await req.arrayBuffer();
  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);

  const upstream = await fetch(`${base}/api/render/production`, {
    method: "POST",
    headers,
    body: buf,
  });

  const out = new Headers(upstream.headers);
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}
