import express from "express";
import { listProducts, getProductById } from "../controllers/public.products.controller.js";

const router = express.Router();

router.get("/", listProducts);
router.get("/:id", getProductById);

export default router;