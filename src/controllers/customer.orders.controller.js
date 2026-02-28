import { supabase } from "../config/supabase.js";
import PDFDocument from "pdfkit";

export async function getCustomerOrders(req, res) {
  try {
    const customerId = req.user.id;

    const {
      page = 1,
      limit = 5,
      search = "",
    } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(20, Math.max(1, Number(limit)));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        status,
        total_amount,
        created_at,
        order_items (
          product_id,
          quantity,
          price_at_purchase,
          products:product_id ( name )
        )
      `,
        { count: "exact" }
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (search) {
      query = query.ilike("order_number", `%${search}%`);
    }

    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error)
      return res.status(400).json({ message: "Failed to fetch orders", error });

    const shaped = (data || []).map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      total: Number(o.total_amount),
      date: o.created_at,
      items: (o.order_items || []).map((i) => ({
        productId: i.product_id,
        name: i.products?.name || "",
        qty: i.quantity,
        price: Number(i.price_at_purchase),
      })),
    }));

    return res.json({
      results: shaped,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function getCustomerOrderById(req, res) {
  try {
    const customerId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        status,
        total_amount,
        created_at,
        order_items (
          product_id,
          quantity,
          price_at_purchase,
          products:product_id ( id, name, image_url )
        )
      `
      )
      .eq("customer_id", customerId)
      .eq("id", id)
      .maybeSingle();

    if (error) return res.status(400).json({ message: "Failed to fetch order", error });
    if (!data) return res.status(404).json({ message: "Order not found" });

    const shaped = {
      id: data.id,
      orderNumber: data.order_number,
      status: data.status,
      total: Number(data.total_amount),
      date: data.created_at,
      items: (data.order_items || []).map((i) => ({
        productId: i.product_id,
        name: i.products?.name || "",
        imageUrl: i.products?.image_url ?? null,
        qty: i.quantity,
        price: Number(i.price_at_purchase),
        lineTotal: Number(i.price_at_purchase) * i.quantity,
      })),
    };

    return res.json({ order: shaped });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function downloadInvoice(req, res) {
  try {
    const customerId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        status,
        total_amount,
        created_at,
        order_items (
          quantity,
          price_at_purchase,
          products:product_id ( name )
        )
      `
      )
      .eq("customer_id", customerId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data)
      return res.status(404).json({ message: "Order not found" });

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=invoice-${data.order_number || data.id}.pdf`
    );

    doc.pipe(res);

    // Header
    doc.fontSize(20).text("INVOICE", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Order Number: ${data.order_number || data.id}`);
    doc.text(`Date: ${new Date(data.created_at).toLocaleString()}`);
    doc.text(`Status: ${data.status}`);
    doc.moveDown();

    doc.text("Items:");
    doc.moveDown(0.5);

    data.order_items.forEach((item) => {
      const name = item.products?.name || "Product";
      const qty = item.quantity;
      const price = Number(item.price_at_purchase);
      const lineTotal = price * qty;

      doc.text(`${name}`);
      doc.text(`   ${qty} × $${price.toFixed(2)} = $${lineTotal.toFixed(2)}`);
      doc.moveDown(0.5);
    });

    doc.moveDown();
    doc.fontSize(14).text(`Total: $${Number(data.total_amount).toFixed(2)}`, {
      align: "right",
    });

    doc.end();
  } catch (err) {
    return res.status(500).json({ message: "Invoice generation failed" });
  }
}