-- Camino de Mt.Doom — full database setup (one-shot)
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
  group_id     UUID REFERENCES groups(id) ON DELETE SET NULL,
  api_key      TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_group_id_idx ON profiles(group_id);
CREATE INDEX IF NOT EXISTS profiles_api_key_idx ON profiles(api_key);

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

CREATE OR REPLACE FUNCTION public.current_user_group_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT group_id FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_group_member(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p1
    JOIN profiles p2 ON p1.group_id = p2.group_id
    WHERE p1.id = auth.uid()
      AND p1.group_id IS NOT NULL
      AND p2.id = target_user_id
  );
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_and_group" ON profiles;
CREATE POLICY "profiles_select_own_and_group"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      group_id IS NOT NULL
      AND group_id = public.current_user_group_id()
    )
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

DROP POLICY IF EXISTS "step_logs_select_own_and_group" ON step_logs;
CREATE POLICY "step_logs_select_own_and_group"
  ON step_logs FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_group_member(user_id)
  );

DROP POLICY IF EXISTS "step_logs_insert_own" ON step_logs;
CREATE POLICY "step_logs_insert_own"
  ON step_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON groups TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON step_logs TO anon, authenticated;

-- step-sync edge function (service_role key, no user JWT)
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON step_logs TO service_role;

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
    WHERE pubname = 'supabase_realtime' AND tablename = 'step_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE step_logs;
  END IF;
END $$;
