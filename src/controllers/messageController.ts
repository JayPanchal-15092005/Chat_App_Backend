import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth";
import { Message } from "../models/Message.ts";
import { Chat } from "../models/Chat.ts";

export async function getMessages(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { chatId } = req.params;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
    });

    if (!chat) {
      res.status(404).json({ message: "Chat not found" });
      return;
    }

    const messages = await Message.find({ chat: chatId })
      .populate("sender", "name email avatar")
      .populate("replyTo", "text sender")
      .sort({ createdAt: 1 }); // oldest first

    res.json(messages);
  } catch (error) {
    res.status(500);
    next(error);
  }
}

// ─────────────────────────────────────────────
// Edit a message (sender only, within 15 minutes)
// ─────────────────────────────────────────────
export async function editMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { messageId } = req.params;
    const { text } = req.body;

    if (!text?.trim()) {
      res.status(400).json({ message: "Text is required" });
      return;
    }

    const message = await Message.findById(messageId);

    if (!message) {
      res.status(404).json({ message: "Message not found" });
      return;
    }

    if (message.sender.toString() !== userId) {
      res.status(403).json({ message: "Cannot edit someone else's message" });
      return;
    }

    // 15-minute edit window
    const fifteenMinutes = 15 * 60 * 1000;
    if (Date.now() - message.createdAt.getTime() > fifteenMinutes) {
      res.status(403).json({ message: "Edit window has expired (15 minutes)" });
      return;
    }

    message.text = text.trim();
    message.isEdited = true;
    await message.save();

    await message.populate("sender", "name email avatar");
    await message.populate("replyTo", "text sender");

    res.json(message);
  } catch (error) {
    res.status(500);
    next(error);
  }
}

// ─────────────────────────────────────────────
// Delete a message (sender only)
// ─────────────────────────────────────────────
export async function deleteMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);

    if (!message) {
      res.status(404).json({ message: "Message not found" });
      return;
    }

    if (message.sender.toString() !== userId) {
      res.status(403).json({ message: "Cannot delete someone else's message" });
      return;
    }

    await message.deleteOne();

    res.json({ message: "Message deleted", messageId });
  } catch (error) {
    res.status(500);
    next(error);
  }
}