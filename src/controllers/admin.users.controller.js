import { supabaseAdmin } from "../config/supabase.js";

export async function listUsers(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, role, created_at")
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ message: "Failed to fetch users", error });

    const shaped = (data || []).map((u) => ({
      id: u.id,
      name: u.name || u.email?.split("@")?.[0] || "User",
      email: u.email,
      role: u.role,
      joined: u.created_at,
    }));

    return res.json({ results: shaped });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

export async function updateUserRole(req, res) {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const allowed = ["customer", "vendor", "admin"];
    if (!allowed.includes(role)) return res.status(400).json({ message: "Invalid role" });

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ role })
      .eq("id", id);

    if (error) return res.status(400).json({ message: "Failed to update role", error });

    return res.json({ message: "Role updated" });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}