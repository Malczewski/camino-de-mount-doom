import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOTAL_STEPS_TARGET = 1_300_000;

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

    // Resolve API key → user
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("api_key", body.api_key)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed:", profileError.message, profileError.code);
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    if (!profile) {
      console.warn(`get-group-data: no profile found for api_key prefix=${keyPrefix}`);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    console.log(`get-group-data: resolved userId=${profile.id}`);

    const userId = profile.id as string;

    // Get all groups this user belongs to
    const { data: memberships, error: memberError } = await supabase
      .from("group_members")
      .select("group_id, groups(id, name)")
      .eq("user_id", userId);

    if (memberError) {
      console.error("group_members query failed:", memberError);
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    console.log(`get-group-data: found ${memberships?.length ?? 0} group memberships`);

    if (!memberships || memberships.length === 0) {
      return jsonResponse({ groups: [] });
    }

    // 7-day window
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

    const groups = [];

    for (const membership of memberships) {
      const groupId = membership.group_id as string;
      const groupMeta = membership.groups as { id: string; name: string } | null;
      const groupName = groupMeta?.name ?? "";

      // All members of this group + their profiles
      const { data: groupMembers, error: gmError } = await supabase
        .from("group_members")
        .select("user_id, profiles(display_name, total_steps)")
        .eq("group_id", groupId);

      if (gmError || !groupMembers) {
        console.error("group_members fetch failed:", gmError);
        continue;
      }

      const memberIds = groupMembers.map((m) => m.user_id as string);

      // Last 7 days steps for all members in one query
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
        const p = m.profiles as {
          display_name: string | null;
          total_steps: number;
        } | null;
        return {
          displayName: p?.display_name ?? "User",
          totalSteps: p?.total_steps ?? 0,
          last7DaysSteps: last7ByUser[m.user_id as string] ?? 0,
        };
      });

      // Sort by total steps descending so leader is at top
      members.sort((a, b) => b.totalSteps - a.totalSteps);

      groups.push({ id: groupId, name: groupName, members });
    }

    return jsonResponse({ groups });
  } catch (err) {
    console.error("Unhandled error in get-group-data:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
