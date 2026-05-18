const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { sessionId, userId } = JSON.parse(event.body);
    if (!sessionId || !userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing sessionId or userId' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Verify the session with Stripe — never trust client-side payment claims
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return {
        statusCode: 200,
        body: JSON.stringify({ confirmed: false, reason: 'Payment not completed' })
      };
    }

    // Confirm the session belongs to this user
    if (session.metadata?.userId !== userId) {
      return {
        statusCode: 200,
        body: JSON.stringify({ confirmed: false, reason: 'Session mismatch' })
      };
    }

    // Mark has_paid in Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/verifications?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        has_paid: true,
        stripe_payment_session_id: sessionId,
        updated_at: new Date().toISOString()
      })
    });

    // If no verifications row exists yet, upsert it
    await fetch(`${SUPABASE_URL}/rest/v1/verifications`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        user_id: userId,
        has_paid: true,
        stripe_payment_session_id: sessionId,
        updated_at: new Date().toISOString()
      })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ confirmed: true })
    };

  } catch (err) {
    console.error('confirm-payment error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
