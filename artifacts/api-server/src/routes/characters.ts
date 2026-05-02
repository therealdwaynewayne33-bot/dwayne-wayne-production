import { Router } from "express";
import { db, charactersTable, videosTable, activityTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { CreateCharacterBody, GetCharacterParams, DeleteCharacterParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHARS_DIR = path.join(__dirname, "../public/chars");

const router = Router();

async function saveCharacterImage(charId: number, dataUrl: string): Promise<string> {
  await mkdir(CHARS_DIR, { recursive: true });
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(base64, "base64");
  await writeFile(path.join(CHARS_DIR, `${charId}.png`), buf);
  return `/api/char-files/${charId}.png`;
}

router.get("/characters", requireAuth, async (req, res) => {
  const chars = await db.select().from(charactersTable).where(eq(charactersTable.userId, req.session.userId!));
  const result = await Promise.all(
    chars.map(async (c) => {
      const [{ count: vc }] = await db.select({ count: count() }).from(videosTable).where(eq(videosTable.characterId, c.id));
      return { ...c, videoCount: Number(vc) };
    })
  );
  return res.json(result);
});

router.post("/characters", requireAuth, async (req, res) => {
  const parsed = CreateCharacterBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });

  const imageDataUrl = parsed.data.imageUrl;

  // Insert with placeholder first to get the ID
  const [char] = await db.insert(charactersTable).values({
    ...parsed.data,
    imageUrl: "",
    userId: req.session.userId!,
  }).returning();

  // Save image file if it's a base64 data URL
  let imageUrl = imageDataUrl;
  if (imageDataUrl.startsWith("data:image")) {
    imageUrl = await saveCharacterImage(char.id, imageDataUrl);
    await db.update(charactersTable).set({ imageUrl }).where(eq(charactersTable.id, char.id));
  }

  await db.insert(activityTable).values({ userId: req.session.userId!, type: "character_added", description: `Added character "${char.name}"`, resourceId: char.id, resourceType: "character" });
  return res.status(201).json({ ...char, imageUrl, videoCount: 0 });
});

router.get("/characters/:id", requireAuth, async (req, res) => {
  const params = GetCharacterParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [char] = await db.select().from(charactersTable).where(and(eq(charactersTable.id, params.data.id), eq(charactersTable.userId, req.session.userId!))).limit(1);
  if (!char) return res.status(404).json({ error: "Character not found" });
  const [{ count: vc }] = await db.select({ count: count() }).from(videosTable).where(eq(videosTable.characterId, char.id));
  return res.json({ ...char, videoCount: Number(vc) });
});

router.delete("/characters/:id", requireAuth, async (req, res) => {
  const params = DeleteCharacterParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const [char] = await db.delete(charactersTable).where(and(eq(charactersTable.id, params.data.id), eq(charactersTable.userId, req.session.userId!))).returning();
  if (!char) return res.status(404).json({ error: "Character not found" });
  return res.json({ message: "Character deleted" });
});

export default router;
