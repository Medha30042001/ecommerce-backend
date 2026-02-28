import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getCustomerOrders,
  getCustomerOrderById,
} from "../controllers/customer.orders.controller.js";
import { downloadInvoice } from "../controllers/customer.orders.controller.js";

const router = Router();
router.use(requireAuth, requireRole(["customer"]));

router.get("/", getCustomerOrders);
router.get("/:id", getCustomerOrderById);
router.get("/:id/invoice", downloadInvoice);

export default router;