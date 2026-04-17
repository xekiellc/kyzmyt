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

    // Confirm ID is verified before allowing background check purchase
    const { data: verif } = await supabase
      .from('verifications')
      .select('id_verified')
      .eq('user_id', userId)
      .single();

    if (!verif?.id_verified) {
      return { statusCode: 403, body: JSON.stringify({ error: 'ID verification required before background check' }) };
    }

    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    if (!user) return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Kyzmyt Background Check',
            description: 'Comprehensive national criminal background check via Checkr. Results are tamper-proof and sent directly to our servers.'
          },
          unit_amount: 3000 // $30.00
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/pages/verify.html?bg_paid=true`,
      cancel_url: `${process.env.SITE_URL}/pages/verify.html`,
      metadata: { userId, type: 'background_check', email: user.email },
      customer_email: user.email
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: session.url })
    };
  } catch (err) {
    console.error('create-background-check error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
