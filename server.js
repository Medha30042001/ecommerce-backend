import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import productsRoutes from "./src/routes/products.routes.js";
import vendorProductsRoutes from "./src/routes/vendor.products.routes.js";
import cartRoutes from "./src/routes/cart.routes.js";
import wishlistRoutes from "./src/routes/wishlist.routes.js";
import checkoutRoutes from "./src/routes/checkout.routes.js";
import customerOrdersRoutes from "./src/routes/customer.orders.routes.js";
import vendorOrderRoutes from "./src/routes/vendor.orders.routes.js";
import publicProductRoutes from "./src/routes/public.products.routes.js";
import vendorDashboardRoutes from "./src/routes/vendor.dashboard.routes.js";
import vendorReferralRoutes from "./src/routes/vendor.referrals.routes.js";
import publicReferralRoutes from "./src/routes/public.referrals.routes.js";
import recommendationRoutes from "./src/routes/recommendations.routes.js";
import authRoutes from "./src/routes/auth.routes.js";
import adminOrdersRoutes from "./src/routes/admin.orders.routes.js";
import adminUsersRoutes from "./src/routes/admin.users.routes.js";
import adminDashboardRoutes from "./src/routes/admin.dashboard.routes.js";
import reviewsRoutes from "./src/routes/reviews.routes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/admin/products", productsRoutes);
app.use("/api/vendor/products", vendorProductsRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/customer/orders", customerOrdersRoutes);
app.use("/api/vendor/orders", vendorOrderRoutes);
app.use("/api/products", publicProductRoutes);
app.use("/api/vendor/dashboard", vendorDashboardRoutes);
app.use("/api/vendor/referrals", vendorReferralRoutes);
app.use("/api/referrals", publicReferralRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin/orders", adminOrdersRoutes);
app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/api/reviews", reviewsRoutes);

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));

