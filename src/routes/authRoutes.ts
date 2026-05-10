import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { authCallback, getMe } from "../controllers/authController.ts";

const router = Router();

router.get("/me", protectRoute, getMe);
router.post("/callback", authCallback);

export default router;