import { pgTable, serial, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const planEnum = pgEnum("plan", ["free", "pro", "enterprise"]);

// `credits` is the in-app currency that gates paid Replicate calls
// (BG Replace, Generate Scene, etc.). 1 credit ≈ $0.01 of GPU spend.
// Default 1000 covers ~10–20 generations so new users (and existing ones
// being backfilled by drizzle-kit push) can immediately try the product.
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  plan: planEnum("plan").notNull().default("free"),
  credits: integer("credits").notNull().default(1000),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
