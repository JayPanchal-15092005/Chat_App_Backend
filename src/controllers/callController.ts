import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.ts";
import { Call } from "../models/Call.ts";

export const getCallHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const calls = await Call.find({
      $or: [{ caller: userId }, { receiver: userId }],
    })
      .populate("caller", "name avatar")
      .populate("receiver", "name avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Call.countDocuments({
      $or: [{ caller: userId }, { receiver: userId }],
    });

    res.status(200).json({
      calls,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[CallController] getCallHistory error:", error);
    res.status(500).json({ message: "Failed to fetch call history" });
  }
};
