import { supabase } from "../config/supabase.js";

async function getVendorIdForUser(userId) {
  const { data } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", userId)
    .single();

  return data?.id || null;
}

export async function listVendorOrders(req, res) {
  try {
    const userId = req.user.id;
    const vendorId = await getVendorIdForUser(userId);

    if (!vendorId) {
      return res.status(403).json({ message: "Vendor profile not found" });
    }

    const { data, error } = await supabase
      .from("orders")
      .select(`
        id,
        status,
        total_amount,
        created_at,
        customer_id,
        profiles:customer_id ( name, email ),
        order_items (
          quantity,
          price_at_purchase,
          products!inner (
            id,
            name,
            vendor_id
          )
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ message: "Failed to fetch orders", error });
    }

    const filteredOrders = (data || [])
      .map((order) => {
        const vendorItems = (order.order_items || []).filter(
          (item) => item.products?.vendor_id === vendorId
        );

        if (vendorItems.length === 0) return null;

        const vendorTotal = vendorItems.reduce(
          (sum, it) => sum + Number(it.price_at_purchase || 0) * Number(it.quantity || 0),
          0
        );

        const customerName =
          order.profiles?.name ||
          order.profiles?.email ||
          "Customer";

        return {
          id: order.id,
          status: order.status,
          total: Number(vendorTotal.toFixed(2)),
          date: order.created_at,
          customerName,
          items: vendorItems.map((item) => ({
            productId: item.products.id,
            name: item.products.name,
            quantity: item.quantity,
            price: Number(item.price_at_purchase),
          })),
        };
      })
      .filter(Boolean);

    return res.json({ results: filteredOrders });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function updateOrderStatus(req, res) {
  try {
    const userId = req.user.id;
    const vendorId = await getVendorIdForUser(userId);

    if (!vendorId)
      return res.status(403).json({ message: "Vendor profile not found" });

    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];

    if (!allowedStatuses.includes(status))
      return res.status(400).json({ message: "Invalid status" });

    // Check order contains this vendor's products
    const { data: orderItems } = await supabase
      .from("order_items")
      .select(`
        product_id,
        products!inner(vendor_id)
      `)
      .eq("order_id", id);

    const belongsToVendor = orderItems?.some(
      (item) => item.products.vendor_id === vendorId
    );

    if (!belongsToVendor)
      return res.status(403).json({ message: "Not authorized for this order" });

    const { error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id);

    if (error)
      return res.status(400).json({ message: "Failed to update order", error });

    return res.json({ message: "Order status updated", status });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}