import { Router } from "express";
import { db, videosTable, activityTable, projectsTable, charactersTable, usersTable } from "@workspace/db";
import { eq, and, gte, count } from "drizzle-orm";
import {
  GenerateVideoBody,
  GetVideoParams,
  DeleteVideoParams,
  ApplyStyleParams,
  ApplyStyleBody,
  UploadCharacterImageBody,
  ListVideosQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Replicate from "replicate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBS_DIR = path.join(__dirname, "../public/thumbs");
const VIDEOS_DIR = path.join(__dirname, "../public/videos");

const router = Router();

const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  pro: 100,
  enterprise: Infinity,
};

// Generate a real thumbnail using OpenAI
async function generateThumbnail(videoId: number, prompt: string): Promise<string> {
  try {
    await mkdir(THUMBS_DIR, { recursive: true });
    const imagePrompt = `Cinematic still frame: ${prompt}. High quality, dramatic lighting, professional photography.`;
    const buffer = await generateImageBuffer(imagePrompt, "1536x1024");
    const filePath = path.join(THUMBS_DIR, `${videoId}.png`);
    await writeFile(filePath, buffer);
    return `/api/thumbs/${videoId}.png`;
  } catch {
    return `https://picsum.photos/seed/${videoId}/640/360`;
  }
}

// Generate real video using Replicate minimax/video-01
async function generateVideo(videoId: number, prompt: string): Promise<{ videoUrl: string; duration: number }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");

  const replicate = new Replicate({ auth: token });

  // Use minimax/video-01 — 6s video, good motion quality
  const output = await replicate.run("minimax/video-01", {
    input: {
      prompt: prompt,
      prompt_optimizer: true,
    },
  }) as unknown;

  // output is a ReadableStream or URL string depending on SDK version
  let videoUrl: string;
  if (typeof output === "string") {
    videoUrl = output;
  } else if (output && typeof (output as any).url === "function") {
    videoUrl = (output as any).url().href;
  } else if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    videoUrl = typeof item === "string" ? item : item.url().href;
  } else {
    throw new Error("Unexpected Replicate output format");
  }

  // Download and serve locally so the URL works reliably
  await mkdir(VIDEOS_DIR, { recursive: true });
  const videoResp = await fetch(videoUrl);
  if (!videoResp.ok) throw new Error(`Failed to fetch video: ${videoResp.status}`);
  const buf = Buffer.from(await videoResp.arrayBuffer());
  const localPath = path.join(VIDEOS_DIR, `${videoId}.mp4`);
  await writeFile(localPath, buf);

  return { videoUrl: `/api/videos-files/${videoId}.mp4`, duration: 6 };
}

async function runGeneration(videoId: number, prompt: string) {
  try {
    await db.update(videosTable).set({ status: "processing" }).where(eq(videosTable.id, videoId));

    // Run thumbnail and video generation in parallel
    const [thumbnailUrl, videoResult] = await Promise.allSettled([
      generateThumbnail(videoId, prompt),
      generateVideo(videoId, prompt),
    ]);

    const thumb = thumbnailUrl.status === "fulfilled" ? thumbnailUrl.value : `https://picsum.photos/seed/${videoId}/640/360`;
    const vidUrl = videoResult.status === "fulfilled" ? videoResult.value.videoUrl : null;
    const duration = videoResult.status === "fulfilled" ? videoResult.value.duration : 6;

    if (videoResult.status === "rejected") {
      // Log error but still complete with thumbnail only
      console.error("Video generation failed:", videoResult.reason);
    }

    await db.update(videosTable).set({
      status: "completed",
      videoUrl: vidUrl,
      thumbnailUrl: thumb,
      duration,
    }).where(eq(videosTable.id, videoId));
    await db.update(projectsTable).set({ status: "completed", updatedAt: new Date() }).where(
      eq(projectsTable.id, (await db.select().from(videosTable).where(eq(videosTable.id, videoId)).limit(1))[0]?.projectId ?? -1)
    );
  } catch (err) {
    console.error("runGeneration failed:", err);
    await db.update(videosTable).set({ status: "failed" }).where(eq(videosTable.id, videoId));
  }
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

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
  if (!user) return res.status(401).json({ error: "User not found" });

  const planLimit = PLAN_LIMITS[user.plan] ?? 10;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ value: monthlyCount }] = await db
    .select({ value: count() })
    .from(videosTable)
    .where(and(eq(videosTable.userId, user.id), gte(videosTable.createdAt, monthStart)));

  if (planLimit !== Infinity && monthlyCount >= planLimit) {
    return res.status(402).json({
      error: "Plan limit reached",
      planLimit,
      planUsed: monthlyCount,
      plan: user.plan,
    });
  }

  const [video] = await db.insert(videosTable).values({
    ...parsed.data,
    userId: req.session.userId!,
    status: "queued",
    backgroundReplaced: parsed.data.backgroundReplaced ?? false,
  }).returning();
  await db.insert(activityTable).values({ userId: req.session.userId!, type: "video_generated", description: `Started generating "${video.title}"`, resourceId: video.id, resourceType: "video" });
  await db.update(projectsTable).set({ status: "processing", updatedAt: new Date() }).where(eq(projectsTable.id, video.projectId));
  void runGeneration(video.id, parsed.data.prompt);
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
  void runGeneration(video.id, video.prompt);
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
