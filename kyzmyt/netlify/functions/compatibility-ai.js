const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { userIdA, userIdB, action } = JSON.parse(event.body);

    if (action === 'icebreaker') {
      return await generateIcebreaker(userIdA, userIdB);
    }

    if (action === 'compatibility') {
      return await generateCompatibilityReport(userIdA, userIdB);
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('compatibility-ai error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function generateCompatibilityReport(userIdA, userIdB) {
  const [profileA, profileB] = await Promise.all([
    getProfileData(userIdA),
    getProfileData(userIdB)
  ]);

  if (!profileA || !profileB) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Profile not found' }) };
  }

  const prompt = `You are a relationship compatibility analyst for Kyzmyt, a verified dating platform.

Analyze these two people and provide a compatibility score and explanation.

Person A:
- Status: ${profileA.status_label}
- Politics: ${profileA.politics}
- Religion: ${profileA.religion}
- Love language: ${profileA.love_language}
- Attachment style: ${profileA.attachment_style}
- Dealbreakers: ${JSON.stringify(profileA.dealbreakers)}
- Hot takes: ${JSON.stringify(profileA.hot_takes)}
- Quiz responses: ${profileA.quiz_responses}

Person B:
- Status: ${profileB.status_label}
- Politics: ${profileB.politics}
- Religion: ${profileB.religion}
- Love language: ${profileB.love_language}
- Attachment style: ${profileB.attachment_style}
- Dealbreakers: ${JSON.stringify(profileB.dealbreakers)}
- Hot takes: ${JSON.stringify(profileB.hot_takes)}
- Quiz responses: ${profileB.quiz_responses}

Respond ONLY with a JSON object in this exact format:
{
  "score": <number 0-100>,
  "summary": "<2-3 sentences of plain English explaining WHY they're compatible or not>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "watchouts": ["<potential friction 1>", "<potential friction 2>"],
  "conversation_starter": "<One specific, personalized conversation topic they should explore>",
  "dealbreaker_conflict": <true or false>
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  });

  let result;
  try {
    const text = response.content[0].text.replace(/```json|```/g, '').trim();
    result = JSON.parse(text);
  } catch {
    result = { score: 65, summary: 'Compatibility analysis unavailable.', strengths: [], watchouts: [], conversation_starter: '', dealbreaker_conflict: false };
  }

  // Cache the result
  await supabase.from('compatibility_cache').upsert({
    user_a: userIdA,
    user_b: userIdB,
    score: result.score,
    report: JSON.stringify(result),
    generated_at: new Date().toISOString()
  }, { onConflict: 'user_a,user_b' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
}

async function generateIcebreaker(userIdA, userIdB) {
  const [profileA, profileB] = await Promise.all([
    getProfileData(userIdA),
    getProfileData(userIdB)
  ]);

  const prompt = `You are writing a conversation starter for two people who just matched on a verified dating platform called Kyzmyt.

Person sending (A):
- Hot takes: ${JSON.stringify(profileA?.hot_takes)}
- Current obsession: ${profileA?.current_obsession}
- Bucket list: ${profileA?.bucket_list}
- Status: ${profileA?.status_label}

Person receiving (B):
- Hot takes: ${JSON.stringify(profileB?.hot_takes)}
- Current obsession: ${profileB?.current_obsession}
- Bucket list: ${profileB?.bucket_list}
- Status: ${profileB?.status_label}

Generate 3 short, witty, personalized conversation openers that reference something specific from their profiles. 
These should sound like a real person wrote them — not corporate, not generic.
Be clever. Be warm. Be specific.

Respond ONLY with JSON:
{
  "openers": [
    "<opener 1 — references something specific>",
    "<opener 2 — a question that opens real conversation>",
    "<opener 3 — slightly playful>"
  ]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  let result;
  try {
    const text = response.content[0].text.replace(/```json|```/g, '').trim();
    result = JSON.parse(text);
  } catch {
    result = {
      openers: [
        "What's something you've changed your mind about in the last year?",
        "Your hot take is genuinely spicy — defend it.",
        "What's the next thing on your bucket list that you're actually going to do?"
      ]
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
}

async function getProfileData(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('status_label, politics, religion, love_language, attachment_style, dealbreakers, hot_takes, current_obsession, bucket_list, quiz_responses')
    .eq('user_id', userId)
    .single();
  return data;
}
