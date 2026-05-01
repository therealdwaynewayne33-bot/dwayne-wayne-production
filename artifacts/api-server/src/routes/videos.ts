import { Router } from "express";
import { db, videosTable, activityTable, projectsTable, charactersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  GenerateVideoBody,
  GetVideoParams,
  DeleteVideoParams,
  ApplyStyleParams,
  ApplyStyleBody,
  UploadCharacterImageBody,
  ListVideosQueryParams,
} from "@workspace/api-zod";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function simulateProcessing(videoId: number) {
  setTimeout(async () => {
    await db.update(videosTable).set({ status: "processing" }).where(eq(videosTable.id, videoId));
    setTimeout(async () => {
      await db.update(videosTable).set({
        status: "completed",
        videoUrl: `https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`,
        thumbnailUrl: `https://picsum.photos/seed/${videoId}/640/360`,
        duration: Math.round((15 + Math.random() * 45) * 10) / 10,
      }).where(eq(videosTable.id, videoId));
      await db.update(projectsTable).set({ status: "completed", updatedAt: new Date() }).where(
        eq(projectsTable.id, (await db.select().from(videosTable).where(eq(videosTable.id, videoId)).limit(1))[0]?.projectId ?? -1)
      );
    }, 8000);
  }, 2000);
}

router.get("/videos", requireAuth, async (req, res) => {
  const query = ListVideosQueryParams.safeParse(req.query);
  let videos;
  if (query.success && query.data.projectId) {
    videos = await db.select().from(videosTable).where(and(eq(videosTable.userId, req.session.userId!), eq(videosTable.projectId, query.data.projectId))).orderBy(videosTable.createdAt);
  } else {
    videos = await db.select().from(videosTable).where(eq(videosTable.userId, req.session.userId!)).orderBy(videosTable.createdAt);
  }
  return res.json(videos.reverse());
});

router.post("/videos", requireAuth, async (req, res) => {
  const parsed = GenerateVideoBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
  const [video] = await db.insert(videosTable).values({
    ...parsed.data,
    userId: req.session.userId!,
    status: "queued",
    backgroundReplaced: parsed.data.backgroundReplaced ?? false,
  }).returning();
  await db.insert(activityTable).values({ userId: req.session.userId!, type: "video_generated", description: `Started generating "${video.title}"`, resourceId: video.id, resourceType: "video" });
  await db.update(projectsTable).set({ status: "processing", updatedAt: new Date() }).where(eq(projectsTable.id, video.projectId));
  simulateProcessing(video.id);
  return res.status(201).json(video);
});

router.get("/videos/:id", requireAuth, async (req, res) => {
  const params = GetVideoParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [video] = await db.select().from(videosTable).where(and(eq(videosTable.id, params.data.id), eq(videosTable.userId, req.session.userId!))).limit(1);
  if (!video) return res.status(404).json({ error: "Video not found" });
  return res.json(video);
});

router.delete("/videos/:id", requireAuth, async (req, res) => {
  const params = DeleteVideoParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [video] = await db.delete(videosTable).where(and(eq(videosTable.id, params.data.id), eq(videosTable.userId, req.session.userId!))).returning();
  if (!video) return res.status(404).json({ error: "Video not found" });
  return res.json({ message: "Video deleted" });
});

router.post("/videos/:id/apply-style", requireAuth, async (req, res) => {
  const params = ApplyStyleParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const body = ApplyStyleBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid request body" });
  const [video] = await db.update(videosTable).set({ style: body.data.style, status: "queued" }).where(and(eq(videosTable.id, params.data.id), eq(videosTable.userId, req.session.userId!))).returning();
  if (!video) return res.status(404).json({ error: "Video not found" });
  await db.insert(activityTable).values({ userId: req.session.userId!, type: "style_applied", description: `Applied ${body.data.style} style to "${video.title}"`, resourceId: video.id, resourceType: "video" });
  simulateProcessing(video.id);
  return res.json(video);
});

router.post("/videos/upload-character", requireAuth, async (req, res) => {
  const parsed = UploadCharacterImageBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
  const [char] = await db.insert(charactersTable).values({
    userId: req.session.userId!,
    name: parsed.data.name,
    imageUrl: parsed.data.imageDataUrl.substring(0, 500),
  }).returning();
  await db.insert(activityTable).values({ userId: req.session.userId!, type: "character_added", description: `Uploaded character "${char.name}"`, resourceId: char.id, resourceType: "character" });
  return res.json({ imageUrl: char.imageUrl, characterId: char.id });
});

export default router;
