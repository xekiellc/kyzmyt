const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { userId, firstName, lastName, dob, zipCode } = body;

  if (!userId || !firstName || !lastName || !dob) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: userId, firstName, lastName, dob' })
    };
  }

  const CHECKR_API_KEY = process.env.CHECKR_API_KEY;

  if (!CHECKR_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Checkr API key not configured' })
    };
  }

  try {
    // Step 1 — Create candidate in Checkr
    const candidateRes = await fetch('https://api.checkr.com/v1/candidates', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(CHECKR_API_KEY + ':').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        dob,
        zipcode: zipCode || undefined,
        no_middle_name: true
      })
    });

    if (!candidateRes.ok) {
      const err = await candidateRes.json();
      throw new Error(`Checkr candidate creation failed: ${JSON.stringify(err)}`);
    }

    const candidate = await candidateRes.json();

    // Step 2 — Create report (using your package slug — set up in Checkr dashboard)
    const reportRes = await fetch('https://api.checkr.com/v1/reports', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(CHECKR_API_KEY + ':').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        package: 'kyzmyt_standard',
        candidate_id: candidate.id,
        work_locations: [{ country: 'US', state: 'OH' }]
      })
    });

    if (!reportRes.ok) {
      const err = await reportRes.json();
      throw new Error(`Checkr report creation failed: ${JSON.stringify(err)}`);
    }

    const report = await reportRes.json();

    // Step 3 — Store in Supabase
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    await fetch(`${SUPABASE_URL}/rest/v1/verifications?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        checkr_candidate_id: candidate.id,
        checkr_report_id: report.id,
        background_status: 'pending',
        background_clear: null,
        updated_at: new Date().toISOString()
      })
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'pending',
        reportId: report.id,
        candidateId: candidate.id
      })
    };

  } catch (err) {
    console.error('run-background-check error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
