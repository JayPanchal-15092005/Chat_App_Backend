import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth";
import { User } from "../models/User.ts";

export async function getUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;

    const users = await User.find({ _id: { $ne: userId } })
      .select("name email avatar")
      .limit(50);

    res.json(users);
  } catch (error) {
    res.status(500);
    next(error);
  }
}

export async function updateFcmToken(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== "string") {
      res.status(400).json({ message: "fcmToken is required" });
      return;
    }

    await User.findByIdAndUpdate(userId, { fcmToken });

    res.json({ message: "FCM token updated successfully" });
  } catch (error) {
    res.status(500);
    next(error);
  }
}