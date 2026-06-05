import { Router } from "express";
import { protectRoute } from "../middleware/auth.ts";
import { getCallHistory } from "../controllers/callController.ts";

const router = Router();

router.use(protectRoute);

router.get("/", getCallHistory);

export default router;
