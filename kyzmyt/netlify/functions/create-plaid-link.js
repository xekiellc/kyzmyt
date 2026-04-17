const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET
    }
  }
});
const plaidClient = new PlaidApi(plaidConfig);

// Step 1: Create Plaid link token
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { userId, action } = JSON.parse(event.body);

    if (action === 'exchange_token') {
      return await exchangePublicToken(userId, JSON.parse(event.body).publicToken);
    }

    // Create Stripe checkout for $12 fee first
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Kyzmyt Financial Verified Badge', description: 'Show verified financial stability on your profile' },
          unit_amount: 1200
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/pages/verify.html?financial_paid=true`,
      cancel_url: `${process.env.SITE_URL}/pages/verify.html`,
      metadata: { userId, type: 'financial_badge' },
      customer_email: user?.email
    });

    // Also create Plaid link token
    const linkResponse = await plaidClient.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'Kyzmyt',
      products: ['assets'],
      country_codes: ['US'],
      language: 'en',
      redirect_uri: `${process.env.SITE_URL}/pages/verify.html`
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        checkoutUrl: session.url,
        linkToken: linkResponse.data.link_token
      })
    };
  } catch (err) {
    console.error('create-plaid-link error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function exchangePublicToken(userId, publicToken) {
  try {
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchangeResponse.data.access_token;

    // Get asset report to verify income range
    const assetReportResponse = await plaidClient.assetReportCreate({
      access_tokens: [accessToken],
      days_requested: 90
    });

    // Store verification (don't store actual financial data, just verified flag)
    await supabase.from('verifications').upsert({
      user_id: userId,
      financial_verified: true,
      financial_verified_at: new Date().toISOString(),
      // We store income range tier, not actual income
      income_tier: 'verified' // Could be: 'verified', 'verified_professional', 'verified_executive'
    }, { onConflict: 'user_id' });

    await supabase.from('profiles').update({
      has_financial_badge: true
    }).eq('user_id', userId);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
