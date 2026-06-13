-- Fix last_week_steps to exclude steps that pre-date the group's creation.
-- Without this, users who joined a freshly-created group saw a non-zero
-- last-week delta (from personal history) while their group_steps was 0.
--
-- Uses GREATEST(wk_start, g.created_at::date) so the lower bound is always
-- the later of "last Monday" and "when the group started".  If the group was
-- created after last Sunday the bound exceeds wk_end and the sum is 0.

DROP FUNCTION IF EXISTS public.get_group_members(UUID);

CREATE FUNCTION public.get_group_members(p_group_id UUID)
RETURNS TABLE(
  id               UUID,
  display_name     TEXT,
  group_steps      BIGINT,
  last_week_steps  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prev_week_bounds AS (
    SELECT
      date_trunc('week', current_date - interval '7 days')::date              AS wk_start,
      (date_trunc('week', current_date - interval '7 days') + interval '6 days')::date AS wk_end
  ),
  last_week AS (
    SELECT
      gm.user_id,
      COALESCE(SUM(sl.steps), 0)::BIGINT AS last_week_steps
    FROM group_members gm
    CROSS JOIN prev_week_bounds
    JOIN groups g ON g.id = gm.group_id
    LEFT JOIN step_logs sl
      ON  sl.user_id = gm.user_id
      AND sl.date   >= GREATEST(prev_week_bounds.wk_start, g.created_at::date)
      AND sl.date   <= prev_week_bounds.wk_end
    WHERE gm.group_id = p_group_id
    GROUP BY gm.user_id
  )
  SELECT
    gm.user_id                             AS id,
    COALESCE(p.display_name, 'Traveler')   AS display_name,
    COALESCE(SUM(sl.steps), 0)::BIGINT     AS group_steps,
    lw.last_week_steps
  FROM group_members gm
  JOIN profiles  p  ON p.id  = gm.user_id
  JOIN groups    g  ON g.id  = gm.group_id
  LEFT JOIN step_logs sl
    ON  sl.user_id = gm.user_id
    AND sl.date   >= g.created_at::date
  LEFT JOIN last_week lw ON lw.user_id = gm.user_id
  WHERE gm.group_id = p_group_id
  GROUP BY gm.user_id, p.display_name, lw.last_week_steps;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_members(UUID)
  TO authenticated, anon, service_role;
