import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import { verifyToken } from "@clerk/express";
import { Message } from "../models/Message.ts";
import { Chat } from "../models/Chat.ts";
import { User } from "../models/User.ts";

export const onlineUsers: Map<string, string> = new Map();

// ─────────────────────────────────────────────
// Expo Push Notification helper
// ─────────────────────────────────────────────

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

async function sendExpoPushNotification(message: ExpoPushMessage): Promise<void> {
  if (
    !message.to.startsWith("ExponentPushToken[") &&
    !message.to.startsWith("ExpoPushToken[")
  ) {
    console.error("[Push] Invalid token format:", message.to);
    return;
  }

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(message),
    });
    const result = (await response.json()) as any;
    if (result?.data?.status === "error") {
      console.error("[Push] Error:", result.data.message);
    }
  } catch (error) {
    console.error("[Push] Fetch failed:", error);
  }
}

// ─────────────────────────────────────────────
// Socket initialization
// ─────────────────────────────────────────────

export const initializeSocket = (httpServer: HttpServer) => {
  const allowedOrigins = [
    "http://localhost:8081",
    "http://localhost:5173",
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[];

  const io = new SocketServer(httpServer, { cors: { origin: allowedOrigins } });

  // Auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error"));
    try {
      const session = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      const user = await User.findOne({ clerkId: session.sub });
      if (!user) return next(new Error("User not found"));
      socket.data.userId = user._id.toString();
      next();
    } catch (error: any) {
      next(new Error(error));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;

    socket.emit("online-users", { userIds: Array.from(onlineUsers.keys()) });
    onlineUsers.set(userId, socket.id);
    socket.broadcast.emit("user-online", { userId });
    socket.join(`user:${userId}`);

    // ── Join / Leave chat rooms ────────────────────────────────────────
    socket.on("join-chat", (chatId: string) => {
      socket.join(`chat:${chatId}`);
    });

    socket.on("leave-chat", (chatId: string) => {
      socket.leave(`chat:${chatId}`);
    });

    // ── Mark messages as DELIVERED ────────────────────────────────────
    socket.on("message-delivered", async ({ chatId }: { chatId: string }) => {
      try {
        const updated = await Message.find(
          { chat: chatId, sender: { $ne: userId }, status: "sent" }
        ).select("sender");

        if (updated.length > 0) {
          await Message.updateMany(
            { chat: chatId, sender: { $ne: userId }, status: "sent" },
            { $set: { status: "delivered" } }
          );

          const payload = { chatId, status: "delivered", updatedBy: userId };

          // Notify everyone in the chat room
          socket.to(`chat:${chatId}`).emit("message-status-update", payload);

          // Also notify each sender via their personal room (works even when not in chat)
          const senderIds = [...new Set(updated.map((m) => m.sender.toString()))];
          for (const senderId of senderIds) {
            io.to(`user:${senderId}`).emit("message-status-update", payload);
          }
        }
      } catch (error) {
        console.error("[Socket] message-delivered error:", error);
      }
    });

    // ── Mark messages as SEEN ─────────────────────────────────────────
    socket.on("message-seen", async ({ chatId }: { chatId: string }) => {
      try {
        const updated = await Message.find({
          chat: chatId,
          sender: { $ne: userId },
          status: { $in: ["sent", "delivered"] },
        }).select("sender");

        if (updated.length > 0) {
          await Message.updateMany(
            { chat: chatId, sender: { $ne: userId }, status: { $in: ["sent", "delivered"] } },
            { $set: { status: "seen" } }
          );

          const payload = { chatId, status: "seen", updatedBy: userId };

          // Notify everyone in the chat room
          socket.to(`chat:${chatId}`).emit("message-status-update", payload);

          // Also notify each original sender via their personal room
          const senderIds = [...new Set(updated.map((m) => m.sender.toString()))];
          for (const senderId of senderIds) {
            io.to(`user:${senderId}`).emit("message-status-update", payload);
          }
        }
      } catch (error) {
        console.error("[Socket] message-seen error:", error);
      }
    });

    // ── Send message ──────────────────────────────────────────────────
    socket.on(
      "send-message",
      async (data: { chatId: string; text: string; replyToId?: string; type?: "text" | "image" | "voice"; mediaUrl?: string }) => {
        try {
          const { chatId, text, replyToId, type = "text", mediaUrl } = data;

          const chat = await Chat.findOne({ _id: chatId, participants: userId });
          if (!chat) {
            socket.emit("socket-error", { message: "Chat not found" });
            return;
          }

          const message = await Message.create({
            chat: chatId,
            sender: userId,
            text,
            type,
            mediaUrl: mediaUrl || null,
            replyTo: replyToId || null,
            status: "sent",
          });


          chat.lastMessage = message._id;
          chat.lastMessageAt = new Date();
          await chat.save();

          await message.populate("sender", "name avatar");
          if (replyToId) {
            await message.populate("replyTo", "text sender");
          }

          io.to(`chat:${chatId}`).emit("new-message", message);

          for (const participantId of chat.participants) {
            io.to(`user:${participantId}`).emit("new-message", message);
          }

          // Push notifications for offline users
          const senderUser = await User.findById(userId).select("name");
          const senderName = senderUser?.name ?? "Someone";
          const senderAvatar = (message.sender as any)?.avatar ?? "";

          for (const participantId of chat.participants) {
            const pidStr = participantId.toString();
            if (pidStr === userId) continue;

            const recipient = await User.findById(pidStr).select("fcmToken");
            if (!recipient?.fcmToken) continue;

            await sendExpoPushNotification({
              to: recipient.fcmToken,
              title: senderName,
              body: text.length > 100 ? `${text.slice(0, 100)}…` : text,
              sound: "default",
              priority: "high",
              channelId: "messages",
              data: {
                chatId,
                participantId: userId,
                name: senderName,
                avatar: senderAvatar,
              },
            });
          }
        } catch (error) {
          console.error("[Socket] send-message error:", error);
          socket.emit("socket-error", { message: "Failed to send message" });
        }
      }
    );

    // ── React to message ──────────────────────────────────────────────
    socket.on(
      "react-message",
      async ({
        messageId,
        chatId,
        emoji,
      }: {
        messageId: string;
        chatId: string;
        emoji: string;
      }) => {
        try {
          const message = await Message.findOne({ _id: messageId, chat: chatId });
          if (!message) return;

          const existingIdx = message.reactions.findIndex(
            (r) => r.userId.toString() === userId
          );

          if (existingIdx !== -1) {
            if (message.reactions[existingIdx].emoji === emoji) {
              // Toggle off same emoji
              message.reactions.splice(existingIdx, 1);
            } else {
              // Replace with new emoji
              message.reactions[existingIdx].emoji = emoji;
            }
          } else {
            (message.reactions as any).push({ userId, emoji });
          }

          await message.save();

          io.to(`chat:${chatId}`).emit("message-reaction-update", {
            messageId,
            chatId,
            reactions: message.reactions,
          });
        } catch (error) {
          console.error("[Socket] react-message error:", error);
        }
      }
    );

    // ── Edit message ──────────────────────────────────────────────────
    socket.on(
      "edit-message",
      async ({
        messageId,
        chatId,
        text,
      }: {
        messageId: string;
        chatId: string;
        text: string;
      }) => {
        try {
          const message = await Message.findOne({ _id: messageId, chat: chatId });
          if (!message) return;
          if (message.sender.toString() !== userId) return;

          const fifteenMinutes = 15 * 60 * 1000;
          if (Date.now() - message.createdAt.getTime() > fifteenMinutes) {
            socket.emit("socket-error", { message: "Edit window has expired" });
            return;
          }

          message.text = text.trim();
          message.isEdited = true;
          await message.save();

          io.to(`chat:${chatId}`).emit("message-edited", {
            messageId,
            chatId,
            text: message.text,
            isEdited: true,
          });
        } catch (error) {
          console.error("[Socket] edit-message error:", error);
        }
      }
    );

    // ── Delete message ────────────────────────────────────────────────
    socket.on(
      "delete-message",
      async ({
        messageId,
        chatId,
      }: {
        messageId: string;
        chatId: string;
      }) => {
        try {
          const message = await Message.findOne({ _id: messageId, chat: chatId });
          if (!message) return;
          if (message.sender.toString() !== userId) return;

          await message.deleteOne();

          io.to(`chat:${chatId}`).emit("message-deleted", { messageId, chatId });
        } catch (error) {
          console.error("[Socket] delete-message error:", error);
        }
      }
    );

    // ── Typing indicator ──────────────────────────────────────────────
    socket.on(
      "typing",
      async (data: { chatId: string; isTyping: boolean }) => {
        const typingPayload = {
          userId,
          chatId: data.chatId,
          isTyping: data.isTyping,
        };

        socket.to(`chat:${data.chatId}`).emit("typing", typingPayload);

        try {
          const chat = await Chat.findById(data.chatId);
          if (chat) {
            const otherParticipantId = chat.participants.find(
              (p: any) => p.toString() !== userId
            );
            if (otherParticipantId) {
              socket
                .to(`user:${otherParticipantId}`)
                .emit("typing", typingPayload);
            }
          }
        } catch (_) {
          // silently fail — typing indicator is not critical
        }
      }
    );

    // ── Disconnect ────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      onlineUsers.delete(userId);
      socket.broadcast.emit("user-offline", { userId });
    });
  });

  return io;
};
