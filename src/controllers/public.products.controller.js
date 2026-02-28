import { supabase } from "../config/supabase.js";

export async function listProducts(req, res) {
  try {
    const {
      category,
      minPrice,
      maxPrice,
      minRating,
      search,
      sort = "newest",
      page = 1,
      limit = 12,
    } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { featured } = req.query;

    let query = supabase
      .from("products")
      .select(`
        id,
        name,
        description,
        price,
        original_price,
        category_id,
        image_url,
        is_featured,
        created_at,
        inventory:inventory!inventory_product_id_fkey ( stock_quantity )
      `, { count: "exact" })
      .eq("is_active", true);
    //rating,

    if (featured === "true") query = query.eq("is_featured", true);
    if (category) query = query.eq("category_id", category);
    if (minPrice) query = query.gte("price", Number(minPrice));
    if (maxPrice) query = query.lte("price", Number(maxPrice));
    // if (minRating) query = query.gte("rating", Number(minRating));
    if (search) query = query.ilike("name", `%${search}%`);

    // Sorting
    if (sort === "price_asc") query = query.order("price", { ascending: true });
    else if (sort === "price_desc") query = query.order("price", { ascending: false });
    // else if (sort === "rating") query = query.order("rating", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    query = query.range(from, to);

    const { data, error, count } = await query;

    

    // --- ratings aggregation from reviews (for this page of products) ---
    const productIds = (data || []).map((p) => p.id);
    let ratingMap = {};
    if (productIds.length) {
      const { data: reviews, error: revErr } = await supabase
        .from("reviews")
        .select("product_id, rating")
        .in("product_id", productIds);

      if (!revErr && reviews) {
        const agg = {};
        for (const r of reviews) {
          if (!agg[r.product_id]) agg[r.product_id] = { sum: 0, count: 0 };
          agg[r.product_id].sum += Number(r.rating || 0);
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

    if (error)
      return res.status(400).json({ message: "Failed to fetch products", error });

    const shaped = (data || []).map((p) => {
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
        originalPrice: p.original_price ? Number(p.original_price) : null,
        category: p.category_id,
        rating: 0,
        reviewsCount: 0,
        stockQuantity: stockQty,
        rating: stats.rating,
        reviewsCount: stats.reviewsCount,
        imageUrl: p.image_url || null,
        inStock: stockQty > 0,
        createdAt: p.created_at,
      };
    });
// /rating: p.rating ?? 0,

    return res.json({
      results: shaped,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum),
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
        image_url,
        is_featured,
        is_active,
        created_at,
        vendors:vendor_id ( id, store_name ),
        inventory:inventory!inventory_product_id_fkey ( stock_quantity )
      `
      )
      .eq("id", id)
      .single();

    if (error || !product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // 👇 IMPORTANT: inventory join can be array or object depending on your schema/join
    const stockQty =
      (Array.isArray(product.inventory)
        ? product.inventory?.[0]?.stock_quantity
        : product.inventory?.stock_quantity) ?? 0;

    // --- rating + reviewsCount + latest reviews ---
    const { data: reviews, error: revErr } = await supabase
      .from("reviews")
      .select(`
        rating,
        comment,
        created_at,
        profiles:customer_id ( name )
      `)
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (revErr) {
      return res.status(400).json({ message: "Failed to fetch reviews", error: revErr });
    }

    const reviewsCount = (reviews || []).length;
    const rating =
      reviewsCount > 0
        ? Math.round(
            ((reviews || []).reduce((s, r) => s + Number(r.rating || 0), 0) / reviewsCount) * 10
          ) / 10
        : 0;

    const shapedReviews = (reviews || []).map((r) => ({
      rating: r.rating,
      comment: r.comment || "",
      createdAt: r.created_at,
      customerName: r.profiles?.name || "Customer",
    }));

    return res.json({
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      originalPrice: product.original_price !== null ? Number(product.original_price) : null,
      category: product.category_id,
      vendorId: product.vendor_id,
      vendorName: product.vendors?.store_name || "",
      imageUrl: product.image_url || null,
      inStock: stockQty > 0,
      stockQuantity: stockQty,
      createdAt: product.created_at,
      rating,
      reviewsCount,
      reviews: shapedReviews,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}