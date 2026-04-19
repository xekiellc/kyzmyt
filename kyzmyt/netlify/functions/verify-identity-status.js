// ── VERIFICATION STATUS CHECK ─────────────────────────────────────────────────
// Called by verify.html to show real-time status of all three layers
// Powers the progress UI on the verification page

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const userId = event.queryStringParameters?.userId;
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'userId required' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/verifications?user_id=eq.${userId}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });

  const data = await res.json();
  const verif = data[0];

  if (!verif) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not_started' })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: verif.overall_verified ? 'approved' :
              verif.flagged_for_review ? 'review' :
              verif.background_status === 'pending' ? 'pending' :
              'not_started',
      layers: {
        aws: { passed: verif.aws_facial_match, confidence: verif.aws_confidence },
        azure: { passed: verif.azure_facial_match, confidence: verif.azure_confidence },
        certn: { passed: verif.background_clear, status: verif.background_status }
      },
      id_verified: verif.id_verified,
      background_clear: verif.background_clear,
      overall_verified: verif.overall_verified,
      flagged_for_review: verif.flagged_for_review,
      failure_reason: verif.failure_reason
    })
  };
};
