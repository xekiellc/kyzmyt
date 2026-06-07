// ============================================================
// KYZMYT — user-preferences.js
// GET  → returns the logged-in user's traits, favorites, filters
// POST → saves traits, favorites, filters (full replace)
// Auth: Supabase JWT in Authorization header
// DB:   service role key (tables are RLS-locked to service role)
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const TRAIT_KEYS = [
  "religion", "chronotype", "social_energy", "pet_person",
  "political_comfort", "kids_preference", "pineapple_pizza",
  "beach_or_mountains", "coffee_or_tea", "texter_or_caller",
  "planner_or_spontaneous", "goodreads_url"
];

const CATEGORIES = [
  "books", "movies", "tv_shows", "music_genres", "bands", "actors",
  "sports_teams", "athletes", "foods", "restaurants", "vacation_spots"
];

const PRIORITIES = ["dealbreaker", "must_have", "nice_to_have"];

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ---- authenticate the caller ----
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Not signed in" }) };
    }
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData || !userData.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid session" }) };
    }
    const userId = userData.user.id;

    // ========================================================
    // GET — load everything
    // ========================================================
    if (event.httpMethod === "GET") {
      const [traitsRes, favsRes, filtersRes] = await Promise.all([
        supabase.from("user_traits").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("user_favorites").select("category, value, position")
          .eq("user_id", userId).order("position", { ascending: true }),
        supabase.from("match_filters")
          .select("filter_type, trait_key, accepted_values, favorite_category, priority")
          .eq("user_id", userId)
      ]);

      if (traitsRes.error) throw traitsRes.error;
      if (favsRes.error) throw favsRes.error;
      if (filtersRes.error) throw filtersRes.error;

      const favorites = {};
      CATEGORIES.forEach((c) => (favorites[c] = []));
      (favsRes.data || []).forEach((row) => {
        if (favorites[row.category]) favorites[row.category].push(row.value);
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          traits: traitsRes.data || {},
          favorites,
          filters: filtersRes.data || []
        })
      };
    }

    // ========================================================
    // POST — save everything (full replace)
    // ========================================================
    if (event.httpMethod === "POST") {
      let payload;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) };
      }

      // ---- 1. traits (whitelisted keys only) ----
      const traitsIn = payload.traits || {};
      const traitsRow = { user_id: userId };
      TRAIT_KEYS.forEach((k) => {
        traitsRow[k] = traitsIn[k] === undefined || traitsIn[k] === "" ? null : traitsIn[k];
      });
      const { error: traitsErr } = await supabase
        .from("user_traits")
        .upsert(traitsRow, { onConflict: "user_id" });
      if (traitsErr) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Trait save failed: " + traitsErr.message }) };
      }

      // ---- 2. favorites (delete then insert) ----
      const favsIn = payload.favorites || {};
      const favRows = [];
      CATEGORIES.forEach((cat) => {
        const list = Array.isArray(favsIn[cat]) ? favsIn[cat] : [];
        const seen = new Set();
        list.slice(0, 10).forEach((val, i) => {
          if (typeof val !== "string") return;
          const clean = val.trim().slice(0, 80);
          const norm = clean.toLowerCase();
          if (!clean || seen.has(norm)) return;
          seen.add(norm);
          favRows.push({ user_id: userId, category: cat, value: clean, position: i });
        });
      });
      const { error: delFavErr } = await supabase
        .from("user_favorites").delete().eq("user_id", userId);
      if (delFavErr) throw delFavErr;
      if (favRows.length > 0) {
        const { error: insFavErr } = await supabase.from("user_favorites").insert(favRows);
        if (insFavErr) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Favorites save failed: " + insFavErr.message }) };
        }
      }

      // ---- 3. match filters (delete then insert) ----
      const filtersIn = Array.isArray(payload.filters) ? payload.filters : [];
      const filterRows = [];
      filtersIn.forEach((f) => {
        if (!PRIORITIES.includes(f.priority)) return;
        if (f.filter_type === "trait") {
          if (!TRAIT_KEYS.includes(f.trait_key) || f.trait_key === "goodreads_url") return;
          const accepted = Array.isArray(f.accepted_values)
            ? f.accepted_values.filter((v) => typeof v === "string").slice(0, 20)
            : [];
          if (accepted.length === 0) return;
          filterRows.push({
            user_id: userId,
            filter_type: "trait",
            trait_key: f.trait_key,
            accepted_values: accepted,
            favorite_category: null,
            priority: f.priority
          });
        } else if (f.filter_type === "favorite_category") {
          if (!CATEGORIES.includes(f.favorite_category)) return;
          filterRows.push({
            user_id: userId,
            filter_type: "favorite_category",
            trait_key: null,
            accepted_values: null,
            favorite_category: f.favorite_category,
            priority: f.priority
          });
        }
      });
      const { error: delFilErr } = await supabase
        .from("match_filters").delete().eq("user_id", userId);
      if (delFilErr) throw delFilErr;
      if (filterRows.length > 0) {
        const { error: insFilErr } = await supabase.from("match_filters").insert(filterRows);
        if (insFilErr) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Filter save failed: " + insFilErr.message }) };
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("user-preferences error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error" }) };
  }
};
