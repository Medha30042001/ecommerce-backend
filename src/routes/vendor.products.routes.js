import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import upload from "../middleware/upload.js";
import {
  createVendorProduct,
  listVendorProducts,
  getVendorProductById,
  updateVendorProduct,
  deleteVendorProduct,
} from "../controllers/vendor.products.controller.js";

const router = Router();

router.use(requireAuth, requireRole(["vendor", "admin"]));

router.get("/", listVendorProducts);

router.get("/:id", getVendorProductById);

// ✅ Multer must run for multipart/form-data
router.post("/", upload.single("image"), createVendorProduct);

// ✅ optional: allow updating image too
router.patch("/:id", upload.single("image"), updateVendorProduct);

router.delete("/:id", deleteVendorProduct);

export default router;