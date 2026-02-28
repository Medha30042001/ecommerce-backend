import { supabase } from "../config/supabase.js";

function clampRating(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

// GET /api/reviews/my?productIds=uuid,uuid,uuid
export async function getMyReviews(req, res) {
  try {
    const customerId = req.user.id;
    const productIdsRaw = String(req.query.productIds || "").trim();

    if (!productIdsRaw) return res.json({ results: [] });

    const productIds = productIdsRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (!productIds.length) return res.json({ results: [] });

    const { data, error } = await supabase
      .from("reviews")
      .select("product_id, rating, comment, created_at")
      .eq("customer_id", customerId)
      .in("product_id", productIds);

    if (error) return res.status(400).json({ message: "Failed to fetch reviews", error });

    const shaped = (data || []).map((r) => ({
      productId: r.product_id,
      rating: r.rating,
      comment: r.comment || "",
      createdAt: r.created_at,
    }));

    return res.json({ results: shaped });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

// POST /api/reviews
// body: { productId, rating, comment }
export async function upsertReview(req, res) {
  try {
    const customerId = req.user.id;
    const { productId, rating, comment = "" } = req.body || {};

    if (!productId) return res.status(400).json({ message: "productId is required" });

    const r = clampRating(rating);
    if (!r) return res.status(400).json({ message: "rating must be 1-5" });

    // ✅ Delivered-only rule:
    // Verify the customer has a DELIVERED order containing this product
    const { data: deliveredOrders, error: orderErr } = await supabase
      .from("orders")
      .select(
        `
        id,
        status,
        order_items ( product_id )
      `
      )
      .eq("customer_id", customerId)
      .eq("status", "delivered");

    if (orderErr) return res.status(400).json({ message: "Failed to verify purchase", error: orderErr });

    const purchased = (deliveredOrders || []).some((o) =>
      (o.order_items || []).some((it) => it.product_id === productId)
    );

    if (!purchased) {
      return res.status(403).json({
        message: "You can review only products from delivered orders.",
      });
    }

    // Upsert (your schema has unique(product_id, customer_id))
    const payload = {
      product_id: productId,
      customer_id: customerId,
      rating: r,
      comment: String(comment || "").trim(),
    };

    const { data, error } = await supabase
      .from("reviews")
      .upsert(payload, { onConflict: "product_id,customer_id" })
      .select("product_id, rating, comment, created_at")
      .single();

    if (error) return res.status(400).json({ message: "Failed to save review", error });

    return res.json({
      message: "Review saved",
      review: {
        productId: data.product_id,
        rating: data.rating,
        comment: data.comment || "",
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}