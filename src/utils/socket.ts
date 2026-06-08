import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import { verifyToken } from "@clerk/express";
import { Message } from "../models/Message.ts";
import { Chat } from "../models/Chat.ts";
import { User } from "../models/User.ts";
import { Call } from "../models/Call.ts";
import { admin } from "./firebase.ts";

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
  categoryId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
}

async function sendExpoPushNotification(
  message: ExpoPushMessage,
): Promise<void> {
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
    console.log("=================================");
    console.log("USER CONNECTED");
    console.log("User ID:", socket.data.userId);
    console.log("Socket ID:", socket.id);
    console.log("=================================");
    const userId = socket.data.userId;

    socket.emit("online-users", { userIds: Array.from(onlineUsers.keys()) });
    onlineUsers.set(userId, socket.id);
    socket.broadcast.emit("user-online", { userId });
    socket.join(`user:${userId}`);
    console.log(`JOINED ROOM => user:${userId}`);

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
        const updated = await Message.find({
          chat: chatId,
          sender: { $ne: userId },
          status: "sent",
        }).select("sender");

        if (updated.length > 0) {
          await Message.updateMany(
            { chat: chatId, sender: { $ne: userId }, status: "sent" },
            { $set: { status: "delivered" } },
          );

          const payload = { chatId, status: "delivered", updatedBy: userId };

          // Notify everyone in the chat room
          socket.to(`chat:${chatId}`).emit("message-status-update", payload);

          // Also notify each sender via their personal room (works even when not in chat)
          const senderIds = [
            ...new Set(updated.map((m) => m.sender.toString())),
          ];
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
            {
              chat: chatId,
              sender: { $ne: userId },
              status: { $in: ["sent", "delivered"] },
            },
            { $set: { status: "seen" } },
          );

          const payload = { chatId, status: "seen", updatedBy: userId };

          // Notify everyone in the chat room
          socket.to(`chat:${chatId}`).emit("message-status-update", payload);

          // Also notify each original sender via their personal room
          const senderIds = [
            ...new Set(updated.map((m) => m.sender.toString())),
          ];
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
      async (data: {
        chatId: string;
        text: string;
        replyToId?: string;
        type?: "text" | "image" | "voice";
        mediaUrl?: string;
      }) => {
        try {
          const { chatId, text, replyToId, type = "text", mediaUrl } = data;

          const chat = await Chat.findOne({
            _id: chatId,
            participants: userId,
          });
          if (!chat) {
            socket.emit("socket-error", { message: "Chat not found" });
            return;
          }

          // FIX 1: Use `undefined` instead of `null` so Mongoose overloads resolve correctly.
          // Passing `null` causes TypeScript to fail matching any overload → `never` type on `message`.
          const message = (await Message.create({
            chat: chatId,
            sender: userId,
            text,
            type,
            mediaUrl: mediaUrl ?? undefined, // ← was: mediaUrl || null
            replyTo: replyToId ?? undefined, // ← was: replyToId || null
            status: "sent",
            // FIX 2: Cast to `any` so downstream `.populate()` and property access don't error
            // on the `never` type that Mongoose infers when overloads can't be resolved.
          })) as any;

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

            const recipient = await User.findById(pidStr).select("expoPushToken");
            if (!recipient?.expoPushToken) continue;

            await sendExpoPushNotification({
              to: recipient.expoPushToken,
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
      },
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
          const message = await Message.findOne({
            _id: messageId,
            chat: chatId,
          });
          if (!message) return;

          const existingIdx = message.reactions.findIndex(
            (r) => r.userId.toString() === userId,
          );

          // AFTER — store in variable so TypeScript knows it's defined
          if (existingIdx !== -1) {
            const existingReaction = message.reactions[existingIdx];
            if (existingReaction) {
              if (existingReaction.emoji === emoji) {
                // Toggle off same emoji
                message.reactions.splice(existingIdx, 1);
              } else {
                // Replace with new emoji
                existingReaction.emoji = emoji;
              }
            }
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
      },
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
          const message = await Message.findOne({
            _id: messageId,
            chat: chatId,
          });
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
      },
    );

    // ── Delete message ────────────────────────────────────────────────
    socket.on(
      "delete-message",
      async ({ messageId, chatId }: { messageId: string; chatId: string }) => {
        try {
          const message = await Message.findOne({
            _id: messageId,
            chat: chatId,
          });
          if (!message) return;
          if (message.sender.toString() !== userId) return;

          await message.deleteOne();

          io.to(`chat:${chatId}`).emit("message-deleted", {
            messageId,
            chatId,
          });
        } catch (error) {
          console.error("[Socket] delete-message error:", error);
        }
      },
    );

    // ── Typing indicator ──────────────────────────────────────────────
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
          // FIX 3: Use optional chaining on `chat.participants` because TypeScript
          // considers it possibly undefined even inside the `if (chat)` block,
          // depending on how the Chat model schema is typed.
          const otherParticipantId = chat.participants?.find(
            (p: any) => p.toString() !== userId,
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
    });

    // ── Fetch Ongoing Call (for Killed State Wakeup) ──────────────────
    socket.on("fetch-ongoing-call", async () => {
      try {
        const ongoingCall = await Call.findOne({
          receiver: userId,
          status: "ongoing",
        }).populate("caller", "name avatar");

        if (ongoingCall) {
          const caller: any = ongoingCall.caller;
          socket.emit("incoming-call", {
            callerId: caller._id.toString(),
            callerName: caller.name,
            callerAvatar: caller.avatar,
            offer: ongoingCall.offer,
            callType: ongoingCall.type,
            callId: ongoingCall._id.toString(),
          });
          console.log(`[Socket] Delivered ongoing call offer to woke-up receiver ${userId}`);
        }
      } catch (error) {
        console.error("[Socket] fetch-ongoing-call error:", error);
      }
    });

    // ── WebRTC Calling Signaling ──────────────────────────────────────
    socket.on("call-offer", async (data: {
      targetUserId: string;
      offer: any;
      callType: string;
      callerName?: string;
      callerAvatar?: string;
    }) => {
      try {
        const { targetUserId, offer, callType } = data;

        // Query real caller info from DB instead of trusting frontend
        const callerUser = await User.findById(userId);
        const callerName = callerUser?.name || "Unknown";
        const callerAvatar = callerUser?.avatar || "";

        console.log("=================================");
        console.log("CALL OFFER RECEIVED");
        console.log("From:", userId, "(", callerName, ")");
        console.log("To:", targetUserId);
        console.log("Call Type:", callType);
        console.log("Target Online:", onlineUsers.has(targetUserId));
        console.log("=================================");

        // Create call record in DB
        const call = await Call.create({
          caller: userId,
          receiver: targetUserId,
          type: callType === "video" ? "video" : "audio",
          status: "ongoing",
          offer,
        });

        // Track active call on this socket
        socket.data.activeCallId = call._id;

        // Emit incoming-call to the receiver
        io.to(`user:${targetUserId}`).emit("incoming-call", {
          callerId: userId,
          callerName,
          callerAvatar,
          offer,
          callType,
          callId: call._id.toString(),
        });

        // ALWAYS send call push notification regardless of online status.
        // A backgrounded/locked device may still appear "online" via socket
        // but won't see the in-app modal. The push is the fallback delivery.
        try {
          const recipient = await User.findById(targetUserId).select("fcmToken expoPushToken");
          
          let validFcmToken = recipient?.fcmToken;
          
          // CRITICAL: Clean up migration issues where old Expo tokens are stored in the fcmToken field.
          if (validFcmToken && (validFcmToken.startsWith("ExponentPushToken") || validFcmToken.startsWith("ExpoPushToken"))) {
            console.warn(`[Socket] INVALID FCM TOKEN DETECTED for user ${targetUserId}: ${validFcmToken}. Skipping FCM send.`);
            validFcmToken = undefined;
            
            // Auto-migrate it to expoPushToken if it's missing
            if (!recipient?.expoPushToken) {
              await User.findByIdAndUpdate(targetUserId, { expoPushToken: validFcmToken, fcmToken: null });
            } else {
              await User.findByIdAndUpdate(targetUserId, { fcmToken: null });
            }
          }

          if (validFcmToken) {
            await admin.messaging().send({
              token: validFcmToken,
              android: {
                priority: "high"
              },
              apns: {
                headers: {
                  "apns-priority": "10",
                  "apns-push-type": "background"
                },
                payload: {
                  aps: {
                    contentAvailable: true
                  }
                }
              },
              data: {
                type: "incoming-call",
                callerId: userId,
                callerName,
                callerAvatar,
                callType,
                callId: call._id.toString(),
              },
            });
            console.log(`[Socket] FCM VoIP push sent to ${targetUserId}`);
          } else {
            console.warn(`[Socket] Cannot send FCM VoIP push to ${targetUserId}: No valid FCM token found.`);
          }
        } catch (e) {
          console.error("[Socket] Failed to send FCM for call-offer", e);
        }
      } catch (error) {
        console.error("[Socket] call-offer error:", error);
      }
    });

    socket.on("call-answer", async ({ targetUserId, answer, callId: clientCallId }: {
      targetUserId: string;
      answer: any;
      callId?: string;
    }) => {
      try {
        console.log("================================");
        console.log("CALL ANSWER RECEIVED");
        console.log("Receiver:", userId, "→ Caller:", targetUserId);
        console.log("================================");

        // Update call record to answered with startTime
        const activeCallId = socket.data.activeCallId;
        let resolvedCallId = activeCallId;

        if (activeCallId) {
          await Call.findByIdAndUpdate(activeCallId, {
            status: "answered",
            startTime: new Date(),
          });
        } else {
          // Find the ongoing call where this user is the receiver
          const call = await Call.findOneAndUpdate(
            { receiver: userId, caller: targetUserId, status: "ongoing" },
            { status: "answered", startTime: new Date() },
            { sort: { createdAt: -1 }, new: true }
          );
          if (call) {
            resolvedCallId = call._id;
            socket.data.activeCallId = call._id;
          }
        }

        // Forward the SDP answer to the caller
        io.to(`user:${targetUserId}`).emit("call-answer-forwarded", { answer });

        // Emit call-connected to both sides as a redundant confirmation signal.
        // The mobile callStore uses this as a fallback if the SDP transition
        // doesn't trigger a state change (e.g. slow ICE negotiation).
        const connectedPayload = { callId: resolvedCallId?.toString() };
        io.to(`user:${targetUserId}`).emit("call-connected", connectedPayload);
        io.to(`user:${userId}`).emit("call-connected", connectedPayload);

        console.log("[Socket] call-answer forwarded + call-connected emitted for call:", resolvedCallId);
      } catch (error) {
        console.error("[Socket] call-answer error:", error);
      }
    });

    socket.on("call-reject", async ({ targetUserId }: {
      targetUserId: string;
    }) => {
      try {
        console.log("CALL REJECTED by", userId, "notifying", targetUserId);

        // Update call record to rejected
        const activeCallId = socket.data.activeCallId;
        if (activeCallId) {
          await Call.findByIdAndUpdate(activeCallId, {
            status: "rejected",
            endTime: new Date(),
          });
          socket.data.activeCallId = null;
        } else {
          // Find the ongoing call where this user is the receiver
          await Call.findOneAndUpdate(
            { receiver: userId, caller: targetUserId, status: "ongoing" },
            { status: "rejected", endTime: new Date() },
            { sort: { createdAt: -1 } }
          );
        }

        io.to(`user:${targetUserId}`).emit("call-rejected");
      } catch (error) {
        console.error("[Socket] call-reject error:", error);
      }
    });

    socket.on("ice-candidate", ({ targetUserId, candidate }: {
      targetUserId: string;
      candidate: any;
    }) => {
      console.log("ICE CANDIDATE");
      console.log("From:", userId);
      console.log("To:", targetUserId);

      io.to(`user:${targetUserId}`).emit("ice-candidate-forwarded", {
        candidate,
      });
    });

    socket.on("call-end", async ({ targetUserId }: { targetUserId: string }) => {
      try {
        console.log("CALL ENDED by", userId, "notifying", targetUserId);

        // Find and update the call record
        const activeCallId = socket.data.activeCallId;
        if (activeCallId) {
          const call = await Call.findById(activeCallId);
          if (call) {
            const endTime = new Date();
            let duration = 0;
            let status = call.status;

            if (call.status === "ongoing") {
              // Never answered — mark as missed
              status = "missed";
            } else if (call.status === "answered" && call.startTime) {
              // Was answered — calculate duration
              duration = Math.round(
                (endTime.getTime() - call.startTime.getTime()) / 1000
              );
            }

            await Call.findByIdAndUpdate(activeCallId, {
              status,
              endTime,
              duration,
            });
          }
          socket.data.activeCallId = null;
        }

        io.to(`user:${targetUserId}`).emit("call-ended");
      } catch (error) {
        console.error("[Socket] call-end error:", error);
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      console.log("USER DISCONNECTED:", userId);

      // Clean up active call on disconnect
      if (socket.data.activeCallId) {
        try {
          const call = await Call.findById(socket.data.activeCallId);
          if (call && (call.status === "ongoing" || call.status === "answered")) {
            const endTime = new Date();
            let duration = 0;
            let status: string = call.status;

            if (call.status === "ongoing") {
              status = "missed";
            } else if (call.status === "answered" && call.startTime) {
              duration = Math.round(
                (endTime.getTime() - call.startTime.getTime()) / 1000
              );
            }

            await Call.findByIdAndUpdate(socket.data.activeCallId, {
              status,
              endTime,
              duration,
            });

            // Notify the other party
            const otherUserId =
              call.caller.toString() === userId
                ? call.receiver.toString()
                : call.caller.toString();
            io.to(`user:${otherUserId}`).emit("call-ended");
          }
          socket.data.activeCallId = null;
        } catch (error) {
          console.error("[Socket] disconnect call cleanup error:", error);
        }
      }

      onlineUsers.delete(userId);
      socket.broadcast.emit("user-offline", { userId });
    });
  });

  return io;
};
