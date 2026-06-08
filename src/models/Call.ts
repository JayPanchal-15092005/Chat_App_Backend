import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ICall extends Document {
  caller: Types.ObjectId;
  receiver: Types.ObjectId;
  type: "audio" | "video";
  status: "missed" | "rejected" | "answered" | "ongoing";
  offer?: any;
  startTime?: Date;
  endTime?: Date;
  duration: number;
  createdAt: Date;
  updatedAt: Date;
}

const CallSchema = new Schema<ICall>(
  {
    caller: { type: Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["audio", "video"], default: "audio" },
    status: {
      type: String,
      enum: ["missed", "rejected", "answered", "ongoing"],
      default: "ongoing",
    },
    offer: { type: Schema.Types.Mixed, default: null },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    duration: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Call = mongoose.model<ICall>("Call", CallSchema);
