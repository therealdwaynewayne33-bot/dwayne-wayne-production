import { db, usersTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Per-feature credit prices. 1 credit ≈ $0.01 of underlying Replicate spend.
// These are deliberately a little higher than raw cost so that a small markup
// covers ffmpeg time, bandwidth, and the occasional retry.
//
// If you change a price, update the hints in `artifacts/dreamframe/src/lib/credits.tsx`.
// ---------------------------------------------------------------------------

export const COST_BG_REPLACE          = 50; // Luma modify-video (+ optional Roop)
export const COST_BG_REPLACE_FIX_FACE = 15; // Roop only, against existing render

export type SceneEngineId = "runway-gen-4.5" | "kling-2.1" | "hailuo-02" | "pixverse-4.5" | "wan-2.2-i2v";

export function costForSceneEngine(engine: SceneEngineId, durationSec?: number): number {
  switch (engine) {
    case "runway-gen-4.5": return (durationSec ?? 5) >= 10 ? 95 : (durationSec ?? 5) >= 8 ? 72 : 55;
    case "kling-2.1":    return (durationSec ?? 5) >= 10 ? 120 : 60;
    case "hailuo-02":    return (durationSec ?? 6) >= 10 ? 55  : 35;
    case "pixverse-4.5": return 40;
    case "wan-2.2-i2v":  return 25;
  }
}

// ---------------------------------------------------------------------------
// Atomic charge: subtract `amount` from the user's balance ONLY if they have
// at least that many credits. Single SQL statement so two concurrent requests
// can't both pass the check and double-spend.
// ---------------------------------------------------------------------------
export type ChargeResult =
  | { ok: true;  newBalance: number }
  | { ok: false; have: number; needed: number };

export async function chargeCredits(
  userId: number,
  amount: number,
  reason: string,
  log?: Logger,
): Promise<ChargeResult> {
  if (amount <= 0) {
    const [u] = await db.select({ credits: usersTable.credits }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return { ok: true, newBalance: u?.credits ?? 0 };
  }

  const [updated] = await db
    .update(usersTable)
    .set({ credits: sql`${usersTable.credits} - ${amount}` })
    .where(and(eq(usersTable.id, userId), gte(usersTable.credits, amount)))
    .returning({ credits: usersTable.credits });

  if (updated) {
    log?.info({ userId, amount, reason, newBalance: updated.credits }, "credits: charged");
    return { ok: true, newBalance: updated.credits };
  }

  const [u] = await db.select({ credits: usersTable.credits }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const have = u?.credits ?? 0;
  log?.warn({ userId, amount, reason, have }, "credits: insufficient");
  return { ok: false, have, needed: amount };
}

// Refund credits — used when Replicate fails after we already charged so the
// user isn't billed for a render they didn't get.
export async function refundCredits(
  userId: number,
  amount: number,
  reason: string,
  log?: Logger,
): Promise<number> {
  if (amount <= 0) return 0;
  const [updated] = await db
    .update(usersTable)
    .set({ credits: sql`${usersTable.credits} + ${amount}` })
    .where(eq(usersTable.id, userId))
    .returning({ credits: usersTable.credits });
  log?.info({ userId, amount, reason, newBalance: updated?.credits }, "credits: refunded");
  return updated?.credits ?? 0;
}

export async function getCredits(userId: number): Promise<number> {
  const [u] = await db.select({ credits: usersTable.credits }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.credits ?? 0;
}

// JSON shape returned to the client when a charge fails. Reused by every
// route that gates a Replicate call so the frontend can always render the
// same "out of credits" toast.
export function insufficientCreditsResponse(have: number, needed: number) {
  return {
    error: `Not enough credits. You need ${needed} but only have ${have}. Click "Get test credits" in the sidebar to top up.`,
    code: "INSUFFICIENT_CREDITS",
    have,
    needed,
  };
}
