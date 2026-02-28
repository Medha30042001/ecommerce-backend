import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { listAllOrders, updateOrderStatus } from "../controllers/admin.orders.controller.js";

const router = Router();

router.use(requireAuth, requireRole(["admin"]));

router.get("/", listAllOrders);
router.patch("/:id/status", updateOrderStatus);

export default router;