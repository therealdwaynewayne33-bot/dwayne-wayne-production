import { Router } from "express";
import { db, projectsTable, videosTable, activityTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { CreateProjectBody, GetProjectParams, UpdateProjectBody, UpdateProjectParams, DeleteProjectParams } from "@workspace/api-zod";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

async function projectWithCount(p: any, userId: number) {
  const [{ count: vc }] = await db.select({ count: count() }).from(videosTable).where(and(eq(videosTable.projectId, p.id), eq(videosTable.userId, userId)));
  return { ...p, videoCount: Number(vc) };
}

router.get("/projects", requireAuth, async (req, res) => {
  const projects = await db.select().from(projectsTable).where(eq(projectsTable.userId, req.session.userId!)).orderBy(projectsTable.updatedAt);
  const result = await Promise.all(projects.map((p) => projectWithCount(p, req.session.userId!)));
  return res.json(result.reverse());
});

router.post("/projects", requireAuth, async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
  const [project] = await db.insert(projectsTable).values({ ...parsed.data, userId: req.session.userId!, status: "draft" }).returning();
  await db.insert(activityTable).values({ userId: req.session.userId!, type: "project_created", description: `Created project "${project.title}"`, resourceId: project.id, resourceType: "project" });
  return res.status(201).json({ ...project, videoCount: 0 });
});

router.get("/projects/:id", requireAuth, async (req, res) => {
  const params = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.session.userId!))).limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(await projectWithCount(project, req.session.userId!));
});

router.patch("/projects/:id", requireAuth, async (req, res) => {
  const params = UpdateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const body = UpdateProjectBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid request body" });
  const [project] = await db.update(projectsTable).set({ ...body.data, updatedAt: new Date() }).where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.session.userId!))).returning();
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(await projectWithCount(project, req.session.userId!));
});

router.delete("/projects/:id", requireAuth, async (req, res) => {
  const params = DeleteProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [project] = await db.delete(projectsTable).where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.session.userId!))).returning();
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json({ message: "Project deleted" });
});

export default router;
