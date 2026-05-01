// ── KYZMYT TRIPLE IDENTITY VERIFICATION ──────────────────────────────────────
// Layer 1: AWS Rekognition facial liveness + selfie match
// Layer 2: Stripe Identity government ID document scan
// Layer 3: Certn criminal background check
// All three must pass. Sequential — each layer gates the next.
// Cost: ~$0.001 (AWS) + $1.50 (Stripe Identity) + $49.99 (Certn) = ~$51.50 per verified member
// Certn only fires if Layers 1 and 2 both pass — no wasted spend on failed verifications

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

  const { userId, idPhotoBase64, selfieBase64, firstName, lastName, dob, ssn4, zipCode, stripeVerificationSessionId } = body;

  if (!userId || !idPhotoBase64 || !selfieBase64 || !firstName || !lastName || !dob) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: userId, idPhotoBase64, selfieBase64, firstName, lastName, dob' })
    };
  }

  const results = {
    userId,
    timestamp: new Date().toISOString(),
    layer1_aws: { passed: false, confidence: null, error: null },
    layer2_stripe: { passed: false, status: null, documentVerified: null, error: null },
    layer3_certn: { passed: false, status: null, backgroundClear: null, error: null },
    overall_passed: false,
    flagged_for_review: false,
    failure_reason: null
  };

  // ── LAYER 1: AWS REKOGNITION ──────────────────────────────────────────────
  try {
    const awsResult = await runAWSFacialMatch(idPhotoBase64, selfieBase64);
    results.layer1_aws = awsResult;

    if (!awsResult.passed) {
      results.failure_reason = 'AWS facial match failed — selfie does not match ID photo';
      await updateSupabase(userId, results);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, results, message: 'Identity verification failed at layer 1' })
      };
    }
  } catch (err) {
    results.layer1_aws.error = err.message;
    results.flagged_for_review = true;
    results.failure_reason = 'AWS layer error — flagged for human review';
    await updateSupabase(userId, results);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, results, message: 'Layer 1 error — flagged for review' })
    };
  }

  // ── LAYER 2: STRIPE IDENTITY ──────────────────────────────────────────────
  try {
    const stripeResult = await runStripeIdentityCheck(stripeVerificationSessionId, userId);
    results.layer2_stripe = stripeResult;

    if (!stripeResult.passed) {
      results.failure_reason = 'Stripe Identity document verification failed';
      await updateSupabase(userId, results);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, results, message: 'Identity verification failed at layer 2' })
      };
    }
  } catch (err) {
    results.layer2_stripe.error = err.message;
    results.flagged_for_review = true;
    results.failure_reason = 'Stripe Identity layer error — flagged for human review';
    await updateSupabase(userId, results);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, results, message: 'Layer 2 error — flagged for review' })
    };
  }

  // ── LAYER 3: CERTN BACKGROUND CHECK ──────────────────────────────────────
  try {
    const certnResult = await runCertnCheck({ firstName, lastName, dob, ssn4, zipCode, userId });
    results.layer3_certn = certnResult;

    if (!certnResult.passed && certnResult.status !== 'pending') {
      results.failure_reason = 'Background check failed';
      await updateSupabase(userId, results);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, results, message: 'Background check did not clear' })
      };
    }
  } catch (err) {
    results.layer3_certn.error = err.message;
    results.flagged_for_review = true;
    results.failure_reason = 'Certn layer error — flagged for human review';
    await updateSupabase(userId, results);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, results, message: 'Background check error — flagged for review' })
    };
  }

  // ── LAYERS 1 & 2 PASSED — CERTN PENDING ──────────────────────────────────
  results.overall_passed = false; // true only after Certn webhook confirms clear
  await updateSupabase(userId, results);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      results,
      message: 'Facial match and ID document verified. Background check in progress.'
    })
  };
};

// ── AWS REKOGNITION ───────────────────────────────────────────────────────────
async function runAWSFacialMatch(idPhotoBase64, selfieBase64) {
  const AWS_ACCESS_KEY = process.env.KYZMYT_AWS_ACCESS_KEY_ID;
  const AWS_SECRET_KEY = process.env.KYZMYT_AWS_SECRET_ACCESS_KEY;
  const AWS_REGION = process.env.KYZMYT_AWS_REGION || 'us-east-1';

  if (!AWS_ACCESS_KEY || !AWS_SECRET_KEY) {
    throw new Error('AWS credentials not configured');
  }

  const endpoint = `https://rekognition.${AWS_REGION}.amazonaws.com/`;

  const payload = {
    SourceImage: { Bytes: idPhotoBase64 },
    TargetImage: { Bytes: selfieBase64 },
    SimilarityThreshold: 90
  };

  // Build AWS Signature V4 headers
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const bodyStr = JSON.stringify(payload);

  const headers = await buildAWSHeaders({
    method: 'POST',
    endpoint,
    body: bodyStr,
    service: 'rekognition',
    region: AWS_REGION,
    accessKey: AWS_ACCESS_KEY,
    secretKey: AWS_SECRET_KEY,
    amzDate,
    dateStamp,
    target: 'RekognitionService.CompareFaces'
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: bodyStr
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AWS Rekognition error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const faceMatches = data.FaceMatches || [];

  if (faceMatches.length === 0) {
    return { passed: false, confidence: 0, error: null };
  }

  const topMatch = faceMatches[0];
  const confidence = topMatch.Similarity || 0;
  const passed = confidence >= 90;

  return { passed, confidence: Math.round(confidence * 10) / 10, error: null };
}

// ── AWS SIGNATURE V4 BUILDER ──────────────────────────────────────────────────
async function buildAWSHeaders({ method, endpoint, body, service, region, accessKey, secretKey, amzDate, dateStamp, target }) {
  const crypto = require('crypto');
  const url = new URL(endpoint);
  const host = url.hostname;

  const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';

  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = `${method}\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const getSignatureKey = (key, dateStamp, region, service) => {
    const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  };

  const signingKey = getSignatureKey(secretKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Date': amzDate,
    'X-Amz-Target': target,
    'Authorization': authorizationHeader
  };
}

// ── STRIPE IDENTITY ───────────────────────────────────────────────────────────
async function runStripeIdentityCheck(verificationSessionId, userId) {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

  if (!STRIPE_SECRET_KEY) {
    throw new Error('Stripe secret key not configured');
  }

  if (!verificationSessionId) {
    // Create a new verification session
    const createResponse = await fetch('https://api.stripe.com/v1/identity/verification_sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        type: 'document',
        'metadata[userId]': userId,
        'options[document][allowed_types][]': 'driving_license',
        'options[document][allowed_types][]': 'passport',
        'options[document][require_matching_selfie]': 'true'
      }).toString()
    });

    if (!createResponse.ok) {
      const err = await createResponse.json();
      throw new Error(`Stripe Identity session creation failed: ${JSON.stringify(err)}`);
    }

    const session = await createResponse.json();

    return {
      passed: false,
      status: 'pending',
      documentVerified: false,
      sessionId: session.id,
      clientSecret: session.client_secret,
      error: null,
      requiresClientAction: true
    };
  }

  // Retrieve existing session to check status
  const retrieveResponse = await fetch(`https://api.stripe.com/v1/identity/verification_sessions/${verificationSessionId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`
    }
  });

  if (!retrieveResponse.ok) {
    const err = await retrieveResponse.json();
    throw new Error(`Stripe Identity retrieval failed: ${JSON.stringify(err)}`);
  }

  const session = await retrieveResponse.json();
  const passed = session.status === 'verified';

  return {
    passed,
    status: session.status,
    documentVerified: passed,
    sessionId: session.id,
    error: null,
    requiresClientAction: false
  };
}

// ── CERTN BACKGROUND CHECK ────────────────────────────────────────────────────
async function runCertnCheck({ firstName, lastName, dob, ssn4, zipCode, userId }) {
  const CERTN_API_KEY = process.env.CERTN_API_KEY;
  const CERTN_BASE_URL = process.env.CERTN_BASE_URL || 'https://api.certn.co';

  if (!CERTN_API_KEY) {
    throw new Error('Certn API key not configured');
  }

  const response = await fetch(`${CERTN_BASE_URL}/v1/orders/`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${CERTN_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dob,
      sin_ssn: ssn4 || undefined,
      zip_code: zipCode || undefined,
      external_id: userId,
      request_criminal_record_check: true,
      request_sex_offender_check: true,
      webhook_url: `${process.env.URL}/.netlify/functions/certn-webhook`
    })
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(`Certn API error: ${JSON.stringify(errData)}`);
  }

  const data = await response.json();

  return {
    passed: null,
    status: 'pending',
    backgroundClear: null,
    certnOrderId: data.id || data.order_id,
    error: null
  };
}

// ── SUPABASE UPDATE ───────────────────────────────────────────────────────────
async function updateSupabase(userId, results) {
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gnknifxhzriqwugmvoxf.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_SERVICE_KEY) {
    console.error('Supabase service role key not configured');
    return;
  }

  const verificationData = {
    user_id: userId,
    aws_facial_match: results.layer1_aws.passed,
    aws_confidence: results.layer1_aws.confidence,
    stripe_identity_status: results.layer2_stripe.status || null,
    stripe_session_id: results.layer2_stripe.sessionId || null,
    document_verified: results.layer2_stripe.documentVerified || false,
    certn_order_id: results.layer3_certn.certnOrderId || null,
    background_status: results.layer3_certn.status || 'not_started',
    background_clear: results.layer3_certn.backgroundClear,
    flagged_for_review: results.flagged_for_review,
    failure_reason: results.failure_reason,
    id_verified: results.layer1_aws.passed && results.layer2_stripe.passed,
    overall_verified: results.overall_passed,
    verified_at: results.overall_passed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  };

  await fetch(`${SUPABASE_URL}/rest/v1/verifications?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(verificationData)
  });
}
