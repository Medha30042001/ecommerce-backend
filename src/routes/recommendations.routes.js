import express from "express";
import {
  alsoBought,
  trendingProducts,
  personalized,
} from "../controllers/recommendations.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/also-bought/:productId", alsoBought);
router.get("/trending", trendingProducts);
router.get("/personalized", requireAuth, personalized);

export default router;