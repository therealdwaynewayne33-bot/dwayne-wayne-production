import { pgTable, serial, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const activityTypeEnum = pgEnum("activity_type", ["video_generated", "character_added", "project_created", "style_applied"]);

export const activityTable = pgTable("activity", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: activityTypeEnum("type").notNull(),
  description: text("description").notNull(),
  resourceId: integer("resource_id"),
  resourceType: text("resource_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Activity = typeof activityTable.$inferSelect;
