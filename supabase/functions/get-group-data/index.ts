import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Must match POINTS with name+steps in src/lib/mapPosition.ts
const CHECKPOINTS: Array<{ name: string; steps: number }> = [
  { name: "Bag End", steps: 0 },
  { name: "Bucklebury Ferry", steps: 65000 },
  { name: "Bree", steps: 260000 },
  { name: "Weathertop", steps: 540000 },
  { name: "Trollshaws", steps: 687000 },
  { name: "Rivendell", steps: 916000 },
  { name: "Caradhras", steps: 1100000 },
  { name: "Moria", steps: 1250000 },
  { name: "Lothlórien", steps: 1350000 },
  { name: "Anduin", steps: 1450000 },
  { name: "Argonath", steps: 1630000 },
  { name: "Amon Hen", steps: 1750000 },
  { name: "Emyn Muil", steps: 1850000 },
  { name: "Dead Marshes", steps: 1950000 },
  { name: "Black Gate", steps: 2130000 },
  { name: "Ithilien", steps: 2250000 },
  { name: "Minas Morgul", steps: 2550000 },
  { name: "Mordor", steps: 2600000 },
  { name: "Mount Doom", steps: 3000000 },
];

function getCheckpointInfo(groupSteps: number): {
  nextCheckpoint: { name: string; stepsAway: number } | null;
  prevCheckpoint: { name: string; steps: number } | null;
} {
  let prev: { name: string; steps: number } | null = null;
  for (const cp of CHECKPOINTS) {
    if (cp.steps > groupSteps) {
      return {
        nextCheckpoint: { name: cp.name, stepsAway: cp.steps - groupSteps },
        prevCheckpoint: prev,
      };
    }
    prev = cp;
  }
  return { nextCheckpoint: null, prevCheckpoint: prev };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    let body: { api_key?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.api_key !== "string" || body.api_key.length === 0) {
      return jsonResponse({ error: "api_key required" }, 400);
    }

    const keyPrefix = body.api_key.substring(0, 8);
    console.log(`get-group-data: api_key prefix=${keyPrefix}`);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("api_key", body.api_key)
      .maybeSingle();

    if (profileError) {
      console.error(
        "Profile lookup failed:",
        profileError.message,
        profileError.code,
      );
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    if (!profile) {
      console.warn(
        `get-group-data: no profile found for api_key prefix=${keyPrefix}`,
      );
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userId = profile.id as string;
    console.log(`get-group-data: resolved userId=${userId}`);

    // Include created_at so we can scope group steps and compute daysInGroup
    const { data: memberships, error: memberError } = await supabase
      .from("group_members")
      .select("group_id, groups(id, name, created_at)")
      .eq("user_id", userId);

    if (memberError) {
      console.error("group_members query failed:", memberError);
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    console.log(
      `get-group-data: found ${memberships?.length ?? 0} group memberships`,
    );

    if (!memberships || memberships.length === 0) {
      return jsonResponse({ groups: [] });
    }

    // Previous Mon–Sun (last full calendar week, UTC)
    const today = new Date();
    const dayOfWeek = today.getUTCDay(); // 0=Sun
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const lastSunday = new Date(today);
    lastSunday.setUTCDate(today.getUTCDate() - daysSinceMonday - 1);
    const lastMonday = new Date(lastSunday);
    lastMonday.setUTCDate(lastSunday.getUTCDate() - 6);
    const lastMondayStr = lastMonday.toISOString().split("T")[0];
    const lastSundayStr = lastSunday.toISOString().split("T")[0];

    // Last 7 calendar days — kept for backward compat with older app versions
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(today.getUTCDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

    const groups = [];

    for (const membership of memberships) {
      const groupId = membership.group_id as string;
      const groupMeta = membership.groups as {
        id: string;
        name: string;
        created_at: string;
      } | null;
      const groupName = groupMeta?.name ?? "";
      const groupCreatedAtStr = groupMeta?.created_at ?? "2000-01-01T00:00:00Z";
      const groupCreatedAtDate = groupCreatedAtStr.split("T")[0];
      const daysInGroup = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(groupCreatedAtStr).getTime()) / 86400000,
        ),
      );

      const { data: groupMembers, error: gmError } = await supabase
        .from("group_members")
        .select("user_id, profiles(display_name, total_steps)")
        .eq("group_id", groupId);

      if (gmError || !groupMembers) {
        console.error("group_members fetch failed:", gmError);
        continue;
      }

      const memberIds = groupMembers.map((m) => m.user_id as string);

      // Steps since group creation (used for group-scoped progress %)
      const { data: groupLogs } = await supabase
        .from("step_logs")
        .select("user_id, steps")
        .in("user_id", memberIds)
        .gte("date", groupCreatedAtDate);

      const groupStepsByUser: Record<string, number> = {};
      for (const log of groupLogs ?? []) {
        const uid = log.user_id as string;
        groupStepsByUser[uid] =
          (groupStepsByUser[uid] ?? 0) + (log.steps as number);
      }

      // Previous Mon–Sun steps (for last-week delta on detail view).
      // Clamp the lower bound to the group creation date so members don't see
      // pre-group history counting toward a delta while their group_steps is 0.
      const lastWeekStart =
        lastMondayStr > groupCreatedAtDate ? lastMondayStr : groupCreatedAtDate;
      const { data: lastWeekLogs } = await supabase
        .from("step_logs")
        .select("user_id, steps")
        .in("user_id", memberIds)
        .gte("date", lastWeekStart)
        .lte("date", lastSundayStr);

      const lastWeekByUser: Record<string, number> = {};
      for (const log of lastWeekLogs ?? []) {
        const uid = log.user_id as string;
        lastWeekByUser[uid] =
          (lastWeekByUser[uid] ?? 0) + (log.steps as number);
      }

      // Last 7 days steps (backward compat)
      const { data: recentLogs } = await supabase
        .from("step_logs")
        .select("user_id, steps")
        .in("user_id", memberIds)
        .gte("date", sevenDaysAgoStr);

      const last7ByUser: Record<string, number> = {};
      for (const log of recentLogs ?? []) {
        const uid = log.user_id as string;
        last7ByUser[uid] = (last7ByUser[uid] ?? 0) + (log.steps as number);
      }

      const members = groupMembers.map((m) => {
        const uid = m.user_id as string;
        const p = m.profiles as {
          display_name: string | null;
          total_steps: number;
        } | null;
        const groupSteps = groupStepsByUser[uid] ?? 0;
        const { nextCheckpoint, prevCheckpoint } = getCheckpointInfo(groupSteps);
        return {
          displayName: p?.display_name ?? "User",
          isCurrentUser: uid === userId,
          totalSteps: p?.total_steps ?? 0,
          groupSteps,
          last7DaysSteps: last7ByUser[uid] ?? 0,
          lastWeekSteps: lastWeekByUser[uid] ?? 0,
          nextCheckpoint,
          prevCheckpoint,
        };
      });

      members.sort((a, b) => b.groupSteps - a.groupSteps);

      groups.push({ id: groupId, name: groupName, daysInGroup, members });
    }

    return jsonResponse({ groups, totalSteps: 3_000_000 });
  } catch (err) {
    console.error("Unhandled error in get-group-data:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
