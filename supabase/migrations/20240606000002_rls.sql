-- Row Level Security for Camino de Mt.Doom
-- Idempotent: drops and recreates policies.

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

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON groups TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON step_logs TO anon, authenticated, service_role;
