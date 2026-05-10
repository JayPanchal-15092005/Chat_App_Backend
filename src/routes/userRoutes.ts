import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getUsers } from "../controllers/userController.ts";

const router = Router();

router.get("/", protectRoute, getUsers);

export default router;