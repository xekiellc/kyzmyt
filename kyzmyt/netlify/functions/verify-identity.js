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
    const { userId, email } = JSON.parse(event.body);
    if (!userId || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or email' }) };
    }

    // Check if already paid — don't double-charge
    const { data: existing } = await supabase
      .from('verifications')
      .select('has_paid')
      .eq('user_id', userId)
      .single();

    if (existing?.has_paid) {
      return {
        statusCode: 200,
        body: JSON.stringify({ already_paid: true, redirect: '/pages/verify.html' })
      };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Kyzmyt Identity Verification',
            description: 'One-time fee covers your full triple-layer verification — facial match, government ID scan, and criminal background check.'
          },
          unit_amount: 5499 // $54.99
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: email,
      success_url: `${process.env.SITE_URL}/pages/verify.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/pages/signup.html?payment=cancelled`,
      metadata: { userId, type: 'verification_fee' }
    });

    // Record pending payment in verifications table
    await supabase.from('verifications').upsert({
      user_id: userId,
      has_paid: false,
      stripe_payment_session_id: session.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };

  } catch (err) {
    console.error('create-signup-payment error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
