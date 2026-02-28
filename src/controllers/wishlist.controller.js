import { supabase } from "../config/supabase.js";

async function getOrCreateWishlist(customerId) {
  const { data: existing } = await supabase
    .from("wishlists")
    .select("id")
    .eq("customer_id", customerId)
    .single();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("wishlists")
    .insert({ customer_id: customerId })
    .select("id")
    .single();

  if (error) throw new Error("Failed to create wishlist");
  return created.id;
}

export async function getWishlist(req, res) {
  try {
    const customerId = req.user.id;
    const wishlistId = await getOrCreateWishlist(customerId);

    const { data, error } = await supabase
      .from("wishlist_items")
      .select(
        `
        product_id,
        created_at,
        products:product_id (
          id, name, price, original_price, category_id, vendor_id, image_url,
          vendors:vendor_id ( store_name ),
          inventory ( stock_quantity )
        )
      `
      )
      .eq("wishlist_id", wishlistId)
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ message: "Failed to fetch wishlist", error });

    const items = (data || []).map((row) => {
      const p = row.products;
      const stockQty = (Array.isArray(p?.inventory) ? p.inventory?.[0]?.stock_quantity : p?.inventory?.stock_quantity) ?? 0;
      return {
        productId: row.product_id,
        addedAt: row.created_at,
        product: {
          id: p.id,
          name: p.name,
          price: Number(p.price),
          originalPrice: p.original_price !== null ? Number(p.original_price) : null,
          category: p.category_id,
          vendorName: p?.vendors?.store_name || "",
          inStock: stockQty > 0,
          imageUrl: p.image_url ?? null,
        },
      };
    });

    return res.json({ wishlistId, items });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function addWishlistItem(req, res) {
  try {
    const customerId = req.user.id;
    const wishlistId = await getOrCreateWishlist(customerId);

    const { productId } = req.body;
    if (!productId) return res.status(400).json({ message: "productId is required" });

    const { error } = await supabase
      .from("wishlist_items")
      .insert({ wishlist_id: wishlistId, product_id: productId });

    if (error) {
      // duplicate primary key means already wishlisted
      return res.status(200).json({ message: "Already in wishlist" });
    }

    return res.status(201).json({ message: "Added to wishlist" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function removeWishlistItem(req, res) {
  try {
    const customerId = req.user.id;
    const wishlistId = await getOrCreateWishlist(customerId);

    const { productId } = req.params;

    const { error } = await supabase
      .from("wishlist_items")
      .delete()
      .eq("wishlist_id", wishlistId)
      .eq("product_id", productId);

    if (error) return res.status(400).json({ message: "Failed to remove from wishlist", error });

    return res.json({ message: "Removed from wishlist" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}