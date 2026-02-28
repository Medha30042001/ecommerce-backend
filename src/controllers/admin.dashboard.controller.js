import { supabaseAdmin } from "../config/supabase.js";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDay(d) {
  const x = new Date(d);
  // YYYY-MM-DD
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildLastNDays(n) {
  const days = [];
  const today = startOfDay(new Date());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(fmtDay(d));
  }
  return days;
}

export async function getAdminDashboard(req, res) {
  try {
    const DAYS = 14;
    const days = buildLastNDays(DAYS);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - (DAYS - 1));
    fromDate.setHours(0, 0, 0, 0);

    // ---- Counts (fast, head:true)
    const [
      usersCountResp,
      productsCountResp,
      ordersCountResp,
      vendorsCountResp,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("products").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("vendors").select("id", { count: "exact", head: true }),
    ]);

    const totalUsers = usersCountResp.count || 0;
    const totalProducts = productsCountResp.count || 0;
    const totalOrders = ordersCountResp.count || 0;
    const totalVendors = vendorsCountResp.count || 0;

    // ---- Revenue + trends (last N days)
    const { data: ordersRecent, error: ordersRecentErr } = await supabaseAdmin
      .from("orders")
      .select("id, created_at, status, total_amount, customer_id")
      .gte("created_at", fromDate.toISOString())
      .order("created_at", { ascending: true });

    if (ordersRecentErr) {
      return res.status(400).json({ message: "Failed to fetch orders trend", error: ordersRecentErr });
    }

    const trendMap = {};
    for (const d of days) trendMap[d] = { date: d, orders: 0, revenue: 0 };

    for (const o of ordersRecent || []) {
      const d = fmtDay(o.created_at);
      if (!trendMap[d]) continue;
      trendMap[d].orders += 1;
      trendMap[d].revenue += Number(o.total_amount ?? 0);
    }

    const ordersTrend = days.map((d) => ({
      date: d,
      orders: trendMap[d].orders,
      revenue: Number(trendMap[d].revenue.toFixed(2)),
    }));

    // ---- Total revenue (all time) — simplest reliable approach: fetch only total_amount and reduce
    // If your dataset becomes huge later, switch to an RPC aggregate.
    const { data: allTotals, error: allTotalsErr } = await supabaseAdmin
      .from("orders")
      .select("total_amount");

    if (allTotalsErr) {
      return res.status(400).json({ message: "Failed to fetch revenue", error: allTotalsErr });
    }

    const totalRevenue = Number(
      (allTotals || []).reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0).toFixed(2)
    );

    // ---- Recent Orders (limit 5) + customer name/email
    const { data: recentOrdersRaw, error: recentOrdersErr } = await supabaseAdmin
      .from("orders")
      .select(`
        id,
        created_at,
        status,
        total_amount,
        customer_id,
        profiles:customer_id ( id, name, email )
      `)
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentOrdersErr) {
      return res.status(400).json({ message: "Failed to fetch recent orders", error: recentOrdersErr });
    }

    // Compute itemsCount for these 5 orders
    const orderIds = (recentOrdersRaw || []).map((o) => o.id);
    let itemsCountMap = {};
    if (orderIds.length) {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("order_id")
        .in("order_id", orderIds);

      for (const it of items || []) {
        itemsCountMap[it.order_id] = (itemsCountMap[it.order_id] || 0) + 1;
      }
    }

    const recentOrders = (recentOrdersRaw || []).map((o) => ({
      id: o.id,
      date: o.created_at,
      status: o.status,
      total: Number(o.total_amount ?? 0),
      customerName: o.profiles?.name || o.profiles?.email || "Customer",
      itemsCount: itemsCountMap[o.id] || 0,
    }));

    // ---- Recent Products (limit 5) + vendor store name
    const { data: recentProductsRaw, error: recentProductsErr } = await supabaseAdmin
      .from("products")
      .select(`
        id,
        name,
        price,
        is_active,
        created_at,
        vendors:vendor_id ( id, store_name )
      `)
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentProductsErr) {
      return res.status(400).json({ message: "Failed to fetch recent products", error: recentProductsErr });
    }

    const recentProducts = (recentProductsRaw || []).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price ?? 0),
      isActive: !!p.is_active,
      createdAt: p.created_at,
      vendorName: p.vendors?.store_name || "Vendor",
    }));

    // ---- Recent Users (limit 5)
    const { data: recentUsersRaw, error: recentUsersErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, role, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentUsersErr) {
      return res.status(400).json({ message: "Failed to fetch recent users", error: recentUsersErr });
    }

    const recentUsers = (recentUsersRaw || []).map((u) => ({
      id: u.id,
      name: u.name || u.email?.split("@")?.[0] || "User",
      email: u.email,
      role: u.role,
      joined: u.created_at,
    }));

    // ---- Order status split (simple from all-time counts would be expensive; do last N days instead)
    const statusSplit = { pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
    for (const o of ordersRecent || []) {
      if (statusSplit[o.status] !== undefined) statusSplit[o.status] += 1;
    }

    return res.json({
      stats: {
        totalUsers,
        totalVendors,
        totalProducts,
        totalOrders,
        totalRevenue,
        statusSplitLast14Days: statusSplit,
      },
      ordersTrend,
      recentOrders,
      recentProducts,
      recentUsers,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}