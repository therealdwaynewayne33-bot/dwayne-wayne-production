import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getCredits } from "../lib/credits";

const router = Router();

// Cap the test grant so a single user can't accidentally rack up infinite
// balance via repeated calls. Plenty for development; tighten later.
const TEST_GRANT_AMOUNT = 1000;
const TEST_GRANT_DAILY_CAP = 10_000;

const grantsToday = new Map<number, { date: string; granted: number }>();

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

router.get("/credits", requireAuth, async (req, res) => {
  const credits = await getCredits(req.session.userId!);
  return res.json({ credits });
});

// Self-service "give me test credits" endpoint — useful during development
// and for letting beta testers retry without you topping up Replicate.
// Hard-capped at TEST_GRANT_DAILY_CAP per user per day.
router.post("/credits/grant-test", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const today = todayKey();
  const entry = grantsToday.get(userId);
  const grantedToday = entry && entry.date === today ? entry.granted : 0;

  if (grantedToday >= TEST_GRANT_DAILY_CAP) {
    return res.status(429).json({
      error: `Daily test-credit cap reached (${TEST_GRANT_DAILY_CAP}). Try again tomorrow.`,
    });
  }

  const remaining = TEST_GRANT_DAILY_CAP - grantedToday;
  const amount = Math.min(TEST_GRANT_AMOUNT, remaining);

  const [updated] = await db
    .update(usersTable)
    .set({ credits: sql`${usersTable.credits} + ${amount}` })
    .where(eq(usersTable.id, userId))
    .returning({ credits: usersTable.credits });

  grantsToday.set(userId, { date: today, granted: grantedToday + amount });

  req.log.info({ userId, amount, newBalance: updated?.credits }, "credits: test grant");
  return res.json({ credits: updated?.credits ?? 0, granted: amount });
});

export default router;
