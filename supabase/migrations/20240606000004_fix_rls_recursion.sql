-- Fix infinite recursion: RLS policies must not subquery the same table they protect.
-- SECURITY DEFINER helpers bypass RLS for trusted lookups.

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

DROP POLICY IF EXISTS "step_logs_select_own_and_group" ON step_logs;
CREATE POLICY "step_logs_select_own_and_group"
  ON step_logs FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_group_member(user_id)
  );
