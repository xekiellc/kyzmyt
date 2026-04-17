const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// CRITICAL: Use service role key — only this function writes to verifications
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify Checkr webhook signature
  const webhookSecret = process.env.CHECKR_WEBHOOK_SECRET;
  const signature = event.headers['x-checkr-signature'];

  if (webhookSecret && signature) {
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(event.body)
      .digest('hex');

    if (signature !== expectedSig) {
      console.error('Invalid Checkr webhook signature');
      return { statusCode: 401, body: 'Invalid signature' };
    }
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { type, data } = payload;
  console.log('Checkr webhook event:', type, data?.object?.id);

  switch (type) {
    case 'report.completed': {
      const report = data.object;
      const candidateId = report.candidate_id;
      const status = report.status; // 'clear', 'consider', 'suspended', 'dispute'
      const adjudication = report.adjudication; // 'engaged', 'pre_adverse_action', 'post_adverse_action'

      // Find user by Checkr candidate ID
      const { data: verif } = await supabase
        .from('verifications')
        .select('user_id')
        .eq('checkr_candidate_id', candidateId)
        .single();

      if (!verif) {
        console.error('No verification found for candidate:', candidateId);
        return { statusCode: 200, body: 'OK' };
      }

      const userId = verif.user_id;
      const isClear = status === 'clear';

      // Write result — tamper-proof via service role only
      await supabase.from('verifications').update({
        background_status: status,
        background_clear: isClear,
        background_completed_at: new Date().toISOString(),
        checkr_report_status: status,
        checkr_adjudication: adjudication
      }).eq('user_id', userId);

      if (isClear) {
        // Make profile visible
        await supabase.from('profiles').update({
          is_verified: true,
          is_visible: true
        }).eq('user_id', userId);

        // Send welcome email via Resend
        await sendVerifiedEmail(userId);

        console.log(`User ${userId} background check CLEARED`);
      } else {
        // Background not clear — cannot join
        await supabase.from('profiles').update({
          is_verified: false,
          is_visible: false,
          ban_reason: `Background check status: ${status}`
        }).eq('user_id', userId);

        console.log(`User ${userId} background check FAILED: ${status}`);
      }
      break;
    }

    case 'report.disputed': {
      const report = data.object;
      console.log('Background check disputed for report:', report.id);
      // Keep as pending, allow dispute process to complete
      break;
    }

    case 'candidate.created': {
      console.log('Candidate created:', data.object.id);
      break;
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendVerifiedEmail(userId) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', userId)
      .single();

    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    if (!user?.email) return;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Kyzmyt <hello@kyzmyt.com>',
        to: user.email,
        subject: '✓ You\'re verified — welcome to Kyzmyt',
        html: `
          <div style="font-family: 'Georgia', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #faf8f5;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="font-size: 36px; color: #0f1e3d; margin: 0;">Kyzm<span style="color: #B87333;">yt</span></h1>
            </div>
            <h2 style="color: #0f1e3d; font-size: 24px;">Hey ${profile?.display_name || 'there'},</h2>
            <p style="color: #4a5568; font-size: 15px; line-height: 1.7;">Your background check came back clear. You're now a fully verified Kyzmyt member.</p>
            <p style="color: #4a5568; font-size: 15px; line-height: 1.7;">Your profile is live and visible to other verified members near you. Go find your kyzmyt.</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${process.env.SITE_URL}/pages/app.html" style="background: #B87333; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 500;">Find My Kyzmyt →</a>
            </div>
            <p style="color: #8a97aa; font-size: 12px; text-align: center; margin-top: 32px;">Kyzmyt LLC · Northeast Ohio · <a href="${process.env.SITE_URL}/pages/privacy.html" style="color: #8a97aa;">Privacy Policy</a></p>
          </div>
        `
      })
    });
  } catch (err) {
    console.error('Failed to send verified email:', err);
  }
}
