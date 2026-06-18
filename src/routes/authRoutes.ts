import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getMe, loginUser, registerUser, updateProfile } from "../controllers/authController.ts";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", protectRoute, getMe);
router.patch("/profile", protectRoute, updateProfile);

// For backwards compatibility if any frontend still hits it during transition
router.post("/callback", (req, res) => {
  res.status(400).json({ message: "Firebase auth is no longer supported. Use /login or /register." });
});

export default router;