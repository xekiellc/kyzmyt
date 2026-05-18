const { createClient } = require('@supabase/supabase-js');

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

  // Checkr sends report.completed or report.updated events
  const eventType = payload.type;
  const report = payload.data?.object;

  if (!report || !report.id) {
    return { statusCode: 200, body: 'No report data' };
  }

  // Only process completed reports
  if (!['report.completed', 'report.updated'].includes(eventType)) {
    return { statusCode: 200, body: 'Event ignored' };
  }

  const reportId = report.id;
  const status = report.status; // clear, consider, suspended, dispute, pending
  const adjudication = report.adjudication; // engaged, pre_adverse, post_adverse, null

  // Find the verification record by checkr_report_id
  const lookupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/verifications?checkr_report_id=eq.${reportId}`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  );

  const records = await lookupRes.json();
  const verif = records[0];

  if (!verif) {
    console.error(`No verification record found for Checkr report ${reportId}`);
    return { statusCode: 200, body: 'No matching record' };
  }

  const userId = verif.user_id;

  // Determine outcome
  let backgroundClear = null;
  let overallVerified = false;
  let backgroundStatus = 'pending';
  let flaggedForReview = false;

  if (status === 'clear') {
    backgroundClear = true;
    backgroundStatus = 'clear';
    // Only mark overall_verified if layers 1 and 2 also passed
    overallVerified = verif.aws_facial_match === true && verif.document_verified === true;
  } else if (status === 'consider') {
    backgroundClear = false;
    backgroundStatus = 'consider';
    flaggedForReview = true;
  } else if (status === 'suspended' || status === 'dispute') {
    backgroundClear = false;
    backgroundStatus = status;
    flaggedForReview = true;
  } else {
    backgroundStatus = status;
  }

  // Update verifications table
  await fetch(`${SUPABASE_URL}/rest/v1/verifications?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      background_clear: backgroundClear,
      background_status: backgroundStatus,
      overall_verified: overallVerified,
      flagged_for_review: flaggedForReview,
      verified_at: overallVerified ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
  });

  // If approved, mark profile as verified and visible
  if (overallVerified) {
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
        updated_at: new Date().toISOString()
      })
    });
  }

  console.log(`Checkr webhook processed: report ${reportId}, status ${status}, userId ${userId}, overall_verified ${overallVerified}`);

  return { statusCode: 200, body: 'OK' };
};
