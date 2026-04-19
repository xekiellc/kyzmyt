import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://gnknifxhzriqwugmvoxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BgWckBZrokjrV4LoaLSWBA_Ap5QTM3A';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/';
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    window.location.href = '/pages/signup.html';
    return null;
  }
  return user;
}

export async function requireVerified() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getProfile(user.id);
  if (!profile) {
    window.location.href = '/pages/signup.html?step=profile';
    return null;
  }
  if (!profile.is_verified) {
    window.location.href = '/pages/verify.html';
    return null;
  }
  // Update last_active
  await supabase.from('profiles').update({ last_active: new Date().toISOString() }).eq('user_id', user.id);
  return { user, profile };
}

// ── Profile helpers ───────────────────────────────────────────────────────────

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, verifications(*)')
    .eq('user_id', userId)
    .single();
  if (error) return null;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('user_id', userId)
    .select()
    .single();
  return { data, error };
}

export async function getVerification(userId) {
  const { data } = await supabase
    .from('verifications')
    .select('*')
    .eq('user_id', userId)
    .single();
  return data;
}

// ── Profile completeness ──────────────────────────────────────────────────────

export function calculateProfileCompleteness(profile, photoCount = 0) {
  const checks = [
    { key: 'bio', label: 'Add a bio', weight: 15 },
    { key: 'photos', label: 'Upload at least one photo', weight: 20 },
    { key: 'hot_takes', label: 'Add hot takes', weight: 10 },
    { key: 'politics', label: 'Add your politics', weight: 10 },
    { key: 'religion', label: 'Add your religion', weight: 10 },
    { key: 'love_language', label: 'Add your love language', weight: 10 },
    { key: 'attachment_style', label: 'Add your attachment style', weight: 10 },
    { key: 'dealbreakers', label: 'Set dealbreakers', weight: 10 },
    { key: 'current_obsession', label: 'Add your current obsession', weight: 5 },
  ];

  let score = 0;
  const missing = [];

  checks.forEach(c => {
    if (c.key === 'photos') {
      if (photoCount > 0) score += c.weight;
      else missing.push(c.label);
    } else if (c.key === 'hot_takes') {
      if (profile[c.key]?.length > 0) score += c.weight;
      else missing.push(c.label);
    } else if (c.key === 'dealbreakers') {
      if (profile[c.key]?.length > 0) score += c.weight;
      else missing.push(c.label);
    } else {
      if (profile[c.key]) score += c.weight;
      else missing.push(c.label);
    }
  });

  return { score, missing };
}

// ── Discover feed ─────────────────────────────────────────────────────────────

export async function getDiscoverFeed(userId, filters = {}) {
  // Get blocked user IDs
  const { data: blocks } = await supabase
    .from('blocks')
    .select('blocked_id, blocker_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  const blockedIds = (blocks || []).map(b =>
    b.blocker_id === userId ? b.blocked_id : b.blocker_id
  );

  // Get already liked user IDs
  const { data: liked } = await supabase
    .from('likes')
    .select('to_user')
    .eq('from_user', userId);

  const likedIds = (liked || []).map(l => l.to_user);
  const excludeIds = [...new Set([...blockedIds, ...likedIds, userId])];

  let query = supabase
    .from('profiles')
    .select('*, verifications(*), profile_photos(*)')
    .eq('is_visible', true)
    .neq('user_id', userId)
    .limit(filters.limit || 20);

  // Exclude blocked and already liked
  if (excludeIds.length > 0) {
    query = query.not('user_id', 'in', `(${excludeIds.join(',')})`);
  }

  if (filters.politics) query = query.eq('politics', filters.politics);
  if (filters.religion) query = query.eq('religion', filters.religion);
  if (filters.min_age) query = query.gte('age', filters.min_age);
  if (filters.max_age) query = query.lte('age', filters.max_age);

  const { data, error } = await query.order('last_active', { ascending: false, nullsFirst: false });
  return { data: data || [], error };
}

// ── Matching ──────────────────────────────────────────────────────────────────

export async function likeProfile(fromUserId, toUserId) {
  const { data, error } = await supabase
    .from('likes')
    .insert({ from_user: fromUserId, to_user: toUserId })
    .select()
    .single();
  if (error) return { matched: false, error };

  const { data: mutual } = await supabase
    .from('likes')
    .select('id')
    .eq('from_user', toUserId)
    .eq('to_user', fromUserId)
    .single();

  if (mutual) {
    await supabase.from('matches').insert({
      user_a: fromUserId,
      user_b: toUserId,
      matched_at: new Date().toISOString()
    });
    return { matched: true };
  }
  return { matched: false };
}

export async function getMatches(userId) {
  const { data } = await supabase
    .from('matches')
    .select('*, profiles!matches_user_a_fkey(*), profiles!matches_user_b_fkey(*)')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .is('unmatched_at', null)
    .order('matched_at', { ascending: false });
  return data || [];
}

export async function unmatch(matchId, userId) {
  const { error } = await supabase
    .from('matches')
    .update({ unmatched_at: new Date().toISOString(), unmatched_by: userId })
    .eq('id', matchId);
  return { error };
}

// ── Messaging ─────────────────────────────────────────────────────────────────

export async function getMessages(matchId) {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('match_id', matchId)
    .order('sent_at', { ascending: true });
  return data || [];
}

export async function sendMessage(matchId, senderId, content) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      match_id: matchId,
      sender_id: senderId,
      content,
      sent_at: new Date().toISOString()
    })
    .select()
    .single();
  return { data, error };
}

export async function markMessagesRead(matchId, userId) {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .neq('sender_id', userId)
    .is('read_at', null);
  return { error };
}

export function subscribeToMessages(matchId, callback) {
  return supabase
    .channel(`messages:${matchId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `match_id=eq.${matchId}`
    }, callback)
    .subscribe();
}

// ── Compatibility score ────────────────────────────────────────────────────────

export function calculateCompatibility(profileA, profileB) {
  let score = 0;
  let total = 0;

  const weights = {
    politics: 20,
    religion: 18,
    love_language: 15,
    attachment_style: 15,
    has_kids_pref: 12,
    diet: 5,
    exercise: 5,
    device_pref: 3,
    computer_pref: 3,
    music_taste: 4
  };

  for (const [key, weight] of Object.entries(weights)) {
    if (profileA[key] && profileB[key]) {
      total += weight;
      if (profileA[key] === profileB[key]) score += weight;
      else if (key === 'attachment_style') {
        if (profileA[key] === 'secure' || profileB[key] === 'secure') score += weight * 0.6;
      }
    }
  }

  const dealbreakersA = profileA.dealbreakers || [];
  const dealbreakersB = profileB.dealbreakers || [];
  const conflict = dealbreakersA.some(d => profileB[d] === true) ||
                   dealbreakersB.some(d => profileA[d] === true);
  if (conflict) return 0;

  return total > 0 ? Math.round((score / total) * 100) : 50;
}

// ── Active status ─────────────────────────────────────────────────────────────

export function getActiveStatus(lastActive) {
  if (!lastActive) return null;
  const diff = Date.now() - new Date(lastActive).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 5) return { label: 'Active now', color: '#4ade80' };
  if (mins < 60) return { label: `Active ${mins}m ago`, color: '#4ade80' };
  if (hours < 24) return { label: 'Active today', color: '#fbbf24' };
  if (days < 3) return { label: `Active ${days}d ago`, color: '#9ca3af' };
  return null;
}

// ── Community ─────────────────────────────────────────────────────────────────

export async function getForumPosts(category = null) {
  let query = supabase
    .from('forum_posts')
    .select('*, profiles(display_name, avatar_url, verifications(id_verified))')
    .order('created_at', { ascending: false })
    .limit(30);
  if (category) query = query.eq('category', category);
  const { data } = await query;
  return data || [];
}

export async function createForumPost(userId, title, body, category) {
  const { data, error } = await supabase
    .from('forum_posts')
    .insert({ user_id: userId, title, body, category })
    .select()
    .single();
  return { data, error };
}

// ── Date check-in ─────────────────────────────────────────────────────────────

export async function createCheckin(userId, matchId, checkinTime, trustedContact) {
  const { data, error } = await supabase
    .from('date_checkins')
    .insert({
      user_id: userId,
      match_id: matchId,
      checkin_time: checkinTime,
      trusted_contact: trustedContact,
      alerted: false,
      resolved: false
    })
    .select()
    .single();
  return { data, error };
}

// ── Stories ───────────────────────────────────────────────────────────────────

export async function getStories() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('stories')
    .select('*, profiles(display_name, avatar_url)')
    .gt('created_at', cutoff)
    .order('created_at', { ascending: false });
  return data || [];
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export function showToast(message, type = '') {
  const container = document.getElementById('toast-container') ||
    (() => {
      const el = document.createElement('div');
      el.id = 'toast-container';
      el.className = 'toast-container';
      document.body.appendChild(el);
      return el;
    })();

  const toast = document.createElement('div');
  toast.className = `toast ${type ? `toast-${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

export function formatRelativeTime(dateString) {
  if (!dateString) return '—';
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString();
}

export function getInitials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export function avatarColor(name) {
  const colors = ['var(--navy)', 'var(--copper)', '#2e7d32', '#1565c0', '#6a1b9a', '#c62828'];
  const idx = (name || '').charCodeAt(0) % colors.length;
  return colors[idx];
}
