import { Router } from "express";
import { db, projectsTable, videosTable, charactersTable, activityTable, usersTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

const PLAN_LIMITS: Record<string, number> = { free: 10, pro: 100, enterprise: 1000 };


router.get("/dashboard/summary", requireAuth, async (req, res) => {
  const uid = req.session.userId!;
  const [[{ count: projects }], [{ count: videos }], [{ count: chars }], [{ count: processing }], [{ count: completed }], [user]] = await Promise.all([
    db.select({ count: count() }).from(projectsTable).where(eq(projectsTable.userId, uid)),
    db.select({ count: count() }).from(videosTable).where(eq(videosTable.userId, uid)),
    db.select({ count: count() }).from(charactersTable).where(eq(charactersTable.userId, uid)),
    db.select({ count: count() }).from(videosTable).where(and(eq(videosTable.userId, uid), eq(videosTable.status, "processing"))),
    db.select({ count: count() }).from(videosTable).where(and(eq(videosTable.userId, uid), eq(videosTable.status, "completed"))),
    db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1),
  ]);
  const plan = (user as any)?.plan ?? "free";
  const planLimit = PLAN_LIMITS[plan] ?? 10;
  return res.json({
    totalProjects: Number(projects),
    totalVideos: Number(videos),
    totalCharacters: Number(chars),
    processingCount: Number(processing),
    completedCount: Number(completed),
    planLimit,
    planUsed: Number(videos),
  });
});

router.get("/dashboard/recent-activity", requireAuth, async (req, res) => {
  const activities = await db.select().from(activityTable).where(eq(activityTable.userId, req.session.userId!)).orderBy(activityTable.createdAt).limit(20);
  return res.json(activities.reverse());
});

router.get("/dashboard/style-breakdown", requireAuth, async (req, res) => {
  const videos = await db.select().from(videosTable).where(eq(videosTable.userId, req.session.userId!));
  const breakdown: Record<string, number> = {};
  for (const v of videos) {
    breakdown[v.style] = (breakdown[v.style] ?? 0) + 1;
  }
  return res.json(Object.entries(breakdown).map(([style, count]) => ({ style, count })));
});

export default router;
