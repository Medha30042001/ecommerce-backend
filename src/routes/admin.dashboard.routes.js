import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { getAdminDashboard } from "../controllers/admin.dashboard.controller.js";

const router = Router();

router.use(requireAuth, requireRole(["admin"]));

// GET /api/admin/dashboard
router.get("/", getAdminDashboard);

export default router;