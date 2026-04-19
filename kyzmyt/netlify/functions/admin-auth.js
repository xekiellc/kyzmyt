export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { password } = await req.json();
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD');

  if (!ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (password !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = crypto.randomUUID();
  const expires = Date.now() + (8 * 60 * 60 * 1000);

  return new Response(JSON.stringify({ token, expires }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/.netlify/functions/admin-auth' };
