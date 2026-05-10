import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getChats, getOrCreateChat } from "../controllers/chatController.ts";

const router = Router();

router.use(protectRoute);

router.get("/", getChats);
router.post("/with/:participantId", getOrCreateChat);

export default router;