-- Migration: multi-group support
-- Replaces profiles.group_id (single) with group_members junction table (many-to-many).

-- 1. Create junction table
CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_id_idx ON group_members(user_id);
CREATE INDEX IF NOT EXISTS group_members_group_id_idx ON group_members(group_id);

-- 2. Migrate existing memberships from profiles.group_id
INSERT INTO group_members (group_id, user_id)
SELECT group_id, id FROM profiles
WHERE group_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Enable realtime for group_members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'group_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE group_members;
  END IF;
END $$;

-- 4. Drop policies that reference profiles.group_id before removing the column
DROP POLICY IF EXISTS "profiles_select_own_and_group" ON profiles;
DROP POLICY IF EXISTS "step_logs_select_own_and_group" ON step_logs;

-- 5. Drop old helper functions that reference profiles.group_id
DROP FUNCTION IF EXISTS public.current_user_group_id();
DROP FUNCTION IF EXISTS public.is_group_member(UUID);

-- 6. Remove group_id column from profiles (index is dropped automatically)
ALTER TABLE profiles DROP COLUMN IF EXISTS group_id;

-- 7. New helper: returns true if auth.uid() and target share at least one group
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

-- 8. Recreate profiles read policy using new helper
CREATE POLICY "profiles_select_own_and_group"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.share_any_group(id)
  );

-- 9. Recreate step_logs read policy using new helper
CREATE POLICY "step_logs_select_own_and_group"
  ON step_logs FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.share_any_group(user_id)
  );

-- 10. RLS for group_members
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

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

-- 11. Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON group_members TO anon, authenticated, service_role;
