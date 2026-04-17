// netlify/edge-functions/og-inject.js
// Injects dynamic OG meta tags for profile sharing links
// Configure in netlify.toml: [[edge_functions]] function = "og-inject" path = "/share/*"

export default async (request, context) => {
  const url = new URL(request.url);
  const segments = url.pathname.split('/');
  const profileId = segments[2]; // /share/{profileId}

  // Fetch profile data
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

  let ogTitle = 'Kyzmyt — Real People. Verified Lives.';
  let ogDesc = 'The dating platform where everyone is background checked and ID verified.';
  let ogImage = `${url.origin}/assets/og-default.png`;

  if (profileId) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${profileId}&select=display_name,age,status_label,bio&is_visible=eq.true`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      const [profile] = await res.json();
      if (profile) {
        ogTitle = `${profile.display_name}, ${profile.age} — Kyzmyt Verified Member`;
        ogDesc = profile.bio || `${profile.status_label?.replace(/_/g, ' ')} · Verified on Kyzmyt`;
        ogImage = `${url.origin}/assets/og-profile.png`;
      }
    } catch (e) {
      // Use defaults
    }
  }

  const response = await context.next();
  const html = await response.text();

  const injected = html.replace(
    '</head>',
    `
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:type" content="profile" />
  <meta property="og:url" content="${request.url}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  <meta name="twitter:image" content="${ogImage}" />
</head>`
  );

  return new Response(injected, {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
};
