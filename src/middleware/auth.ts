import type { Request, Response, NextFunction } from "express";
import { admin } from "../utils/firebase.ts";
import { User } from "../models/User.ts";

export type AuthRequest = Request & {
  userId?: string;
  firebaseUid?: string;
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

      // Verify the Firebase ID token
      const decodedToken = await admin.auth().verifyIdToken(token);
      const firebaseUid = decodedToken.uid;

      // Find user by firebaseUid (formerly clerkId)
      const user = await User.findOne({ clerkId: firebaseUid });
      
      if (!user) {
        // Allow the callback route to bypass the missing user check
        // because it's responsible for CREATING the user
        if (req.originalUrl.includes("/auth/callback") || req.originalUrl.includes("/auth/me")) {
           req.firebaseUid = firebaseUid;
           return next();
        }
        return res.status(404).json({ message: "User not found" });
      }

      req.userId = user._id.toString();
      req.firebaseUid = firebaseUid;

      next();
    } catch (error) {
      console.error("[Auth] Token verification failed:", error);
      res.status(401).json({ message: "Unauthorized - invalid token" });
    }
  },
];