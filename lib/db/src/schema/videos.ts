import { pgTable, serial, text, timestamp, integer, pgEnum, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { charactersTable } from "./characters";

export const videoGenTypeEnum = pgEnum("video_gen_type", ["text-to-video", "image-to-video"]);
export const videoStyleEnum = pgEnum("video_style", ["realistic", "cartoon", "animated-3d", "cinematic"]);
export const videoStatusEnum = pgEnum("video_status", ["queued", "processing", "completed", "failed"]);

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  generationType: videoGenTypeEnum("generation_type").notNull(),
  style: videoStyleEnum("style").notNull().default("realistic"),
  status: videoStatusEnum("status").notNull().default("queued"),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  duration: real("duration"),
  characterId: integer("character_id").references(() => charactersTable.id),
  backgroundReplaced: boolean("background_replaced").notNull().default(false),
  backgroundPrompt: text("background_prompt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, createdAt: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
