import express from "express";
import cors from "cors";
import path from "path";
import { clerkMiddleware } from "@clerk/express";

import authRoutes from "./routes/authRoutes.ts";
import chatRoutes from "./routes/chatRoutes.ts";
import messageRoutes from "./routes/messageRoutes.ts";
import userRoutes from "./routes/userRoutes.ts";
import { errorHandler } from "./middleware/errorHandler.ts";

const app = express();

app.use(express.json()); // parses incoming JSON request bodies and makes them available as req.body in your route handlers

app.use(cors({
  origin: process.env.CLIENT_URL || "https://your-vercel-frontend-url.vercel.app", // We will put your Vercel URL in your Render environment variables
  credentials: true 
}));

app.use(clerkMiddleware());

app.get("/health", (req, res) => {
    res.json({ status: "OK", message: "server is up and running there is no issues in the server" });
});

app.use("/api/auth", authRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/users", userRoutes);

// error handlers must come after all the routes and other middlewares so they can catch errors passed with next(err) or thrown inside async handlers.
app.use(errorHandler);

export default app;