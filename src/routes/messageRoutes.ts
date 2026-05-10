import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getMessages } from "../controllers/messageController.ts";

const router = Router();

router.get("/chat/:chatId", protectRoute, getMessages);

export default router;