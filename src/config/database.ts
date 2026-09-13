import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    // const mongoUri = process.env.CLOUD_MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI environment variable is not defined");
    }
    await mongoose.connect(mongoUri);
    console.log("✅ MongoDB connected successfully");

    // Drop the unique clerkId index to prevent E11000 duplicate key errors on signup
    try {
      await mongoose.connection.collection("users").dropIndex("clerkId_1");
      console.log("Successfully dropped clerkId_1 index");
    } catch (error: any) {
      if (error.code !== 27) {
        console.error("Note: clerkId_1 index could not be dropped", error.message);
      }
    }
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1); // exit with failure
    // status code 1 means failure
    // status code 0 means success
  }
};