import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.SESSION_SECRET ?? "dreamframe-secret-key";

export interface AuthPayload {
  userId: number;
}

export function signToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
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
