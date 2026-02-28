import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { listUsers, updateUserRole } from "../controllers/admin.users.controller.js";

const router = Router();

router.use(requireAuth, requireRole(["admin"]));

router.get("/", listUsers);
router.patch("/:id/role", updateUserRole);

export default router;