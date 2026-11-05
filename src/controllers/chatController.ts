import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { Chat } from "../models/Chat.ts";
import { Message } from "../models/Message.ts";
import { User } from "../models/User.ts";
import { getIO, sendExpoPushNotification } from "../utils/socket.ts";
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

/// ─────────────────────────────────────────────
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

    // Create system / initial announcement message
    const creator = await User.findById(userId).select("name avatar");
    const creatorName = creator?.name || "Someone";

    const systemMessage = await Message.create({
      chat: newGroupChat._id,
      sender: userId,
      text: `${creatorName} created the group "${name.trim()}"`,
      type: "text",
      status: "sent",
    });

    newGroupChat.lastMessage = systemMessage._id;
    newGroupChat.lastMessageAt = new Date();
    await newGroupChat.save();

    const populatedChat: any = await Chat.findById(newGroupChat._id)
      .populate("participants", "name email avatar")
      .populate("lastMessage");

    await systemMessage.populate("sender", "name avatar");

    // Emit socket event to all members so their chat list immediately updates
    const io = getIO();
    if (io) {
      for (const p of uniqueParticipants) {
        io.to(`user:${p.toString()}`).emit("new-message", systemMessage);
      }
    }

    // Push notification to all other added members
    (async () => {
      try {
        const otherParticipantIds = uniqueParticipants.filter((p) => p.toString() !== userId);
        const recipients = await User.find({
          _id: { $in: otherParticipantIds },
          expoPushToken: { $exists: true, $ne: null },
        }).select("expoPushToken name");

        const pushPromises = recipients.map((r) => {
          if (!r.expoPushToken) return Promise.resolve();
          return sendExpoPushNotification({
            to: r.expoPushToken,
            title: name.trim(),
            body: `${creatorName} added you to this group`,
            sound: "default",
            priority: "high",
            channelId: "messages",
            data: {
              chatId: newGroupChat._id.toString(),
              participantId: userId,
              name: name.trim(),
              isGroup: true,
              avatar: avatar || "",
            },
          });
        });

        await Promise.allSettled(pushPromises);
      } catch (err) {
        console.error("[createGroupChat] Push notification error:", err);
      }
    })();

    res.status(201).json(populatedChat);
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
    const newlyAddedIds: string[] = [];

    memberIds.forEach((id: string) => {
      if (Types.ObjectId.isValid(id) && !currentMemberStrs.has(id)) {
        chat.participants.push(id);
        newlyAddedIds.push(id);
      }
    });

    if (newlyAddedIds.length === 0) {
      const existingPopulated = await Chat.findById(chatId)
        .populate("participants", "name email avatar")
        .populate("lastMessage");
      return res.json(existingPopulated);
    }

    // Lookup adder name and added users' names
    const adder = await User.findById(userId).select("name");
    const adderName = adder?.name || "Someone";

    const addedUsers = await User.find({ _id: { $in: newlyAddedIds } }).select("name expoPushToken");
    const addedNames = addedUsers.map((u) => u.name).join(", ") || "new members";

    // Create system announcement message
    const systemMessage = await Message.create({
      chat: chatId,
      sender: userId,
      text: `${adderName} added ${addedNames}`,
      type: "text",
      status: "sent",
    });

    chat.lastMessage = systemMessage._id;
    chat.lastMessageAt = new Date();
    await chat.save();

    await systemMessage.populate("sender", "name avatar");

    const updated = await Chat.findById(chatId)
      .populate("participants", "name email avatar")
      .populate("lastMessage");

    // Real-time broadcast to all participants
    const io = getIO();
    if (io) {
      io.to(`chat:${chatId}`).emit("new-message", systemMessage);
      for (const p of chat.participants) {
        io.to(`user:${p.toString()}`).emit("new-message", systemMessage);
      }
    }

    // Push notification specifically to the newly added members
    (async () => {
      try {
        const pushPromises = addedUsers.map((u) => {
          if (!u.expoPushToken) return Promise.resolve();
          return sendExpoPushNotification({
            to: u.expoPushToken,
            title: chat.groupName || "Group",
            body: `${adderName} added you to the group "${chat.groupName || "Group"}"`,
            sound: "default",
            priority: "high",
            channelId: "messages",
            data: {
              chatId: chat._id.toString(),
              participantId: userId,
              name: chat.groupName || "Group",
              isGroup: true,
              avatar: chat.groupAvatar || "",
            },
          });
        });

        await Promise.allSettled(pushPromises);
      } catch (err) {
        console.error("[addGroupMembers] Push notification error:", err);
      }
    })();

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

    const leaver = await User.findById(userId).select("name");
    const leaverName = leaver?.name || "Someone";

    // Create departure announcement message
    const systemMessage = await Message.create({
      chat: chatId,
      sender: userId,
      text: `${leaverName} left the group`,
      type: "text",
      status: "sent",
    });

    chat.lastMessage = systemMessage._id;
    chat.lastMessageAt = new Date();
    await chat.save();

    const io = getIO();
    if (io) {
      await systemMessage.populate("sender", "name avatar");
      io.to(`chat:${chatId}`).emit("new-message", systemMessage);
      for (const p of chat.participants) {
        io.to(`user:${p.toString()}`).emit("new-message", systemMessage);
      }
    }

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