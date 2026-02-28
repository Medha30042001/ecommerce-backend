import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { checkout } from "../controllers/checkout.controller.js";

const router = Router();
router.use(requireAuth, requireRole(["customer"]));

router.post("/", checkout);

export default router;