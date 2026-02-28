import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { upsertReview, getMyReviews } from "../controllers/reviews.controller.js";

const router = Router();

// customer-only
router.use(requireAuth, requireRole(["customer"]));

router.get("/my", getMyReviews);
router.post("/", upsertReview);

export default router;