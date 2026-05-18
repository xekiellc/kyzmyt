exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const userId = event.queryStringParameters?.userId;
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'userId required' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
      body: JSON.stringify({
        status: 'not_started',
        has_paid: false
      })
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
      has_paid: verif.has_paid === true,
      layers: {
        aws: { passed: verif.aws_facial_match, confidence: verif.aws_confidence },
        stripe: { passed: verif.document_verified, status: verif.stripe_identity_status },
        checkr: { passed: verif.background_clear, status: verif.background_status }
      },
      id_verified: verif.id_verified,
      background_clear: verif.background_clear,
      overall_verified: verif.overall_verified,
      flagged_for_review: verif.flagged_for_review,
      failure_reason: verif.failure_reason
    })
  };
};
