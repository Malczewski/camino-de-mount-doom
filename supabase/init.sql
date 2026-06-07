-- Camino de Mount Doom — full database setup (one-shot)
-- Supabase Dashboard → SQL Editor → paste and run this entire file.
--
-- Prefer `supabase db push` when using the CLI; migrations live in supabase/migrations/.

-- ── Schema ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  total_steps  BIGINT NOT NULL DEFAULT 0,
  api_key      TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_api_key_idx ON profiles(api_key);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_id_idx ON group_members(user_id);
CREATE INDEX IF NOT EXISTS group_members_group_id_idx ON group_members(group_id);

CREATE TABLE IF NOT EXISTS step_logs (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  steps   INTEGER NOT NULL CHECK (steps >= 0),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS step_logs_user_id_idx ON step_logs(user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── Row Level Security ────────────────────────────────────────────────────────

-- Returns true if auth.uid() and target share at least one group
CREATE OR REPLACE FUNCTION public.share_any_group(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members gm1
    JOIN group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = auth.uid() AND gm2.user_id = target_user_id
  );
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_and_group" ON profiles;
CREATE POLICY "profiles_select_own_and_group"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.share_any_group(id)
  );

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own"
  ON profiles FOR DELETE
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "groups_insert_authenticated" ON groups;
CREATE POLICY "groups_insert_authenticated"
  ON groups FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "groups_select_authenticated" ON groups;
CREATE POLICY "groups_select_authenticated"
  ON groups FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "group_members_select_authenticated" ON group_members;
CREATE POLICY "group_members_select_authenticated"
  ON group_members FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "group_members_insert_own" ON group_members;
CREATE POLICY "group_members_insert_own"
  ON group_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "group_members_delete_own" ON group_members;
CREATE POLICY "group_members_delete_own"
  ON group_members FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "step_logs_select_own_and_group" ON step_logs;
CREATE POLICY "step_logs_select_own_and_group"
  ON step_logs FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.share_any_group(user_id)
  );

DROP POLICY IF EXISTS "step_logs_insert_own" ON step_logs;
CREATE POLICY "step_logs_insert_own"
  ON step_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON groups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_members TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON step_logs TO anon, authenticated;

-- step-sync edge function (service_role key, no user JWT)
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON step_logs TO service_role;

-- ── RPC functions ────────────────────────────────────────────────────────────

-- Returns group members with steps counted only from the group's creation date
CREATE OR REPLACE FUNCTION public.get_group_members(p_group_id UUID)
RETURNS TABLE(
  id          UUID,
  display_name TEXT,
  group_steps  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gm.user_id                         AS id,
    COALESCE(p.display_name, 'Traveler') AS display_name,
    COALESCE(SUM(sl.steps), 0)::BIGINT AS group_steps
  FROM group_members gm
  JOIN profiles p ON p.id = gm.user_id
  JOIN groups   g ON g.id = gm.group_id
  LEFT JOIN step_logs sl
    ON  sl.user_id = gm.user_id
    AND sl.date >= g.created_at::date
  WHERE gm.group_id = p_group_id
  GROUP BY gm.user_id, p.display_name
$$;

GRANT EXECUTE ON FUNCTION public.get_group_members(UUID)
  TO authenticated, anon, service_role;

-- ── Realtime ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'group_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'step_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE step_logs;
  END IF;
END $$;
