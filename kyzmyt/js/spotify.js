// js/spotify.js
// Spotify Web API integration for profile soundtrack feature
// Uses Authorization Code Flow with PKCE for client-side auth

const SPOTIFY_CLIENT_ID = window.ENV_SPOTIFY_CLIENT_ID || '';
const REDIRECT_URI = `${window.location.origin}/pages/profile.html?spotify=callback`;
const SCOPES = 'user-read-private user-top-read';

// ── PKCE Auth helpers ─────────────────────────────────────────────────────────

async function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function initiateSpotifyAuth() {
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('spotify_verifier', verifier);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function handleSpotifyCallback(code) {
  const verifier = sessionStorage.getItem('spotify_verifier');
  if (!verifier) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    })
  });

  const tokens = await res.json();
  if (tokens.access_token) {
    sessionStorage.setItem('spotify_token', tokens.access_token);
    sessionStorage.removeItem('spotify_verifier');
  }
  return tokens;
}

export async function getTopTracks(limit = 10) {
  const token = sessionStorage.getItem('spotify_token');
  if (!token) return [];

  const res = await fetch(`https://api.spotify.com/v1/me/top/tracks?limit=${limit}&time_range=short_term`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

export async function searchTrack(query) {
  const token = sessionStorage.getItem('spotify_token');
  if (!token) return [];

  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.tracks?.items || [];
}

export function renderTrackCard(track, onSelect) {
  const el = document.createElement('div');
  el.style.cssText = `
    display: flex; align-items: center; gap: 12px; padding: 10px 14px;
    background: white; border: 1px solid var(--border); border-radius: var(--radius-md);
    cursor: pointer; transition: all 0.2s; margin-bottom: 8px;
  `;
  el.onmouseenter = () => { el.style.borderColor = 'var(--copper)'; };
  el.onmouseleave = () => { el.style.borderColor = 'var(--border)'; };
  el.onclick = () => onSelect(track);

  const img = track.album.images[2]?.url || track.album.images[0]?.url;
  el.innerHTML = `
    <img src="${img}" alt="${track.name}" style="width:40px;height:40px;border-radius:4px;flex-shrink:0" />
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:500;color:var(--navy);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${track.name}</div>
      <div style="font-size:12px;color:var(--text-muted)">${track.artists.map(a => a.name).join(', ')}</div>
    </div>
    <div style="font-size:11px;color:var(--text-muted)">${formatDuration(track.duration_ms)}</div>
  `;
  return el;
}

export function renderMiniPlayer(track) {
  return `
    <div style="background:var(--navy);border-radius:var(--radius-md);padding:12px 14px;display:flex;align-items:center;gap:12px">
      <img src="${track.album.images[2]?.url || track.album.images[0]?.url}" alt="${track.name}" style="width:40px;height:40px;border-radius:4px;flex-shrink:0" />
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${track.name}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.5)">${track.artists.map(a => a.name).join(', ')}</div>
      </div>
      <div style="color:var(--copper);font-size:20px">♪</div>
    </div>`;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
