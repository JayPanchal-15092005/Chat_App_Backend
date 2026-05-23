import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getUsers, updateFcmToken } from "../controllers/userController.ts";

const router = Router();

router.get("/", protectRoute, getUsers);
router.patch("/fcm-token", protectRoute, updateFcmToken);

export default router;