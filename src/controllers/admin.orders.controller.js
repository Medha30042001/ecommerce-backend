import { supabaseAdmin } from "../config/supabase.js";

export async function listAllOrders(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(`
        id,
        created_at,
        status,
        total_amount,
        customer_id,
        profiles:customer_id ( id, name, email )
      `)
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ message: "Failed to fetch orders", error });

    const shaped = (data || []).map((o) => ({
      id: o.id,
      date: o.created_at,
      status: o.status,
      total: Number(o.total_amount ?? 0),
      customerId: o.customer_id,
      customerName: o.profiles?.name || o.profiles?.email || "Customer",
      itemsCount: 0, // optional: we’ll compute below
    }));

    // (Optional) compute itemsCount quickly
    const ids = (data || []).map((o) => o.id);
    if (ids.length) {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("order_id")
        .in("order_id", ids);

      const counts = {};
      for (const it of items || []) counts[it.order_id] = (counts[it.order_id] || 0) + 1;

      for (const row of shaped) row.itemsCount = counts[row.id] || 0;
    }

    return res.json({ results: shaped });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ["pending", "processing", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status })
      .eq("id", id);

    if (error) return res.status(400).json({ message: "Failed to update status", error });

    return res.json({ message: "Order updated" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}