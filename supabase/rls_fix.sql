-- ============================================
-- VanishText — Reconstructive Schema Fix
-- Run this in the Supabase SQL Editor.
-- This will ensure all columns (like owner_id) exist correctly.
-- ============================================

-- 1. Drop existing crypto tables to resolve column mismatches
-- (Safe to do: keys will be re-published on your next login)
DROP TABLE IF EXISTS opk_claims CASCADE;
DROP TABLE IF EXISTS x3dh_bundles CASCADE;
DROP TABLE IF EXISTS spk_rotation_log CASCADE;

-- 2. Recreate x3dh_bundles with correct structure
CREATE TABLE x3dh_bundles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Recreate opk_claims with the missing 'owner_id' column
CREATE TABLE opk_claims (
  claimer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  opk_key_id INT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (claimer_id, owner_id)
);

-- 4. Recreate spk_rotation_log
CREATE TABLE spk_rotation_log (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  old_spk_id INTEGER,
  new_spk_id INTEGER NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Ensure RLS is enabled on all tables
ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE x3dh_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE opk_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE spk_rotation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- 6. Apply RLS Policies
DROP POLICY IF EXISTS "Anyone can read public keys" ON user_keys;
CREATE POLICY "Anyone can read public keys" ON user_keys FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can insert own key" ON user_keys;
CREATE POLICY "Users can insert own key" ON user_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own key" ON user_keys;
CREATE POLICY "Users can update own key" ON user_keys FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Anyone can read bundles" ON x3dh_bundles FOR SELECT USING (true);
CREATE POLICY "Users can insert own bundle" ON x3dh_bundles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own bundle" ON x3dh_bundles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own claims" ON opk_claims FOR INSERT WITH CHECK (auth.uid() = claimer_id);
CREATE POLICY "Users can update own claims" ON opk_claims FOR UPDATE USING (auth.uid() = claimer_id);
CREATE POLICY "Users can read own claims" ON opk_claims FOR SELECT USING (auth.uid() = claimer_id OR auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can read groups they are in" ON groups;
CREATE POLICY "Users can read groups they are in" ON groups FOR SELECT USING (auth.uid() = ANY(members));
DROP POLICY IF EXISTS "Users can create groups" ON groups;
CREATE POLICY "Users can create groups" ON groups FOR INSERT WITH CHECK (auth.uid() = created_by AND auth.uid() = ANY(members));
