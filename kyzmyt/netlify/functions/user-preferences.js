// netlify/functions/user-preferences.js
// Uses plain fetch() against Supabase's REST API instead of @supabase/supabase-js,
// to avoid that package's realtime-js module crashing on Netlify's Node runtime.

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
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing or invalid Authorization header' }) };
  }
  const token = authHeader.replace('Bearer ', '');

  const user = await getUserFromToken(token);
  if (!user || !user.id) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      // --- Load traits ---
      const traitsRows = await sbFetch(`/rest/v1/user_traits?user_id=eq.${user.id}&select=*`);
      const traitsRow = (traitsRows && traitsRows[0]) || {};

      // --- Load favorites (row-per-item) ---
      const favRows = await sbFetch(`/rest/v1/user_favorites?user_id=eq.${user.id}&select=category,value,position&order=position`);
      const favorites = {};
      (favRows || []).forEach(r => {
        if (!favorites[r.category]) favorites[r.category] = [];
        favorites[r.category].push(r.value);
      });

      // --- Load filters ---
      const filters = await sbFetch(`/rest/v1/match_filters?user_id=eq.${user.id}&select=filter_type,trait_key,accepted_values,favorite_category,priority`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          traits: traitsRow,
          favorites,
          filters: filters || []
        })
      };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { traits, favorites, filters } = body;

      // --- Upsert traits (single row per user) ---
      if (traits) {
        await sbFetch(`/rest/v1/user_traits`, {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ user_id: user.id, ...traits, updated_at: new Date().toISOString() })
        });
      }

      // --- Replace favorites (delete then bulk insert) ---
      if (favorites) {
        await sbFetch(`/rest/v1/user_favorites?user_id=eq.${user.id}`, { method: 'DELETE' });

        const favRows = [];
        Object.entries(favorites).forEach(([category, values]) => {
          (values || []).forEach((value, idx) => {
            favRows.push({
              user_id: user.id,
              category,
              value,
              value_normalized: String(value).toLowerCase().trim(),
              position: idx
            });
          });
        });

        if (favRows.length > 0) {
          await sbFetch(`/rest/v1/user_favorites`, {
            method: 'POST',
            body: JSON.stringify(favRows)
          });
        }
      }

      // --- Replace filters (delete then bulk insert) ---
      if (filters) {
        await sbFetch(`/rest/v1/match_filters?user_id=eq.${user.id}`, { method: 'DELETE' });

        if (filters.length > 0) {
          const filterRows = filters.map(f => ({
            user_id: user.id,
            filter_type: f.filter_type,
            trait_key: f.trait_key || null,
            accepted_values: f.accepted_values || null,
            favorite_category: f.favorite_category || null,
            priority: f.priority
          }));
          await sbFetch(`/rest/v1/match_filters`, {
            method: 'POST',
            body: JSON.stringify(filterRows)
          });
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('user-preferences error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Internal server error' }) };
  }
};
