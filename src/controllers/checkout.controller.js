import { supabase } from "../config/supabase.js";

async function getCartId(customerId) {
  const { data, error } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) return null;
  return data?.id || null;
}

export async function checkout(req, res) {
  try {
    const customerId = req.user.id;
    const cartId = await getCartId(customerId);

    if (!cartId) return res.status(400).json({ message: "Cart not found" });

    // Get cart items + current prices
    const { data: cartItems, error: cartErr } = await supabase
    .from("cart_items")
    .select(
        `
        product_id,
        quantity,
        products:product_id (
        price,
        is_active,
        inventory ( stock_quantity )
        )
    `
    )
    .eq("cart_id", cartId);

    if (cartErr) return res.status(400).json({ message: "Failed to fetch cart", error: cartErr });
    if (!cartItems || cartItems.length === 0) return res.status(400).json({ message: "Cart is empty" });

    // Validate stock + compute total
    let total = 0;

    for (const item of cartItems) {
  const price = Number(item.products?.price ?? 0);

  if (item.products?.is_active === false) {
      return res.status(400).json({
        message: "One or more products are inactive",
        productId: item.product_id,
      });
    }

    const stockQty =
      (Array.isArray(item.products?.inventory)
        ? item.products.inventory?.[0]?.stock_quantity
        : item.products?.inventory?.stock_quantity) ?? 0;

    if (stockQty < item.quantity) {
      return res.status(400).json({
        message: "Not enough stock for one or more items",
        productId: item.product_id,
      });
    }

    total += price * item.quantity;
  }

    // Create order
    const generatedOrderNumber = `ORD-${Date.now().toString().slice(-6)}`;

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        customer_id: customerId,
        status: "pending",
        total_amount: total,
        order_number: generatedOrderNumber,
      })
      .select("id, order_number")
      .single();

    if (orderErr) return res.status(400).json({ message: "Failed to create order", error: orderErr });
    
    //Add this near the end of checkout (after creating order):
    const { referralCode } = req.body;

    if (referralCode) {
      const { data: link } = await supabase
        .from("referral_links")
        .select("id")
        .eq("code", referralCode)
        .maybeSingle();

      if (link?.id) {
        await supabase.from("referral_events").insert({
          referral_link_id: link.id,
          event_type: "purchase",
          customer_id: customerId,
          order_id: order.id,
          meta: { total },
        });
      }
    }
    // Create order_items
    const orderItemsPayload = cartItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_purchase: Number(item.products?.price ?? 0),
    }));

    const { error: itemsErr } = await supabase.from("order_items").insert(orderItemsPayload);
    if (itemsErr) return res.status(400).json({ message: "Failed to create order items", error: itemsErr });

    // Decrement inventory for each item
    // (simple sequential updates for now — good enough for demo)
    for (const item of cartItems) {
        const { error: invErr } = await supabase.rpc("decrement_inventory", {
            p_product_id: item.product_id,
            p_qty: item.quantity,
        });

        if (invErr) {
            return res.status(400).json({
            message: "Inventory update failed (not enough stock)",
            productId: item.product_id,
            error: invErr,
            });
        }
    }

    // Clear cart
    await supabase.from("cart_items").delete().eq("cart_id", cartId);

    return res.status(201).json({
      message: "Order placed",
      orderId: order.id,
      total,
      status: "pending",
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}