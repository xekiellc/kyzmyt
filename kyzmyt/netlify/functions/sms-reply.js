const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Handles incoming SMS replies from users confirming they're safe
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const params = new URLSearchParams(event.body);
  const from = params.get('From');
  const body = params.get('Body')?.trim().toUpperCase();

  if (!from) return { statusCode: 400, body: 'Missing From' };

  const safeKeywords = ['SAFE', 'OK', 'OKAY', 'YES', 'IM OK', "I'M OK", "I'M SAFE", 'ALL GOOD'];
  const isSafe = safeKeywords.some(k => body?.includes(k));

  if (isSafe) {
    // Find active check-in for this phone number
    const { data: checkins } = await supabase
      .from('date_checkins')
      .select('id, user_id')
      .eq('resolved', false)
      .eq('user_phone', from);

    if (checkins?.length) {
      await supabase.from('date_checkins').update({
        resolved: true,
        responded_at: new Date().toISOString(),
        response: body
      }).eq('id', checkins[0].id);
    }
  }

  // Respond with TwiML
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: isSafe
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>✓ Glad you're safe! Your check-in has been confirmed and your trusted contact has been notified. — Kyzmyt Safety Team</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Reply SAFE to confirm you're okay, or we'll contact your trusted contact. — Kyzmyt</Message></Response>`
  };
};
