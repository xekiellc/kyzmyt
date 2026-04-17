const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// This function runs on a schedule (every 5 minutes via Netlify scheduled functions)
// It checks for due check-ins and sends alerts if user hasn't responded
exports.handler = async (event) => {
  try {
    const now = new Date();
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);

    // Find check-ins that are due and not resolved
    const { data: dueCheckins } = await supabase
      .from('date_checkins')
      .select('*, profiles(display_name)')
      .lte('checkin_time', now.toISOString())
      .gt('checkin_time', new Date(now.getTime() - 60 * 60 * 1000).toISOString()) // within last hour
      .eq('resolved', false)
      .eq('alerted', false);

    for (const checkin of (dueCheckins || [])) {
      // Check if user has responded (responded_at field set)
      if (!checkin.responded_at) {
        // Check-in time passed, no response — check if 15 min grace period is over
        const checkinTime = new Date(checkin.checkin_time);
        const timeSinceCheckin = now.getTime() - checkinTime.getTime();

        if (timeSinceCheckin >= 15 * 60 * 1000) {
          // 15 minutes past — send alert
          await sendCheckinAlert(checkin);
          await supabase.from('date_checkins').update({ alerted: true, alerted_at: now.toISOString() }).eq('id', checkin.id);
        } else if (timeSinceCheckin >= 0) {
          // Just reached check-in time — send check-in text to user
          await sendCheckinReminder(checkin);
        }
      }
    }

    // Find check-ins where alert was sent 30 min ago with no resolution
    const { data: escalations } = await supabase
      .from('date_checkins')
      .select('*')
      .eq('alerted', true)
      .eq('resolved', false)
      .lte('alerted_at', fifteenMinsAgo.toISOString());

    for (const checkin of (escalations || [])) {
      await escalateAlert(checkin);
    }

    return { statusCode: 200, body: JSON.stringify({ processed: (dueCheckins || []).length }) };
  } catch (err) {
    console.error('date-checkin-alert error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function sendCheckinReminder(checkin) {
  // Get user phone number
  const { data: { user } } = await supabase.auth.admin.getUserById(checkin.user_id);
  const phone = checkin.user_phone || user?.phone;

  if (!phone) return;

  await twilioClient.messages.create({
    to: phone,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `Kyzmyt Safety Check-In 🛡\n\nThis is your scheduled date check-in. Are you safe?\n\nReply SAFE to confirm. If we don't hear from you in 15 minutes, we'll contact your trusted contact.\n\nStay safe!`
  });

  // Also create a webhook to handle their response
  await supabase.from('date_checkins').update({ reminder_sent_at: new Date().toISOString() }).eq('id', checkin.id);
}

async function sendCheckinAlert(checkin) {
  const trustedContact = checkin.trusted_contact;
  const memberName = checkin.profiles?.display_name || 'Your contact';

  if (!trustedContact) return;

  // Format phone for Twilio
  let phone = trustedContact.replace(/\D/g, '');
  if (phone.length === 10) phone = '+1' + phone;
  else if (!phone.startsWith('+')) phone = '+' + phone;

  const lastKnown = checkin.last_location
    ? `Their last known location: ${checkin.last_location}`
    : 'We do not have a last known location on file.';

  await twilioClient.messages.create({
    to: phone,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `KYZMYT SAFETY ALERT 🚨\n\n${memberName} set up a date check-in and did not respond when we checked in.\n\n${lastKnown}\n\nPlease try to contact them. If you cannot reach them, consider contacting local authorities.\n\nThis alert was triggered automatically by Kyzmyt's safety system.`
  });
}

async function escalateAlert(checkin) {
  // Second escalation if still no resolution
  const trustedContact = checkin.trusted_contact;
  if (!trustedContact) return;

  let phone = trustedContact.replace(/\D/g, '');
  if (phone.length === 10) phone = '+1' + phone;
  else if (!phone.startsWith('+')) phone = '+' + phone;

  await twilioClient.messages.create({
    to: phone,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `KYZMYT FOLLOW-UP ALERT 🚨\n\nWe sent you an alert 30 minutes ago regarding ${checkin.profiles?.display_name || 'a contact'}. They still have not responded.\n\nPlease check on them immediately. If you cannot reach them, we strongly recommend contacting local authorities.\n\nKyzmyt Safety Team`
  });

  await supabase.from('date_checkins').update({ escalated: true, escalated_at: new Date().toISOString() }).eq('id', checkin.id);
}
