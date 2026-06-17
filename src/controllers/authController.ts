import type { NextFunction, Request, Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { User } from "../models/User.ts";
import { admin } from "../utils/firebase.ts";

export async function getMe(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.userId;
    // req.userId is undefined if this is their first time logging in 
    // and they hit /auth/me before /auth/callback. Handle this gracefully.
    if (!userId) {
      const firebaseUid = req.firebaseUid;
      if (!firebaseUid) return res.status(401).json({ message: "Unauthorized" });
      const user = await User.findOne({ clerkId: firebaseUid });
      if (!user) return res.status(404).json({ message: "User not found" });
      return res.status(200).json(user);
    }

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500);
    next(error);
  }
}

export async function authCallback(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const firebaseUid = req.firebaseUid;

    if (!firebaseUid) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    let user = await User.findOne({ clerkId: firebaseUid });

    if (!user) {
      try {
        // get user info from Firebase and save to db
        const firebaseUser = await admin.auth().getUser(firebaseUid);

        // Name fallback: 1. DisplayName, 2. Email username, 3. 'User'
        let name = firebaseUser.displayName;
        if (!name && firebaseUser.email) {
          name = firebaseUser.email.split("@")[0];
        }
        if (!name) name = "User";

        user = await User.create({
          clerkId: firebaseUid, // we keep the field name clerkId for backwards compatibility in DB
          name: name.trim(),
          email: firebaseUser.email || `${firebaseUid}@placeholder.com`,
          avatar: firebaseUser.photoURL || "",
        });
      } catch (error: any) {
        // Catch the MongoDB duplicate key error specifically
        if (error.code === 11000) {
          user = await User.findOne({ clerkId: firebaseUid });
        } else {
          throw error;
        }
      }
    }

    res.json(user);
  } catch (error) {
    res.status(500);
    next(error);
  }
}