import { supabase } from "../config/supabase.js";

export function requireRole(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "No user in request" });

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (error) return res.status(403).json({ message: "Profile not found" });

      if (!allowedRoles.includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden", role: profile.role });
      }

      req.profile = profile;
      next();
    } catch (err) {
      return res.status(500).json({ message: "Role check error", error: err.message });
    }
  };
} 