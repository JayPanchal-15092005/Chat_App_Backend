import mongoose, { Schema, type Document } from "mongoose";

export interface IUser extends Document {
  clerkId: string;
  name: string;
  email: string;
  avatar: string;
  expoPushToken?: string;
  fcmToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  clerkId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  avatar: {
    type: String,
    default: "",
  },
  expoPushToken: {
    type: String,
    default: null,
  },
  fcmToken: {
    type: String,
    default: null,
  },
}, { timestamps: true });

export const User = mongoose.model("User", UserSchema);
