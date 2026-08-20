// netlify/functions/get-filtered-matches.js
// GET → returns visible candidates for the logged-in user,
//       filtered by dealbreakers (mutual) and scored 0–100
//
// Rules:
//   - Candidates must have a visible profile (is_visible = true)
//     — verification/payment gates DETAIL shown, not whether a
//     candidate appears at all (free tier = locked cards, still searchable)
//   - Caller's dealbreakers exclude candidates
//   - Candidates' dealbreakers exclude the caller (mutual respect)
//   - must_have match  = +15, nice_to_have match = +5
//   - shared favorites = +3 each (max +15 total)
//   - Free (unpaid) callers: names + photos stripped server-side
//
// Uses plain fetch() against Supabase's REST API instead of
// @supabase/supabase-js — that package's realtime-js module crashes
// on Netlify's Node runtime (same issue fixed in user-preferences.js).
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHARED_FAV_POINTS = 3;
const SHARED_FAV_CAP = 15;
const MUST_HAVE_POINTS = 15;
const NICE_TO_HAVE_POINTS = 5;
const MAX_RESULTS = 50;

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

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // ---- authenticate caller ----
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not signed in' }) };
    }
    const authUser = await getUserFromToken(token);
    if (!authUser || !authUser.id) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
    }
    const callerId = authUser.id;

    // ---- caller's verification / payment status ----
    const callerVerifRows = await sbFetch(`/rest/v1/verifications?user_id=eq.${callerId}&select=overall_verified,has_paid`);
    const callerVerif = (callerVerifRows && callerVerifRows[0]) || null;
    const callerVerified = !!(callerVerif && callerVerif.overall_verified && callerVerif.has_paid);

    // ---- visible candidate pool (verification/payment gates DETAIL, not eligibility) ----
    const visibleProfiles = await sbFetch(`/rest/v1/profiles?is_visible=eq.true&user_id=neq.${callerId}&select=user_id`);
    const candidateIds = (visibleProfiles || []).map(r => r.user_id);
    if (candidateIds.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ caller_verified: callerVerified, matches: [] }) };
    }

    // ---- candidates' verification status (for display only, not eligibility) ----
    const candVerifRows = await sbFetch(`/rest/v1/verifications?user_id=in.(${candidateIds.join(',')})&select=user_id,overall_verified`);
    const verifiedByUser = {};
    (candVerifRows || []).forEach(v => { verifiedByUser[v.user_id] = !!v.overall_verified; });

    // ---- bulk-load everything ----
    const allIds = [callerId, ...candidateIds];
    const idList = allIds.join(',');

    const [traitRows, favRows, filterRows] = await Promise.all([
      sbFetch(`/rest/v1/user_traits?user_id=in.(${idList})&select=*`),
      sbFetch(`/rest/v1/user_favorites?user_id=in.(${idList})&select=user_id,category,value_normalized`),
      sbFetch(`/rest/v1/match_filters?user_id=in.(${idList})&select=user_id,filter_type,trait_key,accepted_values,favorite_category,priority`)
    ]);

    const traitsByUser = {};
    (traitRows || []).forEach(t => { traitsByUser[t.user_id] = t; });

    const favsByUser = {}; // user_id -> { category -> Set(normalized values) }
    (favRows || []).forEach(f => {
      if (!favsByUser[f.user_id]) favsByUser[f.user_id] = {};
      if (!favsByUser[f.user_id][f.category]) favsByUser[f.user_id][f.category] = new Set();
      favsByUser[f.user_id][f.category].add(f.value_normalized);
    });

    const filtersByUser = {};
    (filterRows || []).forEach(fl => {
      if (!filtersByUser[fl.user_id]) filtersByUser[fl.user_id] = [];
      filtersByUser[fl.user_id].push(fl);
    });

    const callerTraits = traitsByUser[callerId] || {};
    const callerFavs = favsByUser[callerId] || {};
    const callerFilters = filtersByUser[callerId] || [];
    const callerHasFavorites = Object.keys(callerFavs).length > 0;

    // ---- helpers ----
    const sharedCount = (favsA, favsB, category) => {
      const a = favsA[category];
      const b = favsB[category];
      if (!a || !b) return 0;
      let n = 0;
      a.forEach(v => { if (b.has(v)) n++; });
      return n;
    };

    const passesDealbreakers = (filters, subjectTraits, subjectFavs, ownerFavs) => {
      for (const fl of filters) {
        if (fl.priority !== 'dealbreaker') continue;
        if (fl.filter_type === 'trait') {
          const val = subjectTraits ? subjectTraits[fl.trait_key] : null;
          // unanswered trait cannot be confirmed → fails a dealbreaker
          if (!val || !(fl.accepted_values || []).includes(val)) return false;
        } else if (fl.filter_type === 'favorite_category') {
          if (sharedCount(ownerFavs, subjectFavs, fl.favorite_category) === 0) return false;
        }
      }
      return true;
    };

    // ---- score each candidate ----
    const results = [];
    for (const candId of candidateIds) {
      const candTraits = traitsByUser[candId] || null;
      const candFavs = favsByUser[candId] || {};
      const candFilters = filtersByUser[candId] || [];

      // 1. caller's dealbreakers vs candidate
      if (!passesDealbreakers(callerFilters, candTraits, candFavs, callerFavs)) continue;
      // 2. candidate's dealbreakers vs caller (mutual)
      if (!passesDealbreakers(candFilters, callerTraits, callerFavs, candFavs)) continue;

      // 3. score
      let raw = 0;
      let max = 0;

      for (const fl of callerFilters) {
        if (fl.priority === 'dealbreaker') continue;
        const pts = fl.priority === 'must_have' ? MUST_HAVE_POINTS : NICE_TO_HAVE_POINTS;
        max += pts;
        if (fl.filter_type === 'trait') {
          const val = candTraits ? candTraits[fl.trait_key] : null;
          if (val && (fl.accepted_values || []).includes(val)) raw += pts;
        } else if (fl.filter_type === 'favorite_category') {
          if (sharedCount(callerFavs, candFavs, fl.favorite_category) > 0) raw += pts;
        }
      }

      if (callerHasFavorites) {
        max += SHARED_FAV_CAP;
        let favPts = 0;
        for (const cat of Object.keys(callerFavs)) {
          favPts += sharedCount(callerFavs, candFavs, cat) * SHARED_FAV_POINTS;
        }
        raw += Math.min(favPts, SHARED_FAV_CAP);
      }

      const score = max > 0 ? Math.round((raw / max) * 100) : null;

      results.push({ user_id: candId, compatibility: score, verified: !!verifiedByUser[candId] });
    }

    // sort: scored first (high→low), unscored last
    results.sort((a, b) => (b.compatibility ?? -1) - (a.compatibility ?? -1));
    const top = results.slice(0, MAX_RESULTS);

    // ---- attach display data (best-effort from profiles table) ----
    let profilesById = {};
    try {
      const topIds = top.map(r => r.user_id);
      if (topIds.length > 0) {
        const profRows = await sbFetch(`/rest/v1/profiles?user_id=in.(${topIds.join(',')})&select=*`);
        (profRows || []).forEach(p => { profilesById[p.user_id] = p; });
      }
    } catch (e) {
      console.warn('profiles lookup skipped:', e.message);
    }

    const matches = top.map(r => {
      const p = profilesById[r.user_id] || {};
      const name = p.display_name || p.first_name || p.name || null;
      const photo = p.photo_url || p.avatar_url ||
        (Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null);
      if (callerVerified) {
        return { ...r, name, photo, age: p.age || null, city: p.city || null };
      }
      // FREE CALLER: real score, anonymous card — no name, no photo
      return { ...r, name: null, photo: null, age: p.age || null, city: p.city || null, locked: true };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ caller_verified: callerVerified, matches }) };
  } catch (err) {
    console.error('get-filtered-matches error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
