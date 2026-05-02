import { Router } from "express";
import { db, usersTable, videosTable } from "@workspace/db";
import { eq, gte, and, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();


const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    priceYearly: 0,
    videoLimit: 10,
    features: [
      "10 videos / month",
      "Text-to-video generation",
      "4 visual styles",
      "720p output",
      "Community support",
    ],
    notIncluded: [
      "Image-to-video",
      "Character face-lock",
      "Background replacement",
      "Priority processing",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 2900,
    priceYearly: 29000,
    videoLimit: 100,
    popular: true,
    features: [
      "100 videos / month",
      "Text-to-video + Image-to-video",
      "4 visual styles",
      "1080p output",
      "Character face-lock",
      "Background replacement",
      "Priority processing",
      "Email support",
    ],
    notIncluded: [],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 9900,
    priceYearly: 99000,
    videoLimit: null,
    features: [
      "Unlimited videos",
      "All Pro features",
      "4K output",
      "Custom style training",
      "API access",
      "Dedicated account manager",
      "SLA guarantee",
      "Custom integrations",
    ],
    notIncluded: [],
  },
];

router.get("/billing/plans", async (_req, res) => {
  return res.json(PLANS);
});

router.get("/billing/subscription", requireAuth, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ value: monthlyCount }] = await db
    .select({ value: count() })
    .from(videosTable)
    .where(and(eq(videosTable.userId, user.id), gte(videosTable.createdAt, monthStart)));

  const plan = PLANS.find((p) => p.id === user.plan) ?? PLANS[0];

  return res.json({
    plan: user.plan,
    planLimit: plan.videoLimit,
    planUsed: Number(monthlyCount),
    renewsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
  });
});

router.post("/billing/upgrade", requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!["free", "pro", "enterprise"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }
  const [user] = await db
    .update(usersTable)
    .set({ plan })
    .where(eq(usersTable.id, req.session.userId!))
    .returning();
  return res.json({
    plan: user.plan,
    message: `Successfully upgraded to ${plan} plan`,
  });
});

export default router;
