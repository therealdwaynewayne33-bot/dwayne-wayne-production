import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RegisterUserBody, LoginUserBody } from "@workspace/api-zod";
import { signToken, requireAuth } from "../middlewares/requireAuth";

const router = Router();

router.post("/auth/register", async (req, res) => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const { email, name, password } = parsed.data;
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(400).json({ error: "Email already registered" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ email, name, passwordHash, plan: "free" }).returning();
  req.session.userId = user.id;
  return res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, plan: user.plan, credits: user.credits, createdAt: user.createdAt },
    token: signToken(user.id),
  });
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  req.session.userId = user.id;
  return res.json({
    user: { id: user.id, email: user.email, name: user.name, plan: user.plan, credits: user.credits, createdAt: user.createdAt },
    token: signToken(user.id),
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {});
  return res.json({ message: "Logged out" });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const isLocalDev = process.env.NODE_ENV !== "production" && !process.env.REPL_ID;

  // If DB isn't configured locally, still allow the UI to load.
  if (isLocalDev && !process.env.DATABASE_URL) {
    return res.json({
      id: 1,
      email: "demo@localhost",
      name: "Demo User",
      plan: "free",
      credits: 1000,
      createdAt: new Date().toISOString(),
    });
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId!))
      .limit(1);

    if (!user) {
      if (!isLocalDev) return res.status(401).json({ error: "User not found" });

      // Local dev convenience: ensure a demo user exists.
      const [created] = await db
        .insert(usersTable)
        .values({
          id: 1,
          email: "demo@localhost",
          name: "Demo User",
          passwordHash: "dev-only",
          plan: "free",
        })
        .onConflictDoNothing()
        .returning();

      const u = created ?? {
        id: 1,
        email: "demo@localhost",
        name: "Demo User",
        plan: "free",
        credits: 1000,
        createdAt: new Date(),
      };

      return res.json({
        id: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        credits: (u as any).credits ?? 1000,
        createdAt: (u as any).createdAt ?? new Date().toISOString(),
      });
    }

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      credits: user.credits,
      createdAt: user.createdAt,
    });
  } catch (error: any) {
    req.log?.error?.({ err: error }, "auth/me failed");
    return res.status(500).json({ error: error?.message ? String(error.message) : "Internal server error" });
  }
});

export default router;
