import express from "express";
import cors from "cors";
import path from "path";

import authRoutes from "./routes/authRoutes.ts";
import chatRoutes from "./routes/chatRoutes.ts";
import messageRoutes from "./routes/messageRoutes.ts";
import userRoutes from "./routes/userRoutes.ts";
import uploadRoutes from "./routes/uploadRoutes.ts";
import turnRoutes from "./routes/turnRoutes.ts";
import callRoutes from "./routes/callRoutes.ts";
import { errorHandler } from "./middleware/errorHandler.ts";

const app = express();

app.use(express.json()); // parses incoming JSON request bodies and makes them available as req.body in your route handlers

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o.replace(/\/$/, "")))) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));


app.get("/health", (req, res) => {
    res.json({ status: "OK", message: "server is up and running there is no issues in the server" });
});

app.use("/api/auth", authRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/users", userRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/turn", turnRoutes);
app.use("/api/calls", callRoutes);

// error handlers must come after all the routes and other middlewares so they can catch errors passed with next(err) or thrown inside async handlers.
app.use(errorHandler);

export default app;