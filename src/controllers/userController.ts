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

export async function updatePushTokens(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { expoPushToken, fcmToken } = req.body;

    const updateData: any = {};
    if (expoPushToken !== undefined) updateData.expoPushToken = expoPushToken;
    
    if (fcmToken !== undefined) {
      if (typeof fcmToken === "string" && (fcmToken.startsWith("ExponentPushToken") || fcmToken.startsWith("ExpoPushToken"))) {
        console.warn(`[API] Invalid FCM token rejected for user ${userId}: ${fcmToken}`);
        // Auto-correct: save it to expoPushToken instead if expoPushToken wasn't provided
        if (expoPushToken === undefined) {
          updateData.expoPushToken = fcmToken;
        }
      } else {
        updateData.fcmToken = fcmToken;
      }
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ message: "At least one valid token (expoPushToken or fcmToken) is required" });
      return;
    }

    await User.findByIdAndUpdate(userId, updateData);

    res.json({ message: "Push tokens updated successfully" });
  } catch (error) {
    res.status(500);
    next(error);
  }
}