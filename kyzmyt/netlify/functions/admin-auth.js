exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { password } = JSON.parse(event.body);
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server misconfigured' })
    };
  }

  if (password !== ADMIN_PASSWORD) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid password' })
    };
  }

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const expires = Date.now() + (8 * 60 * 60 * 1000);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, expires })
  };
};
