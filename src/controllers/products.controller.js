import { supabase } from "../config/supabase.js";

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function listProducts(req, res) {
  try {
    const {
      category = "",
      search = "",
      minPrice,
      maxPrice,
      minRating,
      sort = "featured",
      page = "1",
      limit = "12",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 12));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from("products")
      .select(
        `
        id,
        name,
        description,
        price,
        original_price,
        category_id,
        vendor_id,
        is_active,
        is_featured,
        created_at,
        image_url,
        vendors:vendor_id ( id, store_name ),
        inventory:inventory!inventory_product_id_fkey ( stock_quantity )
      `,
        { count: "exact" }
      );
      //.eq("is_active", true);

      // Admin can optionally filter activeOnly=true
      const activeOnly = String(req.query.activeOnly || "false") === "true";
      if (activeOnly) query = query.eq("is_active", true);

    // Filters
    if (category) query = query.eq("category_id", category);
    if (search) query = query.ilike("name", `%${search}%`);

    const minP = minPrice !== undefined ? toNumber(minPrice, null) : null;
    const maxP = maxPrice !== undefined ? toNumber(maxPrice, null) : null;

    if (minP !== null) query = query.gte("price", minP);
    if (maxP !== null) query = query.lte("price", maxP);

    // Sorting
    if (sort === "price-low") query = query.order("price", { ascending: true });
    else if (sort === "price-high") query = query.order("price", { ascending: false });
    else if (sort === "newest") query = query.order("created_at", { ascending: false });
    else if (sort === "featured") {
      query = query.order("is_featured", { ascending: false }).order("created_at", { ascending: false });
    } else {
      // default fallback
      query = query.order("created_at", { ascending: false });
    }

    // Pagination
    query = query.range(from, to);

    const { data: products, count, error } = await query;
    if (error) return res.status(400).json({ message: "Query failed", error });

    // Compute rating + reviewsCount efficiently:
    // Step 1: collect product ids
    const productIds = (products || []).map((p) => p.id);
    let ratingMap = {};
    if (productIds.length) {
      // Fetch aggregated rating & count via RPC-like approach:
      // We'll do it with a simple query and aggregate in JS (fine for one page of results).
      const { data: reviews, error: revErr } = await supabase
        .from("reviews")
        .select("product_id, rating")
        .in("product_id", productIds);

      if (!revErr && reviews) {
        const agg = {};
        for (const r of reviews) {
          if (!agg[r.product_id]) agg[r.product_id] = { sum: 0, count: 0 };
          agg[r.product_id].sum += r.rating;
          agg[r.product_id].count += 1;
        }
        for (const [pid, a] of Object.entries(agg)) {
          ratingMap[pid] = {
            rating: a.count ? Math.round((a.sum / a.count) * 10) / 10 : 0,
            reviewsCount: a.count,
          };
        }
      }
    }

    const minR = minRating !== undefined ? toNumber(minRating, 0) : 0;

    // Shape response like your frontend wants
    const shaped = (products || [])
      .map((p) => {//
        const stockQty =
          (Array.isArray(p.inventory)
            ? p.inventory?.[0]?.stock_quantity
            : p.inventory?.stock_quantity) ?? 0;
        const stats = ratingMap[p.id] || { rating: 0, reviewsCount: 0 };

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          originalPrice: p.original_price !== null ? Number(p.original_price) : null,
          category: p.category_id,
          vendorId: p.vendor_id,
          vendorName: p.vendors?.store_name || "",
          isActive: p.is_active,
          isFeatured: p.is_featured,
          imageUrl: p.image_url || null,     // ✅ ADD THIS
          inStock: stockQty > 0,
          stockQuantity: stockQty,
          rating: stats.rating,
          reviewsCount: stats.reviewsCount,
          createdAt: p.created_at,
        };
      })
      .filter((p) => p.rating >= minR);

    // If sort === rating, do it after rating is computed
    if (sort === "rating") shaped.sort((a, b) => b.rating - a.rating);

    return res.json({
      results: shaped,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function getProductById(req, res) {
  try {
    const { id } = req.params;

    const { data: product, error } = await supabase
      .from("products")
      .select(
        `
        id,
        name,
        description,
        price,
        original_price,
        category_id,
        vendor_id,
        created_at,
        image_url,
        vendors:vendor_id ( id, store_name ),
        inventory:inventory!inventory_product_id_fkey ( stock_quantity )
      `
      )
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error || !product) return res.status(404).json({ message: "Product not found" });

    const stockQty =
      (Array.isArray(product.inventory)
        ? product.inventory?.[0]?.stock_quantity
        : product.inventory?.stock_quantity) ?? 0;

    const { data: reviews } = await supabase
      .from("reviews")
      .select("rating")
      .eq("product_id", id);

    const reviewsCount = reviews?.length || 0;
    const rating =
      reviewsCount > 0
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewsCount) * 10) / 10
        : 0;

    return res.json({
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      originalPrice: product.original_price !== null ? Number(product.original_price) : null,
      category: product.category_id,
      vendorId: product.vendor_id,
      vendorName: product.vendors?.store_name || "",
      imageUrl: product.image_url || null,   // ✅ ADD THIS
      inStock: stockQty > 0,
      stockQuantity: stockQty,
      rating,
      reviewsCount,
      createdAt: product.created_at,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}