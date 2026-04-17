// ── stripe-webhook.js ── handles Stripe payment confirmations
// File: netlify/functions/stripe-webhook.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  const session = stripeEvent.data.object;

  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const userId = session.metadata?.userId;
      const type = session.metadata?.type;

      if (!userId) break;

      if (type === 'background_check') {
        // Trigger Checkr background check
        await triggerCheckrCheck(userId, session.metadata?.email);
        await supabase.from('verifications').upsert({
          user_id: userId,
          background_status: 'pending',
          background_paid_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      }

      if (type === 'financial_badge') {
        // Plaid verification initiated separately
        await supabase.from('verifications').upsert({
          user_id: userId,
          financial_paid: true
        }, { onConflict: 'user_id' });
      }

      if (type === 'subscription') {
        await supabase.from('subscriptions').upsert({
          user_id: userId,
          stripe_subscription_id: session.subscription,
          status: 'active',
          started_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        await supabase.from('profiles').update({ is_subscriber: true }).eq('user_id', userId);
      }
      break;
    }

    case 'identity.verification_session.verified': {
      const userId = session.metadata?.userId;
      if (userId) {
        await supabase.from('verifications').upsert({
          user_id: userId,
          id_verified: true,
          id_verified_at: new Date().toISOString(),
          photo_real: true
        }, { onConflict: 'user_id' });
      }
      break;
    }

    case 'identity.verification_session.requires_input': {
      const userId = session.metadata?.userId;
      if (userId) {
        await supabase.from('verifications').upsert({
          user_id: userId,
          id_verified: false,
          id_fail_reason: session.last_error?.reason
        }, { onConflict: 'user_id' });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const userId = session.metadata?.userId;
      if (userId) {
        await supabase.from('subscriptions').update({ status: 'cancelled' }).eq('stripe_subscription_id', session.id);
        await supabase.from('profiles').update({ is_subscriber: false, is_visible: false }).eq('user_id', userId);
      }
      break;
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function triggerCheckrCheck(userId, email) {
  const res = await fetch('https://api.checkr.com/v1/candidates', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(process.env.CHECKR_API_KEY + ':').toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email })
  });
  const candidate = await res.json();

  const reportRes = await fetch('https://api.checkr.com/v1/reports', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(process.env.CHECKR_API_KEY + ':').toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      package: 'driver_pro',
      candidate_id: candidate.id,
      tags: [`kyzmyt_user_${userId}`]
    })
  });
  const report = await reportRes.json();

  await supabase.from('verifications').upsert({
    user_id: userId,
    checkr_candidate_id: candidate.id,
    checkr_report_id: report.id,
    background_status: 'pending'
  }, { onConflict: 'user_id' });
}
