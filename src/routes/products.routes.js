import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { listProducts, getProductById } from "../controllers/products.controller.js";

const router = Router();

// ✅ Admin-only
router.use(requireAuth, requireRole(["admin"]));

router.get("/", listProducts);
router.get("/:id", getProductById);

export default router;