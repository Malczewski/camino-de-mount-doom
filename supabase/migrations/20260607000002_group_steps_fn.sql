-- RPC function that returns group members with steps counted only from
-- the group's creation date (so all members start at 0 in every group).
-- SECURITY DEFINER bypasses RLS so the join to profiles always works.

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
