import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getUsers, updatePushTokens } from "../controllers/userController.ts";

const router = Router();

router.get("/", protectRoute, getUsers);
router.patch("/push-tokens", protectRoute, updatePushTokens);
router.patch("/fcm-token", protectRoute, updatePushTokens); // Keep for backwards compatibility

export default router;