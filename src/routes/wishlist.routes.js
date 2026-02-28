import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getWishlist,
  addWishlistItem,
  removeWishlistItem,
} from "../controllers/wishlist.controller.js";

const router = Router();
router.use(requireAuth, requireRole(["customer"]));

router.get("/", getWishlist);
router.post("/items", addWishlistItem);
router.delete("/items/:productId", removeWishlistItem);

export default router;