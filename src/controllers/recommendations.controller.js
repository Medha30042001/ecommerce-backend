import { supabase } from "../config/supabase.js";

/**
 * GET /api/recommendations/also-bought/:productId
 */
export async function alsoBought(req, res) {
  try {
    const { productId } = req.params;

    // Step 1: Find all orders containing this product
    const { data: ordersWithProduct, error: orderErr } = await supabase
      .from("order_items")
      .select("order_id")
      .eq("product_id", productId);

    if (orderErr)
      return res.status(400).json({ message: "Failed to fetch orders", error: orderErr });

    const orderIds = ordersWithProduct.map((o) => o.order_id);

    if (orderIds.length === 0)
      return res.json({ results: [] });

    // Step 2: Get other products in those same orders
    const { data: relatedItems, error: relErr } = await supabase
      .from("order_items")
      .select(`
        product_id,
        products!inner(id, name, price, category_id)
      `)
      .in("order_id", orderIds)
      .neq("product_id", productId);

    if (relErr)
      return res.status(400).json({ message: "Failed to fetch related items", error: relErr });

    // Step 3: Count frequency
    const frequency = {};

    for (const item of relatedItems) {
      const pid = item.product_id;
      if (!frequency[pid]) {
        frequency[pid] = {
          ...item.products,
          count: 0,
        };
      }
      frequency[pid].count++;
    }

    const sorted = Object.values(frequency)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return res.json({ results: sorted });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

/**
 * GET /api/recommendations/trending
 */
export async function trendingProducts(req, res) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data, error } = await supabase
      .from("order_items")
      .select(`
        product_id,
        quantity,
        orders!inner(created_at),
        products!inner(id, name, price, category_id)
      `)
      .gte("orders.created_at", since.toISOString());

    if (error)
      return res.status(400).json({ message: "Failed to fetch trending data", error });

    const scores = {};

    for (const item of data) {
      const pid = item.product_id;
      if (!scores[pid]) {
        scores[pid] = {
          ...item.products,
          score: 0,
        };
      }
      scores[pid].score += item.quantity;
    }

    const trending = Object.values(scores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return res.json({ results: trending });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

/**
 * GET /api/recommendations/personalized
 */
export async function personalized(req, res) {
  try {
    const customerId = req.user?.id;
    if (!customerId)
      return res.status(401).json({ message: "Login required" });

    // Step 1: Get customer's past purchases
    const { data: purchases } = await supabase
      .from("order_items")
      .select(`
        products!inner(category_id),
        orders!inner(customer_id)
      `)
      .eq("orders.customer_id", customerId);

    if (!purchases || purchases.length === 0)
      return res.json({ results: [] });

    // Count category frequency
    const categoryCount = {};
    for (const p of purchases) {
      const cat = p.products.category_id;
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }

    const topCategories = Object.keys(categoryCount)
      .sort((a, b) => categoryCount[b] - categoryCount[a])
      .slice(0, 3);

    // Step 2: Fetch popular products from those categories
    const { data: products } = await supabase
      .from("products")
      .select("id, name, price, category_id")
      .in("category_id", topCategories)
      .eq("is_active", true)
      .limit(10);

    return res.json({ results: products });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}