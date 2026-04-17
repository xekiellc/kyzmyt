const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  'mailto:hello@kyzmyt.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { userId, action, subscription, payload } = JSON.parse(event.body);

    if (action === 'subscribe') {
      // Store push subscription
      await supabase.from('push_subscriptions').upsert({
        user_id: userId,
        subscription: JSON.stringify(subscription),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    if (action === 'send') {
      // Send push to a specific user (called from other functions)
      const { data } = await supabase
        .from('push_subscriptions')
        .select('subscription')
        .eq('user_id', userId)
        .single();

      if (!data?.subscription) return { statusCode: 404, body: JSON.stringify({ error: 'No subscription' }) };

      await webpush.sendNotification(
        JSON.parse(data.subscription),
        JSON.stringify(payload)
      );
      return { statusCode: 200, body: JSON.stringify({ sent: true }) };
    }

    if (action === 'unsubscribe') {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('push-notifications error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
