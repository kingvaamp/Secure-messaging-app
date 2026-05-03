-- ============================================
-- VanishText — Complete Database Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- Generated: 2026-04-30
-- ============================================

-- ──────────────────────────────────────────────
-- 1. user_keys — Public identity keys (legacy + demo)
-- Used by: sessionManager.js (publishX3DHBundle, fetchContactPublicKeyDemo)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_keys (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key_b64 TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read public keys" ON user_keys FOR SELECT USING (true);
CREATE POLICY "Users can insert own key" ON user_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own key" ON user_keys FOR UPDATE USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- 2. x3dh_bundles — X3DH pre-key bundles (JSONB)
-- Used by: sessionManager.js (publishX3DHBundle, getOrCreateRatchet)
--          prekeyManager.js (replenishOPKs, rotateSPK)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS x3dh_bundles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE x3dh_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read bundles" ON x3dh_bundles FOR SELECT USING (true);
CREATE POLICY "Users can insert own bundle" ON x3dh_bundles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own bundle" ON x3dh_bundles FOR UPDATE USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- 3. opk_claims — One-Time Pre-Key consumption tracking
-- Used by: sessionManager.js (getOrCreateRatchet — Alice path)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opk_claims (
  claimer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  opk_key_id INT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (claimer_id, owner_id)
);

ALTER TABLE opk_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own claims" ON opk_claims FOR INSERT WITH CHECK (auth.uid() = claimer_id);
CREATE POLICY "Users can update own claims" ON opk_claims FOR UPDATE USING (auth.uid() = claimer_id);
CREATE POLICY "Users can read own claims" ON opk_claims FOR SELECT USING (auth.uid() = claimer_id OR auth.uid() = owner_id);

-- ──────────────────────────────────────────────
-- 4. spk_rotation_log — Signed Pre-Key rotation audit trail
-- Used by: prekeyManager.js (rotateSPK)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spk_rotation_log (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  old_spk_id INTEGER,
  new_spk_id INTEGER NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE spk_rotation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can log own rotations" ON spk_rotation_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read own rotation logs" ON spk_rotation_log FOR SELECT USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- 5. auth_rate_limits — OTP rate limiting
-- Used by: supabase/functions/auth-proxy/index.ts
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id SERIAL PRIMARY KEY,
  phone_hash TEXT,
  action TEXT NOT NULL,
  ip TEXT,
  ts TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
-- Service role only — no public access
-- Edge functions use service_role_key which bypasses RLS

-- ──────────────────────────────────────────────
-- 6. security_events — Security audit log
-- Used by: supabase/functions/auth-proxy/index.ts
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
-- Service role only — no public access

-- ──────────────────────────────────────────────
-- 7. webauthn_challenges — WebAuthn challenge storage
-- Used by: supabase/functions/webauthn/index.ts
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_b64 TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own challenges" ON webauthn_challenges FOR ALL USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- 8. webauthn_credentials — Stored WebAuthn credentials
-- Used by: supabase/functions/webauthn/index.ts
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key_cose TEXT NOT NULL,
  sign_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own credentials" ON webauthn_credentials FOR ALL USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- Indexes for performance
-- ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_phone_hash ON auth_rate_limits(phone_hash);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_ip ON auth_rate_limits(ip);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_ts ON auth_rate_limits(ts);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user ON webauthn_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_spk_rotation_user ON spk_rotation_log(user_id);

-- ──────────────────────────────────────────────
-- 9. profiles — User public profiles (Onboarding)
-- Used by: ContactsScreen.jsx (AddContactModal), ProfileSetupScreen.jsx
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pseudo TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique index on pseudo for faster lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_pseudo ON profiles(pseudo);

-- Add index for online status
CREATE INDEX IF NOT EXISTS idx_profiles_is_online ON profiles(is_online);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, pseudo, name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'pseudo', 'user_' || LEFT(NEW.id::TEXT, 8)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Utilisateur'),
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- Done! All 9 tables created with RLS policies.
-- ============================================

-- ──────────────────────────────────────────────
-- 10. groups — Group chat metadata
-- Used by: AppContext.jsx (Group Sync)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  members UUID[] NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read groups they are in" ON groups FOR SELECT USING (auth.uid() = ANY(members));
CREATE POLICY "Users can create groups" ON groups FOR INSERT WITH CHECK (auth.uid() = created_by AND auth.uid() = ANY(members));
