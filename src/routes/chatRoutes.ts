import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getChats, getOrCreateChat, togglePinChat } from "../controllers/chatController.ts";

const router = Router();

router.use(protectRoute);

router.get("/", getChats);
router.post("/with/:participantId", getOrCreateChat);
router.patch("/:chatId/pin", togglePinChat);

export default router;