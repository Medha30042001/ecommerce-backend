import express from "express";
import { resolveReferral, logReferralView } from "../controllers/referrals.controller.js";

const router = express.Router();

router.get("/:code", resolveReferral);
router.post("/:code/view", logReferralView);

export default router;