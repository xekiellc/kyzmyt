// ── CERTN WEBHOOK ─────────────────────────────────────────────────────────────
// Certn calls this automatically when a background check completes
// Updates Supabase and either approves the member or flags them
// Zero manual intervention for standard clear/not-clear results

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const orderId = payload.id || payload.order_id;
  const status = payload.status;
  const userId = payload.external_id;
  const result = payload.result;

  if (!userId) {
    console.error('No external_id in Certn webhook payload');
    return { statusCode: 400, body: 'Missing external_id' };
  }

  const backgroundClear = result === 'CLEAR';
  const flaggedForReview = result === 'CONSIDER';
  const permanentBlock = result === 'SUSPENDED';

  await fetch(`${SUPABASE_URL}/rest/v1/verifications?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      background_status: status?.toLowerCase() || 'complete',
      background_clear: backgroundClear,
      background_completed_at: new Date().toISOString(),
      flagged_for_review: flaggedForReview,
      certn_result: result,
      certn_order_id: orderId,
      updated_at: new Date().toISOString()
    })
  });

  if (backgroundClear) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        is_verified: true,
        is_visible: true,
        verified_at: new Date().toISOString()
      })
    });

    await sendVerificationEmail(userId, 'approved');
  }

  if (permanentBlock) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        is_verified: false,
        is_visible: false,
        ban_reason: 'Background check: serious offense detected',
        banned_at: new Date().toISOString()
      })
    });

    await sendVerificationEmail(userId, 'rejected');
  }

  if (flaggedForReview) {
    await sendVerificationEmail(userId, 'review');
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, userId, result, backgroundClear })
  };
};

async function sendVerificationEmail(userId, outcome) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return;

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=display_name,email`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });

  const profiles = await profileRes.json();
  const profile = profiles[0];
  if (!profile?.email) return;

  const subjects = {
    approved: 'Welcome to Kyzmyt — You\'re verified ✦',
    rejected: 'Your Kyzmyt application',
    review: 'Your Kyzmyt verification is under review'
  };

  const bodies = {
    approved: `Hi ${profile.display_name || 'there'},\n\nYou've passed all three verification layers — government ID match, facial recognition, and background check. Your profile is now live.\n\nWelcome to Kyzmyt. You're among the first.\n\nFind your Kyzmyt → https://kyzmyt.com/pages/app.html`,
    rejected: `Hi ${profile.display_name || 'there'},\n\nAfter reviewing your background check, we're unable to approve your membership at this time.\n\nIf you believe this is an error, please contact us at hello@kyzmyt.com.\n\nKyzmyt Team`,
    review: `Hi ${profile.display_name || 'there'},\n\nYour verification is currently under review by our team. We'll be in touch within 24-48 hours.\n\nKyzmyt Team`
  };

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Kyzmyt <hello@kyzmyt.com>',
      to: profile.email,
      subject: subjects[outcome],
      text: bodies[outcome]
    })
  });
}
