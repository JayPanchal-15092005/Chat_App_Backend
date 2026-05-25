import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { Chat } from "../models/Chat.ts";
import { Types } from "mongoose";

export async function getChats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;

    const chats = await Chat.find({ participants: userId })
      .populate("participants", "name email avatar")
      .populate("lastMessage")
      .sort({ lastMessageAt: -1 });

    const formattedChats = chats.map((chat) => {
      const otherParticipant = chat.participants.find((p) => p._id.toString() !== userId);
      const isPinned = chat.pinnedBy.some((id) => id.toString() === userId);

      return {
        _id: chat._id,
        participant: otherParticipant ?? null,
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt,
        createdAt: chat.createdAt,
        isPinned,
      };
    });

    res.json(formattedChats);
  } catch (error) {
    res.status(500);
    next(error);
  }
}

export async function getOrCreateChat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { participantId } = req.params;

    if (!participantId || Array.isArray(participantId)) {
      res.status(400).json({ message: "Participant ID is required" });
      return;
    }

    if (!Types.ObjectId.isValid(participantId)) {
      return res.status(400).json({ message: "Invalid participant ID" });
    }

    if (userId === participantId) {
      res.status(400).json({ message: "Cannot create chat with yourself" });
      return;
    }

    // check if chat already exists
    let chat = await Chat.findOne({
      participants: { $all: [userId, participantId] },
    })
      .populate("participants", "name email avatar")
      .populate("lastMessage");

    if (!chat) {
      const newChat = new Chat({ participants: [userId, participantId] });
      await newChat.save();
      chat = await newChat.populate("participants", "name email avatar");
    }

    const otherParticipant = chat.participants.find((p: any) => p._id.toString() !== userId);
    const isPinned = chat.pinnedBy.some((id) => id.toString() === userId);

    res.json({
      _id: chat._id,
      participant: otherParticipant ?? null,
      lastMessage: chat.lastMessage,
      lastMessageAt: chat.lastMessageAt,
      createdAt: chat.createdAt,
      isPinned,
    });
  } catch (error) {
    res.status(500);
    next(error);
  }
}

// ─────────────────────────────────────────────
// Toggle pin/unpin a chat for the current user
// ─────────────────────────────────────────────
export async function togglePinChat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { chatId } = req.params;

    const chat = await Chat.findOne({ _id: chatId, participants: userId });

    if (!chat) {
      res.status(404).json({ message: "Chat not found" });
      return;
    }

    const alreadyPinned = chat.pinnedBy.some((id) => id.toString() === userId);

    if (alreadyPinned) {
      chat.pinnedBy = chat.pinnedBy.filter((id) => id.toString() !== userId) as any;
    } else {
      (chat.pinnedBy as any).push(userId);
    }

    await chat.save();

    res.json({ isPinned: !alreadyPinned, chatId });
  } catch (error) {
    res.status(500);
    next(error);
  }
}