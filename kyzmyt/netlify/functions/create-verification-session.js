const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { userId } = JSON.parse(event.body);
    if (!userId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) };

    // Get user email from Supabase auth
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    if (!user) return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };

    // First create a Stripe checkout session to charge $5 for ID verification
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Kyzmyt Identity Verification', description: 'One-time identity verification fee' },
          unit_amount: 500 // $5.00
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/pages/verify.html?id_verified=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/pages/verify.html`,
      metadata: { userId, type: 'id_verification', email: user.email },
      customer_email: user.email
    });

    // Also create Stripe Identity session
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { userId },
      options: {
        document: {
          allowed_types: ['driving_license', 'passport', 'id_card'],
          require_id_number: false,
          require_live_capture: true,
          require_matching_selfie: true
        }
      },
      return_url: `${process.env.SITE_URL}/pages/verify.html?id_step=complete`
    });

    // Store the pending verification session ID
    await supabase.from('verifications').upsert({
      user_id: userId,
      stripe_identity_session_id: verificationSession.id,
      id_verified: false
    }, { onConflict: 'user_id' });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error('create-verification-session error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
