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
const CHARS_DIR  = path.join(__dirname, "../public/chars");

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

// Resolve Replicate output to a URL string
function resolveReplicateUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof (output as any).url === "function") return (output as any).url().href;
  if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    return typeof item === "string" ? item : item.url().href;
  }
  throw new Error("Unexpected Replicate output format");
}

// Generate real video using AI
// • Default model: wavespeedai/wan-2.1-t2v-720p  — high quality, sharp faces, great motion
// • Face-lock fallback: minimax/video-01          — supports first_frame_image reference
async function generateVideo(videoId: number, prompt: string, characterImageUrl?: string): Promise<{ videoUrl: string; duration: number }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");

  const replicate = new Replicate({ auth: token });

  let output: unknown;

  if (characterImageUrl) {
    // Face-lock: use minimax which supports first_frame_image
    output = await replicate.run("minimax/video-01", {
      input: { prompt, prompt_optimizer: true, first_frame_image: characterImageUrl },
    });
  } else {
    // Default: Wan 2.1 — sharper 720p, better face rendering, more natural motion
    output = await replicate.run("wavespeedai/wan-2.1-t2v-720p", {
      input: {
        prompt,
        aspect_ratio: "16:9",
        fast_mode: "Balanced",
        sample_steps: 30,
        negative_prompt: "blur, low quality, distorted face, watermark, text",
        disable_safety_checker: false,
      },
    });
  }

  const remoteUrl = resolveReplicateUrl(output);

  // Download and serve locally so the URL stays valid
  await mkdir(VIDEOS_DIR, { recursive: true });
  const videoResp = await fetch(remoteUrl);
  if (!videoResp.ok) throw new Error(`Failed to fetch video: ${videoResp.status}`);
  const buf = Buffer.from(await videoResp.arrayBuffer());
  await writeFile(path.join(VIDEOS_DIR, `${videoId}.mp4`), buf);

  return { videoUrl: `/api/videos-files/${videoId}.mp4`, duration: 6 };
}

async function runGeneration(videoId: number, prompt: string) {
  try {
    await db.update(videosTable).set({ status: "processing" }).where(eq(videosTable.id, videoId));

    // Fetch the video record to get characterId (for face lock)
    const [videoRecord] = await db.select().from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
    let characterImageUrl: string | undefined;
    if (videoRecord?.characterId) {
      const [char] = await db.select().from(charactersTable).where(eq(charactersTable.id, videoRecord.characterId)).limit(1);
      if (char?.imageUrl && char.imageUrl.startsWith("/api/char-files/")) {
        // Build a public URL Replicate can fetch
        const domain = process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0];
        if (domain) {
          characterImageUrl = `https://${domain}/api/char-files/${char.id}.png`;
        }
      }
    }

    // Run thumbnail and video generation in parallel
    const [thumbnailUrl, videoResult] = await Promise.allSettled([
      generateThumbnail(videoId, prompt),
      generateVideo(videoId, prompt, characterImageUrl),
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

  // Insert with placeholder to get ID
  const [char] = await db.insert(charactersTable).values({
    userId: req.session.userId!,
    name: parsed.data.name,
    imageUrl: "",
  }).returning();

  // Save the full image as a file
  let imageUrl = parsed.data.imageDataUrl;
  if (imageUrl.startsWith("data:image")) {
    await mkdir(CHARS_DIR, { recursive: true });
    const base64 = imageUrl.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    await writeFile(path.join(CHARS_DIR, `${char.id}.png`), buf);
    imageUrl = `/api/char-files/${char.id}.png`;
  }

  await db.update(charactersTable).set({ imageUrl }).where(eq(charactersTable.id, char.id));
  await db.insert(activityTable).values({ userId: req.session.userId!, type: "character_added", description: `Uploaded character "${char.name}"`, resourceId: char.id, resourceType: "character" });
  return res.json({ imageUrl, characterId: char.id });
});

export default router;
