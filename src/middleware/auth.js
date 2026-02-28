import { supabase } from "../config/supabase.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) return res.status(401).json({ message: "Missing Bearer token" });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.user = data.user; // Supabase auth user
    next();
  } catch (err) {
    return res.status(500).json({ message: "Auth error", error: err.message });
  }
} 