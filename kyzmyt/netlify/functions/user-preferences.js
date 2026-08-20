// netlify/functions/user-preferences.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Verify the token and get the user
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      // --- Load traits ---
      const { data: traitsRow, error: traitsError } = await supabase
        .from('user_traits')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (traitsError) throw traitsError;

      // --- Load favorites (row-per-item) ---
      const { data: favRows, error: favError } = await supabase
        .from('user_favorites')
        .select('category, value, position')
        .eq('user_id', user.id)
        .order('position');
      if (favError) throw favError;

      const favorites = {};
      (favRows || []).forEach(r => {
        if (!favorites[r.category]) favorites[r.category] = [];
        favorites[r.category].push(r.value);
      });

      // --- Load filters ---
      const { data: filters, error: filtersError } = await supabase
        .from('match_filters')
        .select('filter_type, trait_key, accepted_values, favorite_category, priority')
        .eq('user_id', user.id);
      if (filtersError) throw filtersError;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          traits: traitsRow || {},
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
        const { error: traitsUpsertError } = await supabase
          .from('user_traits')
          .upsert({ user_id: user.id, ...traits, updated_at: new Date().toISOString() });
        if (traitsUpsertError) throw traitsUpsertError;
      }

      // --- Replace favorites (delete then bulk insert) ---
      if (favorites) {
        const { error: delFavError } = await supabase
          .from('user_favorites')
          .delete()
          .eq('user_id', user.id);
        if (delFavError) throw delFavError;

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
          const { error: insFavError } = await supabase.from('user_favorites').insert(favRows);
          if (insFavError) throw insFavError;
        }
      }

      // --- Replace filters (delete then bulk insert) ---
      if (filters) {
        const { error: delFilterError } = await supabase
          .from('match_filters')
          .delete()
          .eq('user_id', user.id);
        if (delFilterError) throw delFilterError;

        if (filters.length > 0) {
          const filterRows = filters.map(f => ({
            user_id: user.id,
            filter_type: f.filter_type,
            trait_key: f.trait_key || null,
            accepted_values: f.accepted_values || null,
            favorite_category: f.favorite_category || null,
            priority: f.priority
          }));
          const { error: insFilterError } = await supabase.from('match_filters').insert(filterRows);
          if (insFilterError) throw insFilterError;
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
