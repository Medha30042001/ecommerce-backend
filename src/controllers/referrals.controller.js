import crypto from "crypto";
import { supabase } from "../config/supabase.js";

async function getVendorIdForUser(userId) {
  const { data } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", userId)
    .single();
  return data?.id || null;
}

function makeCode() {
  return crypto.randomBytes(6).toString("hex"); // 12-char code
}

/**
 * Vendor creates a referral link for a product
 * POST /api/vendor/referrals/links
 * body: { productId, discountPercent?, expiresAt? }
 */
export async function createReferralLink(req, res) {
  try {
    const userId = req.user.id;
    const vendorId = await getVendorIdForUser(userId);
    if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });

    const { productId, discountPercent = 0, expiresAt = null } = req.body;

    if (!productId) return res.status(400).json({ message: "productId is required" });

    const dp = Number(discountPercent);
    if (!Number.isFinite(dp) || dp < 0 || dp > 90) {
      return res.status(400).json({ message: "discountPercent must be between 0 and 90" });
    }

    // Ensure product belongs to vendor
    const { data: p, error: pErr } = await supabase
      .from("products")
      .select("id, vendor_id")
      .eq("id", productId)
      .single();

    if (pErr || !p) return res.status(404).json({ message: "Product not found" });
    if (p.vendor_id !== vendorId) return res.status(403).json({ message: "Not your product" });

    // Generate unique code (retry a few times on collision)
    let code = makeCode();
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase
        .from("referral_links")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      code = makeCode();
    }

    const { data: created, error } = await supabase
      .from("referral_links")
      .insert({
        vendor_id: vendorId,
        product_id: productId,
        code,
        discount_percent: dp,
        expires_at: expiresAt,
        is_active: true,
      })
      .select("id, code, discount_percent, expires_at, is_active, created_at")
      .single();

    if (error) return res.status(400).json({ message: "Failed to create referral link", error });

    // Share URL format (frontend will handle route)
    const sharePath = `/r/${created.code}`;

    return res.status(201).json({
      message: "Referral link created",
      link: created,
      sharePath,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

/**
 * Public: resolve a referral code and log click
 * GET /api/referrals/:code
 * returns: { productId, discountPercent, expiresAt, isValid }
 */
export async function resolveReferral(req, res) {
  try {
    const { code } = req.params;
    const sessionId = req.header("x-session-id") || null;
    const customerId = req.user?.id || null; // optional if auth middleware not used

    const { data: link, error } = await supabase
      .from("referral_links")
      .select("id, product_id, discount_percent, expires_at, is_active")
      .eq("code", code)
      .single();

    if (error || !link) return res.status(404).json({ message: "Referral link not found" });

    const expired = link.expires_at ? new Date(link.expires_at).getTime() < Date.now() : false;
    const isValid = Boolean(link.is_active) && !expired;

    // log click event even if invalid (useful for abuse/analytics)
    await supabase.from("referral_events").insert({
      referral_link_id: link.id,
      event_type: "click",
      session_id: sessionId,
      customer_id: customerId,
      meta: { isValid },
    });

    return res.json({
      productId: link.product_id,
      discountPercent: link.discount_percent,
      expiresAt: link.expires_at,
      isValid,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

/**
 * Public: log a product view from referral context
 * POST /api/referrals/:code/view
 * body: { productId }
 */
export async function logReferralView(req, res) {
  try {
    const { code } = req.params;
    const sessionId = req.header("x-session-id") || null;
    const customerId = req.user?.id || null;

    const { data: link } = await supabase
      .from("referral_links")
      .select("id, product_id")
      .eq("code", code)
      .single();

    if (!link) return res.status(404).json({ message: "Referral link not found" });

    await supabase.from("referral_events").insert({
      referral_link_id: link.id,
      event_type: "view",
      session_id: sessionId,
      customer_id: customerId,
      meta: { productId: link.product_id },
    });

    return res.json({ message: "View logged" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

/**
 * Vendor dashboard: referral analytics
 * GET /api/vendor/referrals/analytics?from=2026-02-01&to=2026-02-28
 */
export async function vendorReferralAnalytics(req, res) {
  try {
    const userId = req.user.id;
    const vendorId = await getVendorIdForUser(userId);
    if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });

    const { from, to } = req.query;

    // Fetch vendor links
    let linksQuery = supabase
      .from("referral_links")
      .select("id, code, product_id, discount_percent, created_at, is_active, expires_at")
      .eq("vendor_id", vendorId);

    const { data: links, error: lErr } = await linksQuery;
    if (lErr) return res.status(400).json({ message: "Failed to fetch links", error: lErr });

    const linkIds = (links || []).map((l) => l.id);
    if (linkIds.length === 0) return res.json({ results: [], totals: { clicks: 0, views: 0, purchases: 0 } });

    // Fetch events for those links
    let eventsQuery = supabase
      .from("referral_events")
      .select("referral_link_id, event_type, created_at, order_id")
      .in("referral_link_id", linkIds);

    if (from) eventsQuery = eventsQuery.gte("created_at", from);
    if (to) eventsQuery = eventsQuery.lte("created_at", to);

    const { data: events, error: eErr } = await eventsQuery;
    if (eErr) return res.status(400).json({ message: "Failed to fetch events", error: eErr });

    const byLink = {};
    for (const l of links) {
      byLink[l.id] = { ...l, clicks: 0, views: 0, purchases: 0 };
    }

    for (const ev of (events || [])) {
      const bucket = byLink[ev.referral_link_id];
      if (!bucket) continue;
      if (ev.event_type === "click") bucket.clicks++;
      if (ev.event_type === "view") bucket.views++;
      if (ev.event_type === "purchase") bucket.purchases++;
    }

    const results = Object.values(byLink).map((r) => ({
      code: r.code,
      productId: r.product_id,
      discountPercent: r.discount_percent,
      createdAt: r.created_at,
      isActive: r.is_active,
      expiresAt: r.expires_at,
      clicks: r.clicks,
      views: r.views,
      purchases: r.purchases,
      conversionRate: r.clicks ? Number(((r.purchases / r.clicks) * 100).toFixed(2)) : 0,
    }));

    const totals = results.reduce(
      (acc, r) => {
        acc.clicks += r.clicks;
        acc.views += r.views;
        acc.purchases += r.purchases;
        return acc;
      },
      { clicks: 0, views: 0, purchases: 0 }
    );

    return res.json({ results, totals });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}