import { supabase, supabaseAdmin } from "../config/supabase.js";

function toBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  if (typeof v === "number") return v === 1;
  return fallback;
}

async function uploadProductImage(file) {
  if (!file) return null;

  const bucket = "product-images";
  const ext = (file.originalname.split(".").pop() || "jpg").toLowerCase();
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const filePath = `products/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (upErr) throw new Error(upErr.message);

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(filePath);
  return data?.publicUrl || null;
}

async function getVendorIdForUser(userId) {
  const { data, error } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return data.id;
}

export async function listVendorProducts(req, res) {
  try {
    const userId = req.user.id;
    const role = req.profile?.role; // ✅ add here

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
        is_active, 
        is_featured, 
        created_at,
        image_url,
        vendor_id,
        vendors:vendor_id ( id, store_name ),
        inventory:inventory!inventory_product_id_fkey ( stock_quantity )
      `
      )
      .order("created_at", { ascending: false });

    // ✅ Vendor: only their products
    if (role !== "admin") {
      const vendorId = await getVendorIdForUser(userId);
      if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });
      query = query.eq("vendor_id", vendorId);
    }

    // ✅ Optional toggle: activeOnly=true will return only active products
    if (req.query.activeOnly === "true") {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ message: "Failed to fetch products", error });

    // --- ratings aggregation from reviews ---
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

    const shaped = (data || []).map((p) => {
      // inventory can come as array OR object depending on join
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
        inStock: stockQty > 0,
        stockQuantity: stockQty,
        rating: stats.rating,
        reviewsCount: stats.reviewsCount,
        imageUrl: p.image_url || null,
        isActive: p.is_active,
        isFeatured: p.is_featured,
        createdAt: p.created_at,
      };
    });

    return res.json({ results: shaped });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function createVendorProduct(req, res) {
  try {

    console.log("BODY:", req.body); // temporary debug
    console.log("FILE:", req.file); // temporary debug

    const userId = req.user.id;
    const vendorId = await getVendorIdForUser(userId);
    if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });
     
    if (!req.body) {
      return res.status(400).json({ message: "No form data received" });
    }

    const {
      name,
      description,
      price,
      originalPrice,
      category,
      stockQuantity = 0,
      isFeatured = false,
      isActive = true,
    } = req.body;

    if (!name || !category || price === undefined) {
      return res.status(400).json({ message: "name, category, and price are required" });
    }

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ message: "Invalid price" });
    }

    const originalNum = originalPrice !== undefined && originalPrice !== null ? Number(originalPrice) : null;
    if (originalNum !== null && (!Number.isFinite(originalNum) || originalNum < 0)) {
      return res.status(400).json({ message: "Invalid originalPrice" });
    }

    const imageUrl = await uploadProductImage(req.file);

    const { data: created, error: createErr } = await supabase
      .from("products")
      .insert({
        vendor_id: vendorId,
        category_id: category,
        name,
        description: description || null,
        price: priceNum,
        original_price: originalNum,
        is_featured: toBool(isFeatured, false),
        is_active: toBool(isActive, true),
        image_url: imageUrl || null,
      })
      .select("id")
      .single();

    if (createErr) return res.status(400).json({ message: "Failed to create product", error: createErr });

    // Insert inventory row
    const qty = Number(stockQuantity);
    const safeQty = Number.isFinite(qty) && qty >= 0 ? qty : 0;

    const { error: invErr } = await supabase
      .from("inventory")
      .insert({ product_id: created.id, stock_quantity: safeQty });

    if (invErr) {
      // rollback product if inventory insert failed
      await supabase.from("products").delete().eq("id", created.id);
      return res.status(400).json({ message: "Failed to create inventory", error: invErr });
    }

    return res.status(201).json({ id: created.id, message: "Product created" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function updateVendorProduct(req, res) {
  try {
    const userId = req.user.id;
    const role = req.profile?.role; // allow admin too

    // If vendor: must own the product. If admin: can edit any.
    let vendorId = null;
    if (role !== "admin") {
      vendorId = await getVendorIdForUser(userId);
      if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });
    }

    const { id } = req.params;
    const { name, description, price, originalPrice, category, stockQuantity, isActive, isFeatured } = req.body;

    // Ensure product exists (and vendor owns it, if vendor)
    const { data: existing, error: exErr } = await supabase
      .from("products")
      .select("id, vendor_id, image_url")
      .eq("id", id)
      .single();

    if (exErr || !existing) return res.status(404).json({ message: "Product not found" });

    if (role !== "admin" && existing.vendor_id !== vendorId) {
      return res.status(403).json({ message: "Not your product" });
    }

    const patch = {};

    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description || null;
    if (category !== undefined) patch.category_id = category;

    if (price !== undefined) {
      const p = Number(price);
      if (!Number.isFinite(p) || p < 0) return res.status(400).json({ message: "Invalid price" });
      patch.price = p;
    }

    if (originalPrice !== undefined) {
      const op = originalPrice === null ? null : Number(originalPrice);
      if (op !== null && (!Number.isFinite(op) || op < 0)) {
        return res.status(400).json({ message: "Invalid originalPrice" });
      }
      patch.original_price = op;
    }

    if (isActive !== undefined) patch.is_active = toBool(isActive);
    if (isFeatured !== undefined) patch.is_featured = toBool(isFeatured);

    // ✅ KEY FIX: upload image if provided, then store image_url
    if (req.file) {
      const imageUrl = await uploadProductImage(req.file);
      patch.image_url = imageUrl; // ✅ updates DB
    }

    const { data: updated, error: updErr } = await supabase
      .from("products")
      .update(patch)
      .eq("id", id)
      .select("id, image_url, is_featured, is_active")
      .single();

    if (updErr) return res.status(400).json({ message: "Update failed", error: updErr });

    // inventory update (optional)
    if (stockQuantity !== undefined) {
      const qty = Number(stockQuantity);
      if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ message: "Invalid stockQuantity" });

      const { error: invErr } = await supabase
        .from("inventory")
        .upsert({ product_id: id, stock_quantity: qty }, { onConflict: "product_id" });

      if (invErr) return res.status(400).json({ message: "Inventory update failed", error: invErr });
    }

    return res.json({
      message: "Product updated",
      imageUrl: updated?.image_url ?? null,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function deleteVendorProduct(req, res) {
  try {
    const userId = req.user.id;
    const role = req.profile?.role;

    // Admin can delete any product; vendor only their own
    let vendorId = null;
    if (role !== "admin") {
      vendorId = await getVendorIdForUser(userId);
      if (!vendorId) return res.status(403).json({ message: "Vendor profile not found" });
    }

    const { id } = req.params;

    const { data: existing, error: exErr } = await supabase
      .from("products")
      .select("id, vendor_id")
      .eq("id", id)
      .single();

    if (exErr || !existing) return res.status(404).json({ message: "Product not found" });

    if (role !== "admin" && existing.vendor_id !== vendorId) {
      return res.status(403).json({ message: "Not your product" });
    }

    // ✅ Soft delete
    const { error: updErr } = await supabase
      .from("products")
      .update({ is_active: false })
      .eq("id", id)
      .select("id")
      .single();

    if (updErr) return res.status(400).json({ message: "Delete failed", error: updErr });

    // Optional but nice: set stock to 0 so it never shows "in stock" anywhere
    await supabase.from("inventory").update({ stock_quantity: 0 }).eq("product_id", id);

    return res.json({ message: "Product deactivated" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}