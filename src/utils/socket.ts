import { Socket, Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import { verifyToken } from "@clerk/express";
import { Message } from "../models/Message.ts";
import { Chat } from "../models/Chat.ts";
import { User } from "../models/User.ts";

// store online users in memory: userId -> socketId
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

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

async function sendExpoPushNotification(message: ExpoPushMessage): Promise<void> {
  console.log(`[Push] Sending notification to token: ${message.to}`);

  // Validate Expo push token format
  if (
    !message.to.startsWith("ExponentPushToken[") &&
    !message.to.startsWith("ExpoPushToken[")
  ) {
    console.error("[Push] Invalid Expo push token format:", message.to);
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

    const result = await response.json() as { data: ExpoPushTicket };

    if (result?.data?.status === "error") {
      console.error("[Push] Expo push error:", result.data.message, result.data.details);
    } else {
      console.log("[Push] Notification sent successfully. Ticket id:", result?.data?.id);
    }
  } catch (error) {
    console.error("[Push] Failed to call Expo push API:", error);
  }
}

// ─────────────────────────────────────────────
// Socket.io initialization
// ─────────────────────────────────────────────

export const initializeSocket = (httpServer: HttpServer) => {
  const allowedOrigins = [
    "http://localhost:8081", // Expo mobile
    "http://localhost:5173", // Vite web dev
    process.env.FRONTEND_URL, // production
  ].filter(Boolean) as string[];

  const io = new SocketServer(httpServer, { cors: { origin: allowedOrigins } });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error"));

    try {
      const session = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });

      const clerkId = session.sub;
      const user = await User.findOne({ clerkId });
      if (!user) return next(new Error("User not found"));

      socket.data.userId = user._id.toString();
      next();
    } catch (error: any) {
      next(new Error(error));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;

    // Send list of currently online users to the newly connected client
    socket.emit("online-users", { userIds: Array.from(onlineUsers.keys()) });

    // Store user in the onlineUsers map
    onlineUsers.set(userId, socket.id);

    // Notify others that this user is now online
    socket.broadcast.emit("user-online", { userId });

    socket.join(`user:${userId}`);

    socket.on("join-chat", (chatId: string) => {
      socket.join(`chat:${chatId}`);
    });

    socket.on("leave-chat", (chatId: string) => {
      socket.leave(`chat:${chatId}`);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Handle sending messages + push notifications
    // ─────────────────────────────────────────────────────────────────────
    socket.on(
      "send-message",
      async (data: { chatId: string; text: string }) => {
        try {
          const { chatId, text } = data;

          const chat = await Chat.findOne({
            _id: chatId,
            participants: userId,
          });

          if (!chat) {
            socket.emit("socket-error", { message: "Chat not found" });
            return;
          }

          const message = await Message.create({
            chat: chatId,
            sender: userId,
            text,
          });

          chat.lastMessage = message._id;
          chat.lastMessageAt = new Date();
          await chat.save();

          await message.populate("sender", "name avatar");

          // Emit to chat room (users inside the active chat screen)
          io.to(`chat:${chatId}`).emit("new-message", message);

          // Emit to participants' personal rooms (for chat list updates)
          for (const participantId of chat.participants) {
            io.to(`user:${participantId}`).emit("new-message", message);
          }

          // ─────────────────────────────────────────────────────────
          // Push notifications for offline participants
          // ─────────────────────────────────────────────────────────
          const senderUser = await User.findById(userId).select("name");
          const senderName = senderUser?.name ?? "Someone";
          const senderAvatar = (message.sender as any)?.avatar ?? "";

          for (const participantId of chat.participants) {
            const participantIdStr = participantId.toString();

            // Skip the sender
            if (participantIdStr === userId) continue;

            const isOnline = onlineUsers.has(participantIdStr);
            console.log(
              `[Push] Recipient ${participantIdStr} is ${isOnline ? "ONLINE (socket)" : "OFFLINE"}`
            );

            // Send push notification regardless of online status
            // because "online" via socket doesn't mean the chat screen is open
            // The FCM notification will be suppressed by the OS if app is active
            const recipient = await User.findById(participantIdStr).select("fcmToken");

            if (!recipient) {
              console.log(`[Push] Recipient ${participantIdStr} not found in DB.`);
              continue;
            }

            if (!recipient.fcmToken) {
              console.log(
                `[Push] Recipient ${participantIdStr} has no FCM token saved — skipping push.`
              );
              continue;
            }

            console.log(`[Push] Sending push to recipient ${participantIdStr}`);

            await sendExpoPushNotification({
              to: recipient.fcmToken,
              title: senderName,
              body: text.length > 100 ? `${text.slice(0, 100)}…` : text,
              sound: "default",
              priority: "high",
              channelId: "messages",
              data: {
                chatId,
                participantId: userId,   // the sender (from the recipient's point of view)
                name: senderName,
                avatar: senderAvatar,
              },
            });
          }
        } catch (error) {
          console.error("[Socket] send-message error:", error);
          socket.emit("socket-error", { message: "Failed to send message" });
        }
      },
    );

    socket.on("typing", async (data: { chatId: string; isTyping: boolean }) => {
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
            (p: any) => p.toString() !== userId,
          );
          if (otherParticipantId) {
            socket
              .to(`user:${otherParticipantId}`)
              .emit("typing", typingPayload);
          }
        }
      } catch (error) {
        // silently fail — typing indicator is not critical
      }
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(userId);
      socket.broadcast.emit("user-offline", { userId });
    });
  });

  return io;
};
