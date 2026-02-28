import express from "express";
import { listVendorOrders, updateOrderStatus } from "../controllers/vendor.orders.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

router.use(requireAuth, requireRole(["vendor", "admin"]))

router.get("/", listVendorOrders);
router.patch("/:id/status", updateOrderStatus);

export default router;