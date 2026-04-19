// ── KYZMYT TRIPLE IDENTITY VERIFICATION ──────────────────────────────────────
// Layer 1: AWS Rekognition facial match (selfie vs ID photo)
// Layer 2: Azure Face API facial match (second independent confirmation)
// Layer 3: Certn ID verification + criminal background check
// All three must pass. Sequential — each layer gates the next.
// Cost: ~$0.001 (AWS) + ~$0.001 (Azure) + $13.99 (Certn) = ~$14.00 per verified member
// Certn only fires if Layers 1 and 2 both pass — no wasted spend on failed facial matches

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

  const { userId, idPhotoBase64, selfieBase64, firstName, lastName, dob, ssn4, zipCode } = body;

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
    layer2_azure: { passed: false, confidence: null, error: null },
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

  // ── LAYER 2: AZURE FACE API ───────────────────────────────────────────────
  try {
    const azureResult = await runAzureFacialMatch(idPhotoBase64, selfieBase64);
    results.layer2_azure = azureResult;

    if (!azureResult.passed) {
      results.flagged_for_review = true;
      results.failure_reason = 'AWS/Azure disagreement — flagged for human review';
      await updateSupabase(userId, results);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, results, message: 'Identity disagreement between systems — flagged for review' })
      };
    }
  } catch (err) {
    results.layer2_azure.error = err.message;
    results.flagged_for_review = true;
    results.failure_reason = 'Azure layer error — flagged for human review';
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

    if (!certnResult.passed) {
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

  // ── ALL THREE LAYERS PASSED ───────────────────────────────────────────────
  results.overall_passed = true;
  await updateSupabase(userId, results);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      results,
      message: 'All three verification layers passed. Member approved.'
    })
  };
};

// ── AWS REKOGNITION ───────────────────────────────────────────────────────────
async function runAWSFacialMatch(idPhotoBase64, selfieBase64) {
  const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID;
  const AWS_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY;
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'RekognitionService.CompareFaces',
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`AWS Rekognition error: ${response.status}`);
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

// ── AZURE FACE API ────────────────────────────────────────────────────────────
async function runAzureFacialMatch(idPhotoBase64, selfieBase64) {
  const AZURE_ENDPOINT = process.env.AZURE_FACE_ENDPOINT;
  const AZURE_KEY = process.env.AZURE_FACE_KEY;

  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    throw new Error('Azure Face API credentials not configured');
  }

  const detectID = await fetch(`${AZURE_ENDPOINT}/face/v1.0/detect?returnFaceId=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Ocp-Apim-Subscription-Key': AZURE_KEY
    },
    body: Buffer.from(idPhotoBase64, 'base64')
  });

  if (!detectID.ok) throw new Error(`Azure detect ID error: ${detectID.status}`);
  const idFaces = await detectID.json();
  if (!idFaces.length) return { passed: false, confidence: 0, error: 'No face detected in ID photo' };
  const idFaceId = idFaces[0].faceId;

  const detectSelfie = await fetch(`${AZURE_ENDPOINT}/face/v1.0/detect?returnFaceId=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Ocp-Apim-Subscription-Key': AZURE_KEY
    },
    body: Buffer.from(selfieBase64, 'base64')
  });

  if (!detectSelfie.ok) throw new Error(`Azure detect selfie error: ${detectSelfie.status}`);
  const selfieFaces = await detectSelfie.json();
  if (!selfieFaces.length) return { passed: false, confidence: 0, error: 'No face detected in selfie' };
  const selfieFaceId = selfieFaces[0].faceId;

  const verify = await fetch(`${AZURE_ENDPOINT}/face/v1.0/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': AZURE_KEY
    },
    body: JSON.stringify({ faceId1: idFaceId, faceId2: selfieFaceId })
  });

  if (!verify.ok) throw new Error(`Azure verify error: ${verify.status}`);
  const verifyResult = await verify.json();

  const confidence = (verifyResult.confidence || 0) * 100;
  const passed = verifyResult.isIdentical === true && confidence >= 90;

  return { passed, confidence: Math.round(confidence * 10) / 10, error: null };
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
    azure_facial_match: results.layer2_azure.passed,
    azure_confidence: results.layer2_azure.confidence,
    certn_order_id: results.layer3_certn.certnOrderId || null,
    background_status: results.layer3_certn.status || 'not_started',
    background_clear: results.layer3_certn.backgroundClear,
    flagged_for_review: results.flagged_for_review,
    failure_reason: results.failure_reason,
    id_verified: results.layer1_aws.passed && results.layer2_azure.passed,
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
