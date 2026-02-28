import express from "express";
import { getLowStockProducts, getVendorAnalytics } from "../controllers/vendor.dashboard.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

router.use(requireAuth, requireRole(["vendor", "admin"]))

router.get("/low-stock", getLowStockProducts);
router.get("/analytics", getVendorAnalytics);

export default router;