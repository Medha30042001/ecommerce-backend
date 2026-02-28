import { supabase, supabaseAdmin } from "../config/supabase.js";

const ALLOWED_ROLES = ["customer", "vendor", "admin"];

function isValidRole(role) {
  return ALLOWED_ROLES.includes(role);
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

    // ✅ Create auth user SERVER-SIDE (avoids email confirmation + rate-limit issues)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // ✅ important for smooth demo flow
    });

    if (error) return res.status(400).json({ message: "Signup failed", error });

    const user = data?.user;
    if (!user) return res.status(400).json({ message: "No user returned from Supabase" });

    // ✅ Create profile row
    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          name: name || null,
          email: user.email,
          role,
        },
        { onConflict: "id" }
      );

    if (profErr) {
      // rollback auth user if profile insert fails
      await supabaseAdmin.auth.admin.deleteUser(user.id);
      return res.status(400).json({ message: "Profile creation failed", error: profErr });
    }

    if (role === "vendor") {
      // create vendor row if not exists
      await supabaseAdmin
        .from("vendors")
        .upsert(
          {
            user_id: user.id,
            store_name: name ? `${name}'s Store` : "My Store",
          },
          { onConflict: "user_id" }
        );
    }

    // ✅ OPTIONAL (but useful): auto-create vendor row if role is vendor
    // If you already have a vendors table that links to user_id, uncomment this.
    /*
    if (role === "vendor") {
      const { error: vErr } = await supabaseAdmin.from("vendors").insert({
        user_id: user.id,
        store_name: name ? `${name}'s Store` : "New Vendor Store",
        is_active: true,
      });
      if (vErr) return res.status(400).json({ message: "Vendor profile creation failed", error: vErr });
    }
    */

    return res.status(201).json({
      message: "Signup successful",
      user: {
        id: user.id,
        email: user.email,
        role,
        name: name || null,
      },
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

    // ✅ normal login to get access token (session)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ message: "Invalid credentials", error });

    const accessToken = data?.session?.access_token;
    const user = data?.user;
    if (!accessToken || !user) return res.status(401).json({ message: "Login failed" });

    // ✅ fetch profile (admin client avoids any RLS issues)
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, role")
      .eq("id", user.id)
      .single();

    if (profErr) return res.status(403).json({ message: "Profile not found", error: profErr });

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