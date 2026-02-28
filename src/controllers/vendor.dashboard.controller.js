import { supabase } from "../config/supabase.js";

async function getVendorIdForUser(userId) {
  const { data, error } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return data?.id || null;
}

// ✅ Low-stock: make inventory join safe (array vs object)
export async function getLowStockProducts(req, res) {
  try {
    const userId = req.user.id;
    const vendorId = await getVendorIdForUser(userId);

    if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });

    const { data, error } = await supabase
      .from("products")
      .select(
        `
        id,
        name,
        inventory ( stock_quantity, low_stock_threshold )
      `
      )
      .eq("vendor_id", vendorId)
      .eq("is_active", true);

    if (error) return res.status(400).json({ message: "Failed to fetch inventory", error });

    const lowStock = (data || []).filter((p) => {
      const inv = Array.isArray(p.inventory) ? p.inventory?.[0] : p.inventory;
      const stock = Number(inv?.stock_quantity ?? 0);
      const threshold = Number(inv?.low_stock_threshold ?? 5);
      return stock <= threshold;
    });

    return res.json({ results: lowStock });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function getVendorAnalytics(req, res) {
  try {
    const userId = req.user.id;
    const vendorId = await getVendorIdForUser(userId);

    if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });

    // 1) ✅ Total products (active)
    const { count: totalProducts, error: prodErr } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId)
      .eq("is_active", true);

    if (prodErr) return res.status(400).json({ message: "Failed to fetch products count", error: prodErr });

    // 2) ✅ Order items for this vendor ONLY (filter happens in DB)
    // Pull order_id + created_at so we can build graphs in JS.
    const { data: items, error: itemsErr } = await supabase
      .from("order_items")
      .select(
        `
        order_id,
        quantity,
        price_at_purchase,
        orders:order_id ( created_at, status, customer_id ),
        products:product_id ( id, name, vendor_id )
      `
      )
      .eq("products.vendor_id", vendorId);

    if (itemsErr) return res.status(400).json({ message: "Failed to fetch sales data", error: itemsErr });

    const rows = items || [];

    // ✅ Revenue: ignore cancelled orders for analytics
    const valid = rows.filter((r) => (r.orders?.status || "") !== "cancelled");

    const totalRevenue = valid.reduce(
      (sum, r) => sum + Number(r.quantity ?? 0) * Number(r.price_at_purchase ?? 0),
      0
    );

    // ✅ Total orders = DISTINCT order_id
    const orderIdSet = new Set(valid.map((r) => r.order_id));
    const totalOrders = orderIdSet.size;

    // ✅ Unique customers (nice KPI for vendor)
    const customerSet = new Set(valid.map((r) => r.orders?.customer_id).filter(Boolean));
    const uniqueCustomers = customerSet.size;

    // ✅ Avg order value (vendor-side)
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // 3) ✅ Top products by revenue (for bar chart)
    const revenueByProduct = new Map(); // productId -> { name, revenue, qty }
    for (const r of valid) {
      const pid = r.products?.id;
      if (!pid) continue;

      const name = r.products?.name || "Product";
      const lineRevenue = Number(r.quantity ?? 0) * Number(r.price_at_purchase ?? 0);

      const prev = revenueByProduct.get(pid) || { productId: pid, name, revenue: 0, qty: 0 };
      prev.revenue += lineRevenue;
      prev.qty += Number(r.quantity ?? 0);
      revenueByProduct.set(pid, prev);
    }

    const topProducts = Array.from(revenueByProduct.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // 4) ✅ Revenue by day (last 14 days) for line chart
    const days = 14;
    const today = new Date();
    const byDay = new Map(); // yyyy-mm-dd -> revenue

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, 0);
    }

    for (const r of valid) {
      const iso = r.orders?.created_at;
      if (!iso) continue;
      const key = String(iso).slice(0, 10);
      if (!byDay.has(key)) continue;

      const lineRevenue = Number(r.quantity ?? 0) * Number(r.price_at_purchase ?? 0);
      byDay.set(key, (byDay.get(key) || 0) + lineRevenue);
    }

    const revenueSeries = Array.from(byDay.entries()).map(([date, revenue]) => ({
      date,
      revenue: Math.round(revenue * 100) / 100,
    }));

    // 5) ✅ Low stock count (for dashboard card)
    const { data: invRows, error: invErr } = await supabase
      .from("products")
      .select(`id, inventory ( stock_quantity, low_stock_threshold )`)
      .eq("vendor_id", vendorId)
      .eq("is_active", true);

    if (invErr) return res.status(400).json({ message: "Failed to fetch inventory snapshot", error: invErr });

    const lowStockCount = (invRows || []).filter((p) => {
      const inv = Array.isArray(p.inventory) ? p.inventory?.[0] : p.inventory;
      const stock = Number(inv?.stock_quantity ?? 0);
      const threshold = Number(inv?.low_stock_threshold ?? 5);
      return stock <= threshold;
    }).length;

    return res.json({
      cards: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        totalProducts: totalProducts ?? 0,
        uniqueCustomers,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        lowStockCount,
      },
      charts: {
        revenueLast14Days: revenueSeries,
        topProducts,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}