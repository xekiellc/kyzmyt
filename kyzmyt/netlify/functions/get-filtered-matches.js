// netlify/functions/get-filtered-matches.js
// Returns a scored, filtered list of verified candidates for the caller's discover feed.
// Uses plain fetch() against Supabase's REST API (same pattern as user-preferences.js —
// avoids @supabase/supabase-js's realtime-js crash on Netlify's Node runtime).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${options.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return null;
}

async function getUserFromToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return res.json();
}

// Trait keys that live in user_traits and are eligible for trait-type match_filters.
const TRAIT_KEYS = new Set([
  'religion', 'chronotype', 'social_energy', 'pet_person', 'political_comfort',
  'kids_preference', 'pineapple_pizza', 'beach_or_mountains', 'coffee_or_tea',
  'texter_or_caller', 'planner_or_spontaneous'
]);

// Dealbreaker keys with a real data source. Four dealbreaker options in the UI
// (long_distance, no_reading, bad_tipper, talks_movies) have no backing column
// anywhere in the schema and are intentionally NOT enforced here — they're
// no-ops rather than guessed logic. Revisit if that data gets added later.
function candidateFailsDealbreaker(key, caller, candidate, candidateTraits) {
  switch (key) {
    case 'smoker': return candidate.smoker === true;
    case 'heavy_drinker': return candidate.heavy_drinker === true;
    case 'has_kids': return candidate.has_kids === true;
    case 'wants_kids': return candidate.wants_kids === true;
    case 'diff_religion': return !!caller.religion && !!candidate.religion && caller.religion !== candidate.religion;
    case 'diff_politics': return !!caller.politics && !!candidate.politics && caller.politics !== candidate.politics;
    case 'no_pets': return candidateTraits?.pet_person === 'neither';
    case 'pineapple_pizza': return candidateTraits?.pineapple_pizza === 'yes';
    default: return false; // unsupported dealbreaker key — no-op
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing or invalid Authorization header' }) };
  }
  const token = authHeader.replace('Bearer ', '');

  const authUser = await getUserFromToken(token);
  if (!authUser || !authUser.id) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }
  const callerId = authUser.id;

  try {
    // --- Caller's own profile, filters, traits, favorites ---
    const callerRows = await sbFetch(`/rest/v1/profiles?user_id=eq.${callerId}&select=*`);
    const caller = (callerRows && callerRows[0]) || null;
    if (!caller) {
      return { statusCode: 200, headers, body: JSON.stringify({ caller_verified: false, matches: [] }) };
    }
    const callerVerified = caller.is_verified === true;

    const callerFilters = await sbFetch(`/rest/v1/match_filters?user_id=eq.${callerId}&select=*`);
    const callerTraitRows = await sbFetch(`/rest/v1/user_traits?user_id=eq.${callerId}&select=*`);
    const callerTraits = (callerTraitRows && callerTraitRows[0]) || {};
    const callerFavRows = await sbFetch(`/rest/v1/user_favorites?user_id=eq.${callerId}&select=category,value_normalized`);
    const callerFavByCategory = {};
    (callerFavRows || []).forEach(r => {
      if (!callerFavByCategory[r.category]) callerFavByCategory[r.category] = new Set();
      callerFavByCategory[r.category].add(r.value_normalized);
    });

    const callerDealbreakers = Array.isArray(caller.dealbreakers) ? caller.dealbreakers : [];

    // --- Candidate pool: visible, not banned, not self, opposite of caller's "seeking" ---
    const genderMap = { men: 'man', women: 'woman' };
    let candidateQuery = `/rest/v1/profiles?select=*&is_visible=eq.true&is_verified=eq.true&banned_at=is.null&user_id=neq.${callerId}`;
    if (caller.seeking && genderMap[caller.seeking]) {
      candidateQuery += `&gender=eq.${genderMap[caller.seeking]}`;
    }
    candidateQuery += `&limit=100`;

    const candidates = await sbFetch(candidateQuery);
    if (!candidates || candidates.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ caller_verified: callerVerified, matches: [] }) };
    }

    const candidateIds = candidates.map(c => c.user_id);
    const idList = candidateIds.join(',');

    // --- Batch-fetch traits, favorites, and primary photos for all candidates ---
    const allTraitRows = await sbFetch(`/rest/v1/user_traits?user_id=in.(${idList})&select=*`);
    const traitsByUser = {};
    (allTraitRows || []).forEach(r => { traitsByUser[r.user_id] = r; });

    const allFavRows = await sbFetch(`/rest/v1/user_favorites?user_id=in.(${idList})&select=user_id,category,value_normalized`);
    const favByUser = {};
    (allFavRows || []).forEach(r => {
      if (!favByUser[r.user_id]) favByUser[r.user_id] = {};
      if (!favByUser[r.user_id][r.category]) favByUser[r.user_id][r.category] = new Set();
      favByUser[r.user_id][r.category].add(r.value_normalized);
    });

    const photoRows = await sbFetch(`/rest/v1/profile_photos?user_id=in.(${idList})&is_primary=eq.true&select=user_id,url`);
    const photoByUser = {};
    (photoRows || []).forEach(r => { photoByUser[r.user_id] = r.url; });

    // --- Score each candidate ---
    const scored = [];
    for (const candidate of candidates) {
      const candidateTraits = traitsByUser[candidate.user_id] || {};
      const candidateFavs = favByUser[candidate.user_id] || {};

      // Hard dealbreaker exclusion (caller's dealbreakers checked against candidate)
      let excluded = callerDealbreakers.some(key =>
        candidateFailsDealbreaker(key, caller, candidate, candidateTraits)
      );
      if (excluded) continue;

      let score = 0;

      // Trait-type and favorite_category-type filters
      for (const f of (callerFilters || [])) {
        if (f.priority === 'off') continue;

        if (f.filter_type === 'trait' && TRAIT_KEYS.has(f.trait_key)) {
          const candidateVal = candidateTraits[f.trait_key];
          const accepted = Array.isArray(f.accepted_values) ? f.accepted_values : [];
          const matches = candidateVal != null && accepted.includes(candidateVal);
          if (f.priority === 'dealbreaker' && !matches) { excluded = true; break; }
          if (f.priority === 'must_have' && matches) score += 15;
          if (f.priority === 'nice_to_have' && matches) score += 5;
        }

        if (f.filter_type === 'favorite_category' && f.favorite_category) {
          const callerSet = callerFavByCategory[f.favorite_category] || new Set();
          const candidateSet = candidateFavs[f.favorite_category] || new Set();
          const hasSharedFavorite = [...callerSet].some(v => candidateSet.has(v));
          if (f.priority === 'dealbreaker' && !hasSharedFavorite) { excluded = true; break; }
          if (f.priority === 'must_have' && hasSharedFavorite) score += 15;
          if (f.priority === 'nice_to_have' && hasSharedFavorite) score += 5;
        }
      }
      if (excluded) continue;

      // General shared-favorite bonus: +3 per shared favorite item across ALL
      // categories (not just filtered ones), capped at +15 total.
      let sharedCount = 0;
      for (const category of Object.keys(callerFavByCategory)) {
        const callerSet = callerFavByCategory[category];
        const candidateSet = candidateFavs[category] || new Set();
        for (const v of callerSet) {
          if (candidateSet.has(v)) sharedCount++;
        }
      }
      score += Math.min(sharedCount * 3, 15);

      score = Math.max(0, Math.min(100, Math.round(score)));

      const locked = !callerVerified;
      scored.push({
        user_id: candidate.user_id,
        compatibility: score,
        locked,
        name: locked ? null : (candidate.display_name || null),
        photo: locked ? null : (photoByUser[candidate.user_id] || candidate.avatar_url || null),
        age: candidate.age || null,
        city: candidate.city || null
      });
    }

    scored.sort((a, b) => b.compatibility - a.compatibility);
    const top = scored.slice(0, 30);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ caller_verified: callerVerified, matches: top })
    };
  } catch (err) {
    console.error('get-filtered-matches error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal server error' }) };
  }
};
