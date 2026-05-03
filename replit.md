# DreamFrame AI Studio

## Overview

Full-stack AI video generation platform (SaaS MVP). Dark cinematic UI with character consistency, style selection, project management, and simulated video generation pipeline.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (with express-session for auth)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, Tailwind CSS, wouter, TanStack Query, recharts

## Architecture

- `artifacts/dreamframe` — React+Vite frontend (dark cinematic theme, violet-purple palette)
- `artifacts/api-server` — Express 5 REST API
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)
- `lib/api-client-react` — Generated React Query hooks
- `lib/api-zod` — Generated Zod validation schemas
- `lib/db` — Drizzle ORM + PostgreSQL schema

## Billing (Mock Mode)

- `/pricing` — Full pricing page: Free / Pro / Enterprise plan cards with monthly/yearly toggle
- Plan limits enforced server-side on `POST /api/videos` (Free=10/mo, Pro=100/mo, Enterprise=unlimited)
- Returns HTTP 402 with `{ plan, planUsed, planLimit }` when limit reached
- `PlanLimitModal` — paywall modal shown on 402 when generating a video
- `/api/billing/upgrade` — mock upgrade endpoint that writes `plan` to DB (no Stripe yet)
- Dashboard and sidebar both have upgrade CTAs linking to `/pricing`
- **Stripe integration is NOT yet connected.** When ready, connect Stripe via the Integrations tab (connector ID: `ccfg_stripe_01K611P4YQR0SZM11XFRQJC44Y`), then wire `stripeClient.ts`, webhook route, and checkout session into the billing route.

## Key Features

- **Auth**: Session-based login/register (bcryptjs password hashing)
- **Dashboard**: Stats, recent activity feed, style breakdown pie chart, plan usage meter
- **Create Video**: 4-step wizard — project selection, prompt composition, style/character/background options, generation
- **Video Generation Types**: text-to-video, image-to-video
- **Style Options**: realistic, cartoon, 3D-animated, cinematic
- **Face Lock**: Character consistency system — upload character images, lock to videos
- **Background Replace**: Luma Ray-2 video-to-video (`luma/modify-video`, mode `flex_1`) with optional `arabyai-replicate/roop_face_swap` for face-lock. Per-result "Fix face" button re-runs only the swap against the original Luma render.
- **Generate Scene** (`/generate-scene`, route `POST /api/scene/generate`): multi-engine image-to-video / text-to-video generator. Engine tab strip in the UI lets the user pick between four Replicate models, each registered in the `ENGINES` catalog at the top of `artifacts/api-server/src/routes/generate-scene.ts`:
  - `kwaivgi/kling-v2.1` — needs `start_image`, premium cinematic, 5s/10s
  - `minimax/hailuo-02` — `first_frame_image` optional (so this engine supports pure text-to-video), 6s/10s
  - `pixverse/pixverse-v4.5` — `image` optional, 5s/8s, supports special effects
  - `wan-video/wan-2.2-i2v-a14b` — `image` required, ~3s output
  Backend persists the upload to `/api/uploads/<jobId>-img.<ext>`, calls the chosen model, downloads the result to `/api/videos-files/<jobId>-out.mp4`, generates a thumbnail. Engine list is exposed at `GET /api/scene/engines`. **Important**: this is NOT video-to-video modify (Luma `modify-video` is the only model on Replicate that accepts a video input — see prior investigation). Generate Scene is for B-roll, establishing shots, and animating stills the user can't film.

### Background Replace — DEMO MODE

`BG_REPLACE_DEMO_MODE` is currently **off** (the user topped up Replicate credits). When `BG_REPLACE_DEMO_MODE=true`:

- `POST /api/videos/bg-replace` and `/fix-face` skip Luma + Roop entirely
- Instead, ffmpeg applies a prompt-aware color grade (warm beach, cool night, green forest, etc.) + vignette
- Response includes `demoMode: true` and the UI shows a yellow `DEMO` badge plus a hint about the env var
- "Fix face" still works — it re-runs a slightly different stylize on the existing render so the button visibly changes the output
- To turn the real Luma+Roop pipeline back on once credits exist, set `BG_REPLACE_DEMO_MODE=false` (or `0` / `off`) and restart the API Server. No code changes needed.
- Implementation: `isDemoMode()`, `demoFilterForPrompt()`, `applyDemoEffect()` helpers at the top of `artifacts/api-server/src/routes/bg-replace.ts`; demo branches before the Replicate calls in both routes.

### Luma `modify-video` constraints (learned the hard way)

The model rejects inputs with a silent `(E006)` "input was invalid" error if any of these aren't met. `normalizeForLuma()` in `bg-replace.ts` re-encodes every upload to match this profile:

- **Max ~9 second input duration** (longer is silently rejected even though docs claim 30s)
- 1280×720 @ 30fps, H.264 high profile, yuv420p
- AAC 48kHz stereo audio (44.1kHz also triggered E006 in testing)
- Public URL must be reachable from Replicate workers (our `$REPLIT_DEV_DOMAIN` works)
- **Video Editor**: Preview player, trim controls, apply-style panel, download
- **Character Library**: Upload/manage character images for face-lock
- **Projects**: Organize videos into projects with status tracking

## AI Integration Notes

- Video generation is simulated with setTimeout delays (queued → processing → completed)
- Architecture is ready for real API integration at `/api/videos` POST route
- `simulateProcessing()` in `artifacts/api-server/src/routes/videos.ts` is the placeholder
- Stripe-ready structure: `plan` field on users table (free/pro/enterprise), plan limits in dashboard

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Workflows

Both services are managed as **artifact workflows** (auto-started by the Run button):
- **artifacts/dreamframe: web** — frontend on port 5173 (PORT set via artifact.toml `[services.env]`)
- **artifacts/api-server: API Server** — API on port 8080 (PORT set via artifact.toml `[services.env]`)

## Important Notes

- After running `pnpm --filter @workspace/api-spec run codegen`, manually fix `lib/api-zod/src/index.ts` to only export from `./generated/api` (codegen regenerates it with duplicate exports)
- Sessions use cookie-based auth; frontend uses `credentials: "include"` in custom-fetch
