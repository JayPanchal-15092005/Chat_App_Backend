import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "qLAtXn3gawbHWpxvaqhEXHU6g3l0FtM4o9Skse9NIU";

export type AuthRequest = Request & {
  userId?: string;
};

export const protectRoute = [
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized - missing token" });
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).json({ message: "Unauthorized - missing token" });
      }

      // Verify custom JWT
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      
      req.userId = decoded.userId;

      next();
    } catch (error) {
      console.error("[Auth] Token verification failed:", error);
      res.status(401).json({ message: "Unauthorized - invalid token" });
    }
  },
];