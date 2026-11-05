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

    const formattedChats = chats.map((chat: any) => {
      const isGroup = chat.isGroup ?? false;
      const otherParticipant = chat.participants.find((p: any) => p._id.toString() !== userId);
      const isPinned = chat.pinnedBy.some((id: any) => id.toString() === userId);

      return {
        _id: chat._id,
        isGroup,
        groupName: chat.groupName || "",
        groupAvatar: chat.groupAvatar || "",
        groupAdmin: chat.groupAdmin || null,
        participants: chat.participants,
        participant: isGroup ? null : (otherParticipant ?? null),
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

    // check if 1-on-1 chat already exists
    let chat = await Chat.findOne({
      isGroup: { $ne: true },
      participants: { $all: [userId, participantId], $size: 2 },
    })
      .populate("participants", "name email avatar")
      .populate("lastMessage");

    if (!chat) {
      const newChat = new Chat({ participants: [userId, participantId], isGroup: false });
      await newChat.save();
      chat = await newChat.populate("participants", "name email avatar");
    }

    const otherParticipant = chat.participants.find((p: any) => p._id.toString() !== userId);
    const isPinned = chat.pinnedBy.some((id) => id.toString() === userId);

    res.json({
      _id: chat._id,
      isGroup: false,
      participant: otherParticipant ?? null,
      participants: chat.participants,
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
// Create a new Group Chat
// ─────────────────────────────────────────────
export async function createGroupChat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { name, participantIds, avatar } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ message: "Group name is required" });
      return;
    }

    if (!Array.isArray(participantIds) || participantIds.length < 1) {
      res.status(400).json({ message: "At least one participant must be selected" });
      return;
    }

    // Include the creator in participants
    const uniqueParticipants = Array.from(new Set([userId, ...participantIds]));

    const newGroupChat = new Chat({
      isGroup: true,
      groupName: name.trim(),
      groupAvatar: avatar || "",
      groupAdmin: userId,
      participants: uniqueParticipants,
    });

    await newGroupChat.save();
    const populatedChat: any = await newGroupChat.populate("participants", "name email avatar");

    res.status(201).json({
      _id: populatedChat._id,
      isGroup: true,
      groupName: populatedChat.groupName,
      groupAvatar: populatedChat.groupAvatar,
      groupAdmin: populatedChat.groupAdmin,
      participants: populatedChat.participants,
      lastMessage: null,
      lastMessageAt: populatedChat.lastMessageAt,
      createdAt: populatedChat.createdAt,
      isPinned: false,
    });
  } catch (error) {
    res.status(500);
    next(error);
  }
}

// ─────────────────────────────────────────────
// Add members to Group Chat
// ─────────────────────────────────────────────
export async function addGroupMembers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { chatId } = req.params;
    const { memberIds } = req.body;

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ message: "Member IDs are required" });
      return;
    }

    const chat: any = await Chat.findById(chatId);
    if (!chat || !chat.isGroup) {
      res.status(404).json({ message: "Group chat not found" });
      return;
    }

    const isMember = chat.participants.some((id: any) => id.toString() === userId);
    if (!isMember) {
      res.status(403).json({ message: "Only group members can add new participants" });
      return;
    }

    const currentMemberStrs = new Set(chat.participants.map((id: any) => id.toString()));
    memberIds.forEach((id: string) => {
      if (Types.ObjectId.isValid(id) && !currentMemberStrs.has(id)) {
        chat.participants.push(id);
      }
    });

    await chat.save();
    const updated = await Chat.findById(chatId)
      .populate("participants", "name email avatar")
      .populate("lastMessage");

    res.json(updated);
  } catch (error) {
    res.status(500);
    next(error);
  }
}

// ─────────────────────────────────────────────
// Leave Group Chat
// ─────────────────────────────────────────────
export async function leaveGroupChat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { chatId } = req.params;

    const chat: any = await Chat.findById(chatId);
    if (!chat || !chat.isGroup) {
      res.status(404).json({ message: "Group chat not found" });
      return;
    }

    chat.participants = chat.participants.filter((id: any) => id.toString() !== userId);

    if (chat.participants.length === 0) {
      await chat.deleteOne();
      res.json({ message: "Group deleted as all members left", chatId });
      return;
    }

    if (chat.groupAdmin?.toString() === userId) {
      chat.groupAdmin = chat.participants[0];
    }

    await chat.save();
    res.json({ message: "Left group successfully", chatId });
  } catch (error) {
    res.status(500);
    next(error);
  }
}

// ─────────────────────────────────────────────
// Get Chat Details (including all participants)
// ─────────────────────────────────────────────
export async function getChatDetails(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId;
    const { chatId } = req.params;

    const chat: any = await Chat.findOne({ _id: chatId, participants: userId })
      .populate("participants", "name email avatar")
      .populate("groupAdmin", "name email avatar")
      .populate("lastMessage");

    if (!chat) {
      res.status(404).json({ message: "Chat not found" });
      return;
    }

    const otherParticipant = chat.participants.find((p: any) => p._id.toString() !== userId);
    const isPinned = chat.pinnedBy.some((id: any) => id.toString() === userId);

    res.json({
      _id: chat._id,
      isGroup: chat.isGroup ?? false,
      groupName: chat.groupName || "",
      groupAvatar: chat.groupAvatar || "",
      groupAdmin: chat.groupAdmin || null,
      participants: chat.participants,
      participant: chat.isGroup ? null : (otherParticipant ?? null),
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