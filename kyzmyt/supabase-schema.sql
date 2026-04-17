-- ══════════════════════════════════════════════════════════════════════════════
-- KYZMYT DATABASE SCHEMA
-- Run this entire file in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";  -- optional, for location filtering

-- ── profiles ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        TEXT,
  age                 INTEGER,
  dob                 DATE,
  gender              TEXT CHECK (gender IN ('man', 'woman', 'nonbinary', 'other')),
  seeking             TEXT CHECK (seeking IN ('men', 'women', 'nonbinary', 'everyone')),
  zipcode             TEXT,
  city                TEXT,
  state               TEXT,
  lat                 NUMERIC,
  lng                 NUMERIC,

  -- Relationship context
  status_label        TEXT,

  -- Values
  politics            TEXT,
  religion            TEXT,
  love_language       TEXT,
  attachment_style    TEXT CHECK (attachment_style IN ('secure', 'anxious', 'avoidant', 'disorganized')),
  device_pref         TEXT CHECK (device_pref IN ('iphone', 'android')),
  computer_pref       TEXT CHECK (computer_pref IN ('mac', 'pc')),

  -- Personality depth
  hot_takes           TEXT[],
  dealbreakers        TEXT[],
  bucket_list         TEXT,
  current_obsession   TEXT,
  bio                 TEXT CHECK (char_length(bio) <= 300),
  quiz_responses      JSONB,
  spotify_track_id    TEXT,
  spotify_track_name  TEXT,

  -- Children
  has_kids            BOOLEAN,
  wants_kids          BOOLEAN,

  -- Lifestyle flags
  smoker              BOOLEAN DEFAULT FALSE,
  heavy_drinker       BOOLEAN DEFAULT FALSE,
  diet                TEXT,
  exercise_freq       TEXT,

  -- Platform status
  is_verified         BOOLEAN DEFAULT FALSE,
  is_visible          BOOLEAN DEFAULT FALSE,
  is_subscriber       BOOLEAN DEFAULT FALSE,
  has_financial_badge BOOLEAN DEFAULT FALSE,

  -- Moderation
  ban_reason          TEXT,
  banned_at           TIMESTAMPTZ,

  -- Stripe
  stripe_customer_id  TEXT,

  -- Timestamps
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── verifications (TAMPER-PROOF — users cannot write here) ───────────────────
CREATE TABLE IF NOT EXISTS verifications (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                     UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ID verification (Stripe Identity)
  id_verified                 BOOLEAN DEFAULT FALSE,
  id_verified_at              TIMESTAMPTZ,
  id_fail_reason              TEXT,
  stripe_identity_session_id  TEXT,
  photo_real                  BOOLEAN DEFAULT FALSE,

  -- Background check (Checkr)
  background_status           TEXT DEFAULT 'not_started' CHECK (background_status IN ('not_started', 'pending', 'clear', 'consider', 'suspended', 'dispute')),
  background_clear            BOOLEAN,
  background_paid_at          TIMESTAMPTZ,
  background_completed_at     TIMESTAMPTZ,
  checkr_candidate_id         TEXT,
  checkr_report_id            TEXT,
  checkr_report_status        TEXT,
  checkr_adjudication         TEXT,

  -- Financial badge (Plaid)
  financial_verified          BOOLEAN DEFAULT FALSE,
  financial_verified_at       TIMESTAMPTZ,
  financial_paid              BOOLEAN DEFAULT FALSE,
  income_tier                 TEXT,

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ── profile_photos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_photos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  storage_key TEXT,
  position    INTEGER DEFAULT 0,
  is_primary  BOOLEAN DEFAULT FALSE,
  ai_verified BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── likes ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_superlike BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_user, to_user)
);

-- ── matches ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_a     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_a, user_b)
);

-- ── messages ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id   UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (char_length(content) <= 2000),
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  read_at    TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- ── subscriptions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT,
  tier                   TEXT DEFAULT 'member' CHECK (tier IN ('member', 'concierge')),
  status                 TEXT DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'cancelled', 'past_due')),
  started_at             TIMESTAMPTZ,
  cancelled_at           TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── date_checkins ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS date_checkins (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id         UUID REFERENCES matches(id) ON DELETE SET NULL,
  checkin_time     TIMESTAMPTZ NOT NULL,
  trusted_contact  TEXT NOT NULL,
  user_phone       TEXT,
  last_location    TEXT,
  reminder_sent_at TIMESTAMPTZ,
  responded_at     TIMESTAMPTZ,
  response         TEXT,
  alerted          BOOLEAN DEFAULT FALSE,
  alerted_at       TIMESTAMPTZ,
  escalated        BOOLEAN DEFAULT FALSE,
  escalated_at     TIMESTAMPTZ,
  resolved         BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── stories (24-hour) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url   TEXT NOT NULL,
  media_type  TEXT DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  caption     TEXT,
  views       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- ── forum_posts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forum_posts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (char_length(title) <= 150),
  body        TEXT NOT NULL CHECK (char_length(body) <= 2000),
  category    TEXT DEFAULT 'general',
  likes       INTEGER DEFAULT 0,
  is_pinned   BOOLEAN DEFAULT FALSE,
  is_removed  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── forum_comments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forum_comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id     UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) <= 1000),
  likes       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── post_likes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_likes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id    UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- ── nominations (community matchmaking) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS nominations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nominator_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nominee_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nominated_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'matched')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── reports ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  details      TEXT,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewed_by  UUID,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── blocks ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id)
);

-- ── compatibility_cache ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compatibility_cache (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_a       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score        INTEGER,
  report       JSONB,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_a, user_b)
);

-- ── date_ratings (private safety signals) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS date_ratings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rater_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rated_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id     UUID REFERENCES matches(id),
  felt_safe    BOOLEAN NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rater_id, rated_id)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY POLICIES
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compatibility_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_ratings ENABLE ROW LEVEL SECURITY;

-- ── profiles policies ─────────────────────────────────────────────────────────
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Visible profiles readable by authenticated users" ON profiles FOR SELECT
  USING (auth.role() = 'authenticated' AND is_visible = TRUE AND is_verified = TRUE AND ban_reason IS NULL);

-- ── verifications policies (CRITICAL: users cannot write) ────────────────────
CREATE POLICY "Users can view own verifications" ON verifications FOR SELECT USING (auth.uid() = user_id);
-- NO insert/update/delete policies for users — only service role can write
-- This is the security guarantee: tamper-proof background check results

-- ── profile_photos policies ───────────────────────────────────────────────────
CREATE POLICY "Photos viewable by authenticated users" ON profile_photos FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users manage own photos" ON profile_photos FOR ALL USING (auth.uid() = user_id);

-- ── likes policies ────────────────────────────────────────────────────────────
CREATE POLICY "Users can see who liked them" ON likes FOR SELECT USING (auth.uid() = to_user);
CREATE POLICY "Users can see their own likes" ON likes FOR SELECT USING (auth.uid() = from_user);
CREATE POLICY "Users can create likes" ON likes FOR INSERT WITH CHECK (auth.uid() = from_user);
CREATE POLICY "Users can delete own likes" ON likes FOR DELETE USING (auth.uid() = from_user);

-- ── matches policies ──────────────────────────────────────────────────────────
CREATE POLICY "Users can see own matches" ON matches FOR SELECT USING (auth.uid() = user_a OR auth.uid() = user_b);

-- ── messages policies ─────────────────────────────────────────────────────────
CREATE POLICY "Users can see messages in their matches" ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM matches
      WHERE matches.id = messages.match_id
      AND (matches.user_a = auth.uid() OR matches.user_b = auth.uid())
    )
  );
CREATE POLICY "Users can send messages in their matches" ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM matches
      WHERE matches.id = messages.match_id
      AND (matches.user_a = auth.uid() OR matches.user_b = auth.uid())
    )
  );

-- ── date_checkins policies ────────────────────────────────────────────────────
CREATE POLICY "Users manage own checkins" ON date_checkins FOR ALL USING (auth.uid() = user_id);

-- ── stories policies ──────────────────────────────────────────────────────────
CREATE POLICY "Active stories readable by authenticated" ON stories FOR SELECT
  USING (auth.role() = 'authenticated' AND expires_at > NOW());
CREATE POLICY "Users manage own stories" ON stories FOR ALL USING (auth.uid() = user_id);

-- ── forum policies ────────────────────────────────────────────────────────────
CREATE POLICY "Posts readable by authenticated" ON forum_posts FOR SELECT USING (auth.role() = 'authenticated' AND is_removed = FALSE);
CREATE POLICY "Users can post" ON forum_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON forum_posts FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Comments readable by authenticated" ON forum_comments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can comment" ON forum_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Post likes by authenticated" ON post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── nominations policies ──────────────────────────────────────────────────────
CREATE POLICY "See nominations involving you" ON nominations FOR SELECT USING (auth.uid() = nominator_id OR auth.uid() = nominated_id OR auth.uid() = nominee_id);
CREATE POLICY "Create nominations" ON nominations FOR INSERT WITH CHECK (auth.uid() = nominator_id);
CREATE POLICY "Update your nomination response" ON nominations FOR UPDATE USING (auth.uid() = nominated_id OR auth.uid() = nominee_id);

-- ── reports policies ──────────────────────────────────────────────────────────
CREATE POLICY "Users can create reports" ON reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Users can see own reports" ON reports FOR SELECT USING (auth.uid() = reporter_id);

-- ── blocks policies ───────────────────────────────────────────────────────────
CREATE POLICY "Users manage own blocks" ON blocks FOR ALL USING (auth.uid() = blocker_id);

-- ── subscriptions policies ────────────────────────────────────────────────────
CREATE POLICY "Users see own subscription" ON subscriptions FOR SELECT USING (auth.uid() = user_id);

-- ── compatibility_cache policies ──────────────────────────────────────────────
CREATE POLICY "Users see own compatibility" ON compatibility_cache FOR SELECT USING (auth.uid() = user_a OR auth.uid() = user_b);

-- ── date_ratings policies ─────────────────────────────────────────────────────
CREATE POLICY "Users manage own ratings" ON date_ratings FOR ALL USING (auth.uid() = rater_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- INDEXES FOR PERFORMANCE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_profiles_visible ON profiles(is_visible, is_verified) WHERE ban_reason IS NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_seeking ON profiles(gender, seeking);
CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_to_user ON likes(to_user);
CREATE INDEX IF NOT EXISTS idx_likes_from_user ON likes(from_user);
CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user_a, user_b);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_category ON forum_posts(category, created_at) WHERE is_removed = FALSE;
CREATE INDEX IF NOT EXISTS idx_stories_active ON stories(expires_at) WHERE expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_checkins_due ON date_checkins(checkin_time) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- ══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ══════════════════════════════════════════════════════════════════════════════

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER forum_posts_updated_at BEFORE UPDATE ON forum_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-increment post likes count
CREATE OR REPLACE FUNCTION increment_post_likes()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE forum_posts SET likes = likes + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER post_likes_trigger AFTER INSERT ON post_likes FOR EACH ROW EXECUTE FUNCTION increment_post_likes();

-- Block check: prevent showing blocked users in matches/messages
CREATE OR REPLACE FUNCTION user_is_blocked(user_a UUID, user_b UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = user_a AND blocked_id = user_b)
       OR (blocker_id = user_b AND blocked_id = user_a)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════════════════════════════════════════════════
-- REALTIME SUBSCRIPTIONS (enable for messaging)
-- ══════════════════════════════════════════════════════════════════════════════

-- Run in Supabase dashboard → Database → Replication
-- ALTER PUBLICATION supabase_realtime ADD TABLE messages;
-- ALTER PUBLICATION supabase_realtime ADD TABLE matches;
-- ALTER PUBLICATION supabase_realtime ADD TABLE likes;
-- ALTER PUBLICATION supabase_realtime ADD TABLE stories;

-- ══════════════════════════════════════════════════════════════════════════════
-- STORAGE BUCKETS
-- Create these in Supabase Dashboard → Storage
-- ══════════════════════════════════════════════════════════════════════════════

-- profile-photos: public bucket, 5MB limit, image/* only
-- stories: public bucket, 10MB limit, image/* and video/* only
