const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { userId, tier } = JSON.parse(event.body);
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    if (!user) return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };

    const prices = {
      member: process.env.STRIPE_PRICE_MEMBER,     // $29/month
      concierge: process.env.STRIPE_PRICE_CONCIERGE // $299/month
    };

    const priceId = prices[tier || 'member'];
    if (!priceId) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid tier' }) };

    // Create or get Stripe customer
    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id, display_name').eq('user_id', userId).single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.display_name,
        metadata: { userId }
      });
      customerId = customer.id;
      await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('user_id', userId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.SITE_URL}/pages/app.html?subscribed=true`,
      cancel_url: `${process.env.SITE_URL}/pages/profile.html`,
      metadata: { userId, type: 'subscription', tier },
      subscription_data: { metadata: { userId } }
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('create-subscription error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
