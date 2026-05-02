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
- **Background Replace**: AI green-screen style background replacement
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
