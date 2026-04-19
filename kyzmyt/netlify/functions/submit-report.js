// ── KYZMYT REPORT SUBMISSION HANDLER ─────────────────────────────────────────
// Fires when a member submits a report from the messages page
// Sends an alert email to the Kyzmyt admin (hello@kyzmyt.com)
// Unsolicited photo reports are flagged HIGH PRIORITY and sent immediately
// All other reports are sent as normal priority for 24-hour review

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

  const {
    reporterName,
    reporterId,
    reportedName,
    reportedId,
    matchId,
    reason,
    detail,
    priority
  } = body;

  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_KEY) {
    console.error('RESEND_API_KEY not configured');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  const reasonLabels = {
    unsolicited_photo: '📸 UNSOLICITED EXPLICIT PHOTO',
    harassment: '🚫 Harassment or threatening behavior',
    fake_profile: '🎭 Fake or misleading profile',
    married_relationship: '💍 Married or in a relationship',
    scam: '💰 Scam or financial manipulation',
    other: '⚠️ Other concern'
  };

  const reasonLabel = reasonLabels[reason] || reason;
  const isHighPriority = reason === 'unsolicited_photo';

  const subject = isHighPriority
    ? `🚨 HIGH PRIORITY REPORT — Unsolicited explicit photo — ${reportedName}`
    : `📋 New Report — ${reasonLabel} — ${reportedName}`;

  const emailBody = `
KYZMYT MEMBER REPORT
${'='.repeat(50)}

PRIORITY: ${priority || 'Normal'}
REASON: ${reasonLabel}
SUBMITTED: ${new Date().toUTCString()}

REPORTER
Name: ${reporterName || 'Unknown'}
User ID: ${reporterId || 'Unknown'}

REPORTED MEMBER
Name: ${reportedName || 'Unknown'}
User ID: ${reportedId || 'Unknown'}

MATCH ID: ${matchId || 'Unknown'}

ADDITIONAL DETAILS:
${detail || 'None provided'}

${'='.repeat(50)}
${isHighPriority ? `
⚠️  ACTION REQUIRED IMMEDIATELY ⚠️
This member has been automatically flagged in Supabase.
Go to the admin dashboard to review and take action:
https://kyzmyt.com/pages/admin.html

This person's verified identity is on file.
If confirmed — permanent removal required.
` : `
This report will be reviewed within 24 hours.
Go to the admin dashboard to review:
https://kyzmyt.com/pages/admin.html
`}
${'='.repeat(50)}
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Kyzmyt Safety <hello@kyzmyt.com>',
        to: 'zach@xekie.com',
        subject,
        text: emailBody
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Resend error:', err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send alert email' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, priority, reason })
    };

  } catch (err) {
    console.error('Submit report error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
