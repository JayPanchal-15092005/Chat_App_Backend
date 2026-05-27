import mongoose, { Schema, type Document } from "mongoose";

export interface IReaction {
  userId: mongoose.Types.ObjectId;
  emoji: string;
}

export interface IMessage extends Document {
  chat: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  text: string;
  type: "text" | "image" | "voice";
  mediaUrl?: string;
  status: "sent" | "delivered" | "seen";
  replyTo?: mongoose.Types.ObjectId;
  reactions: IReaction[];
  isEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReactionSchema = new Schema<IReaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    emoji: { type: String, required: true },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessage>(
  {
    chat: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["text", "image", "voice"],
      default: "text",
    },
    mediaUrl: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    reactions: {
      type: [ReactionSchema],
      default: [],
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// indexes for faster queries
MessageSchema.index({ chat: 1, createdAt: 1 });

export const Message = mongoose.model("Message", MessageSchema);