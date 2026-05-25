import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getMessages, editMessage, deleteMessage } from "../controllers/messageController.ts";

const router = Router();

router.get("/chat/:chatId", protectRoute, getMessages);
router.patch("/:messageId", protectRoute, editMessage);
router.delete("/:messageId", protectRoute, deleteMessage);

export default router;