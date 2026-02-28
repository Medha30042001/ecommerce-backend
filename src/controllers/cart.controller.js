import { supabase } from "../config/supabase.js";

async function getOrCreateCart(customerId) {
  const { data: existing } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", customerId)
    .single();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("carts")
    .insert({ customer_id: customerId })
    .select("id")
    .single();

  if (error) throw new Error("Failed to create cart");
  return created.id;
}

export async function getCart(req, res) {
  try {
    const customerId = req.user.id;
    const cartId = await getOrCreateCart(customerId);

    const { data, error } = await supabase
      .from("cart_items")
      .select(
        `
        product_id,
        quantity,
        products:product_id (
          id, name, price, original_price, category_id, image_url, vendor_id,
          vendors:vendor_id ( store_name ),
          inventory ( stock_quantity )
        )
      `
      )
      .eq("cart_id", cartId);

    if (error) return res.status(400).json({ message: "Failed to fetch cart", error });

    const items = (data || []).map((row) => {
      const p = row.products;
      const stockQty = (Array.isArray(p?.inventory) ? p.inventory?.[0]?.stock_quantity : p?.inventory?.stock_quantity) ?? 0;
      return {
        productId: row.product_id,
        quantity: row.quantity,
        product: {
          id: p.id,
          name: p.name,
          price: Number(p.price),
          imageUrl: p.image_url ?? null,
          originalPrice: p.original_price !== null ? Number(p.original_price) : null,
          category: p.category_id,
          vendorName: p?.vendors?.store_name || "",
          inStock: stockQty > 0,
          stockQuantity: stockQty,
        },
        lineTotal: Number(p.price) * row.quantity,
      };
    });

    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);

    return res.json({ cartId, items, subtotal });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function addToCart(req, res) {
  try {
    const customerId = req.user.id;
    const cartId = await getOrCreateCart(customerId);

    const { productId, quantity = 1 } = req.body;
    const qty = Number(quantity);

    if (!productId) return res.status(400).json({ message: "productId is required" });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: "Invalid quantity" });

    // Check stock
    const { data: inv, error: invErr } = await supabase
      .from("inventory")
      .select("stock_quantity")
      .eq("product_id", productId)
      .single();

    if (invErr) return res.status(404).json({ message: "Product not found" });
    if ((inv?.stock_quantity ?? 0) < qty) return res.status(400).json({ message: "Not enough stock" });

    // Upsert cart item
    const { data: existing } = await supabase
      .from("cart_items")
      .select("quantity")
      .eq("cart_id", cartId)
      .eq("product_id", productId)
      .single();

    const newQty = (existing?.quantity ?? 0) + qty;

    const { error } = await supabase
      .from("cart_items")
      .upsert({ cart_id: cartId, product_id: productId, quantity: newQty }, { onConflict: "cart_id,product_id" });

    if (error) return res.status(400).json({ message: "Failed to add to cart", error });

    return res.status(201).json({ message: "Added to cart" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function updateCartItem(req, res) {
  try {
    const customerId = req.user.id;
    const cartId = await getOrCreateCart(customerId);
    const { productId } = req.params;
    const { quantity } = req.body;

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: "Invalid quantity" });

    // Stock check
    const { data: inv } = await supabase
      .from("inventory")
      .select("stock_quantity")
      .eq("product_id", productId)
      .single();

    if ((inv?.stock_quantity ?? 0) < qty) return res.status(400).json({ message: "Not enough stock" });

    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: qty })
      .eq("cart_id", cartId)
      .eq("product_id", productId);

    if (error) return res.status(400).json({ message: "Failed to update cart item", error });

    return res.json({ message: "Cart item updated" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function removeCartItem(req, res) {
  try {
    const customerId = req.user.id;
    const cartId = await getOrCreateCart(customerId);
    const { productId } = req.params;

    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("cart_id", cartId)
      .eq("product_id", productId);

    if (error) return res.status(400).json({ message: "Failed to remove item", error });

    return res.json({ message: "Removed from cart" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}