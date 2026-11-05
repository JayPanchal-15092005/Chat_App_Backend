import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import {
  getChats,
  getOrCreateChat,
  togglePinChat,
  createGroupChat,
  addGroupMembers,
  leaveGroupChat,
  getChatDetails,
} from "../controllers/chatController.ts";

const router = Router();

router.use(protectRoute);

router.get("/", getChats);
router.get("/:chatId", getChatDetails);
router.post("/group", createGroupChat);
router.patch("/:chatId/members", addGroupMembers);
router.patch("/:chatId/leave", leaveGroupChat);
router.post("/with/:participantId", getOrCreateChat);
router.patch("/:chatId/pin", togglePinChat);

export default router;