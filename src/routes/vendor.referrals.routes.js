import express from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createReferralLink,
  vendorReferralAnalytics,
} from "../controllers/referrals.controller.js";
import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

router.use(requireAuth, requireRole(["vendor", "admin"]))

router.post("/links", createReferralLink);
router.get("/analytics", vendorReferralAnalytics);

export default router;