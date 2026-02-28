import { supabase, supabaseAdmin } from "../config/supabase.js";

const ALLOWED_ROLES = ["customer", "vendor", "admin"];

function isValidRole(role) {
  return ALLOWED_ROLES.includes(role);
}

// Small helper: ensure profile exists (fixes old users missing profile row)
async function ensureProfileExists({ userId, email, name = null, role = "customer" }) {
  // 1) try fetch
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, role")
    .eq("id", userId)
    .maybeSingle();

  // If query failed for some reason other than "no rows", throw
  if (exErr) {
    throw new Error(exErr.message || "Failed to fetch profile");
  }

  // 2) if exists, return it
  if (existing) return existing;

  // 3) create profile (upsert to be safe)
  const { data: created, error: createErr } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id: userId,
        name: name || null,
        email,
        role,
      },
      { onConflict: "id" }
    )
    .select("id, name, email, role")
    .single();

  if (createErr) {
    throw new Error(createErr.message || "Failed to create profile");
  }

  return created;
}

// Optional helper: ensure vendor row exists if role is vendor
async function ensureVendorExists({ userId, name }) {
  const { data: existing, error: vErr } = await supabaseAdmin
    .from("vendors")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (vErr) {
    // don’t hard-fail login if vendors check fails; but throw on signup is okay
    throw new Error(vErr.message || "Failed to fetch vendor");
  }

  if (existing) return existing;

  const { data: created, error: cErr } = await supabaseAdmin
    .from("vendors")
    .upsert(
      {
        user_id: userId,
        store_name: name ? `${name}'s Store` : "My Store",
      },
      { onConflict: "user_id" }
    )
    .select("id, user_id")
    .single();

  if (cErr) {
    throw new Error(cErr.message || "Failed to create vendor row");
  }

  return created;
}

// POST /api/auth/signup
// body: { name, email, password, role }
export async function signup(req, res) {
  try {
    const { name, email, password, role = "customer" } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    if (!isValidRole(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    // ✅ Create auth user SERVER-SIDE
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) return res.status(400).json({ message: "Signup failed", error });

    const user = data?.user;
    if (!user) return res.status(400).json({ message: "No user returned from Supabase" });

    // ✅ Ensure profile row exists
    let profile;
    try {
      profile = await ensureProfileExists({
        userId: user.id,
        email: user.email,
        name: name || null,
        role,
      });
    } catch (e) {
      // rollback auth user if profile insert fails
      await supabaseAdmin.auth.admin.deleteUser(user.id);
      return res.status(400).json({ message: "Profile creation failed", error: String(e?.message || e) });
    }

    // ✅ If vendor, ensure vendor row exists
    if (role === "vendor") {
      try {
        await ensureVendorExists({ userId: user.id, name: name || null });
      } catch (e) {
        // rollback auth user + profile if vendor creation fails (optional)
        await supabaseAdmin.auth.admin.deleteUser(user.id);
        await supabaseAdmin.from("profiles").delete().eq("id", user.id);
        return res.status(400).json({ message: "Vendor profile creation failed", error: String(e?.message || e) });
      }
    }

    return res.status(201).json({
      message: "Signup successful",
      user: profile,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

// POST /api/auth/login
// body: { email, password }
export async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    // ✅ normal login to get access token
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ message: "Invalid credentials", error });

    const accessToken = data?.session?.access_token;
    const user = data?.user;
    if (!accessToken || !user) return res.status(401).json({ message: "Login failed" });

    // ✅ FIX: if profile missing (old users), auto-create it instead of blocking login
    let profile;
    try {
      profile = await ensureProfileExists({
        userId: user.id,
        email: user.email,
        name: null,          // login doesn’t know name
        role: "customer",    // safe default for legacy users
      });
    } catch (e) {
      return res.status(500).json({ message: "Failed to load profile", error: String(e?.message || e) });
    }

    // ✅ If profile says vendor, ensure vendor row exists (prevents vendor pages breaking)
    if (profile?.role === "vendor") {
      try {
        await ensureVendorExists({ userId: user.id, name: profile.name || null });
      } catch {
        // don’t block login if vendor row missing; optional
      }
    }

    return res.json({
      message: "Login successful",
      token: accessToken,
      user: profile,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}

// GET /api/auth/me
export async function me(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, role")
      .eq("id", userId)
      .single();

    if (error) return res.status(404).json({ message: "Profile not found", error });

    return res.json({ user: profile });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
}