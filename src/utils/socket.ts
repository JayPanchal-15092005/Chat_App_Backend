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
}

async function sendExpoPushNotification(message: ExpoPushMessage): Promise<void> {
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

    const result = await response.json() as any;

    if (result?.data?.status === "error") {
      console.error("Expo push notification error:", result.data.message);
    }
  } catch (error) {
    console.error("Failed to send Expo push notification:", error);
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

  // verify socket connection - if the user is authenticated, we will store the user id in the socket

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token; // this is what user will send from client
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

  // this "connection" event name is special and should be written like this
  // it's the event that is triggered when a new client connects to the server

  io.on("connection", (socket) => {
    const userId = socket.data.userId;

    // send list of currently online users to the newly connected client
    socket.emit("online-users", { userIds: Array.from(onlineUsers.keys()) });

    // store user in the onlineUsers map
    onlineUsers.set(userId, socket.id);

    // notify others that this current user is online
    socket.broadcast.emit("user-online", { userId });

    socket.join(`user:${userId}`);

    socket.on("join-chat", (chatId: string) => {
      socket.join(`chat:${chatId}`);
    });

    socket.on("leave-chat", (chatId: string) => {
      socket.leave(`chat:${chatId}`);
    });

    // handle sending messages
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

          // emit to chat room (for users inside the chat)
          io.to(`chat:${chatId}`).emit("new-message", message);

          // also emit to participants' personal rooms (for chat list view)
          for (const participantId of chat.participants) {
            io.to(`user:${participantId}`).emit("new-message", message);
          }

          // ─────────────────────────────────────────
          // Push notification for OFFLINE participants
          // ─────────────────────────────────────────
          const senderUser = await User.findById(userId).select("name");
          const senderName = senderUser?.name ?? "Someone";

          for (const participantId of chat.participants) {
            const participantIdStr = participantId.toString();

            // Skip the sender themselves
            if (participantIdStr === userId) continue;

            // Skip if they are currently online (they already get the socket event)
            if (onlineUsers.has(participantIdStr)) continue;

            // Look up the recipient's FCM/Expo token
            const recipient = await User.findById(participantIdStr).select("fcmToken name");
            if (!recipient?.fcmToken) continue;

            await sendExpoPushNotification({
              to: recipient.fcmToken,
              title: senderName,
              body: text.length > 100 ? `${text.slice(0, 100)}…` : text,
              sound: "default",
              channelId: "messages",
              data: {
                chatId,
                participantId: userId,           // the sender (from recipient's perspective)
                name: senderName,
                avatar: (message.sender as any)?.avatar ?? "",
              },
            });
          }
        } catch (error) {
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

      // emit to chat room (for users inside the chat)
      socket.to(`chat:${data.chatId}`).emit("typing", typingPayload);

      // also emit to other participant's personal room (for chat list view)
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
        // silently fail - typing indicator is not critical
      }
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(userId);

      // notify others
      socket.broadcast.emit("user-offline", { userId });
    });
  });

  return io;
};
