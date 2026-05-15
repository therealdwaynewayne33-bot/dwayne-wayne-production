import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.SESSION_SECRET ?? "dreamframe-secret-key";

export interface AuthPayload {
  userId: number;
}

export function signToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function isLocalDevRequest(req: Request): boolean {
  if (process.env.DISABLE_AUTH === "true") return true;
  if (process.env.NODE_ENV === "production") return false;
  // If running locally (no Replit env) we want a zero-friction demo experience.
  if (!process.env.REPL_ID) return true;

  const host = (req.headers.host ?? "").toLowerCase();
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Local development: bypass auth and inject a demo user id.
  if (isLocalDevRequest(req)) {
    req.session.userId = req.session.userId ?? 1;
    return next();
  }

  // 1. Check Authorization: Bearer <token> header first (works in iframe)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      req.session.userId = payload.userId;
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  // 2. Fall back to session cookie
  if (req.session.userId) {
    return next();
  }

  return res.status(401).json({ error: "Not authenticated" });
}
