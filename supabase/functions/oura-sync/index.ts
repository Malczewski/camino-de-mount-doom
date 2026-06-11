import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OuraProfile {
  id: string;
  oura_access_token: string;
  oura_refresh_token: string | null;
  oura_token_expires_at: string | null;
  oura_last_sync_date: string | null;
  created_at: string;
}

interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

interface OuraDailyActivity {
  day: string;
  steps: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function utcDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getStartDate(profile: OuraProfile): string {
  if (profile.oura_last_sync_date) {
    // Re-sync from the last sync date so the previous day's final step count
    // is captured (Oura may finalize data hours after midnight).
    return profile.oura_last_sync_date;
  }
  // First sync: go back 30 days or to account creation, whichever is more recent.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const createdAt = new Date(profile.created_at);
  return utcDateStr(createdAt > thirtyDaysAgo ? createdAt : thirtyDaysAgo);
}

async function refreshToken(
  adminClient: SupabaseClient,
  profile: OuraProfile,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  if (!profile.oura_refresh_token) return null;

  const res = await fetch("https://api.ouraring.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: profile.oura_refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    console.error(
      `oura-sync: token refresh failed for user ${profile.id} (${res.status}):`,
      await res.text(),
    );
    return null;
  }

  const data = await res.json() as OuraTokenResponse;
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  const { error } = await adminClient.from("profiles").update({
    oura_access_token: data.access_token,
    oura_refresh_token: data.refresh_token,
    oura_token_expires_at: expiresAt,
  }).eq("id", profile.id);

  if (error) {
    console.error(`oura-sync: failed to persist refreshed token for ${profile.id}:`, error.message);
  }

  return data.access_token;
}

async function syncUser(
  adminClient: SupabaseClient,
  profile: OuraProfile,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const today = utcDateStr(new Date());

  // Refresh token if it expires within the next 5 minutes.
  let accessToken = profile.oura_access_token;
  const expiresAt = profile.oura_token_expires_at
    ? new Date(profile.oura_token_expires_at)
    : null;

  if (!expiresAt || expiresAt <= new Date(Date.now() + 5 * 60 * 1000)) {
    const refreshed = await refreshToken(adminClient, profile, clientId, clientSecret);
    if (!refreshed) {
      console.error(`oura-sync: skipping user ${profile.id} — token refresh failed`);
      return today;
    }
    accessToken = refreshed;
  }

  const startDate = getStartDate(profile);
  console.log(`oura-sync: user=${profile.id} range=${startDate}..${today}`);

  const url = new URL("https://api.ouraring.com/v2/usercollection/daily_activity");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", today);

  let activityRes = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });

  // On 401 the stored token is expired or revoked regardless of oura_token_expires_at.
  // Attempt one token refresh and retry before giving up.
  if (activityRes.status === 401) {
    console.warn(`oura-sync: 401 for user ${profile.id}, attempting token refresh`);
    const refreshed = await refreshToken(adminClient, profile, clientId, clientSecret);
    if (!refreshed) {
      console.error(`oura-sync: skipping user ${profile.id} — token refresh failed after 401`);
      return today;
    }
    accessToken = refreshed;
    activityRes = await fetch(url.toString(), {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
  }

  if (!activityRes.ok) {
    const errText = await activityRes.text();
    console.error(
      `oura-sync: Oura API error for user ${profile.id} (${activityRes.status}):`,
      errText,
    );
    return today;
  }

  const activityData = await activityRes.json() as { data?: OuraDailyActivity[] };
  const entries = activityData.data ?? [];

  for (const entry of entries) {
    if (typeof entry.steps !== "number" || entry.steps < 0 || !entry.day) continue;

    const { error: upsertError } = await adminClient.from("step_logs").upsert(
      { user_id: profile.id, date: entry.day, steps: entry.steps },
      { onConflict: "user_id,date" },
    );
    if (upsertError) {
      console.error(
        `oura-sync: step_logs upsert failed for user=${profile.id} date=${entry.day}:`,
        upsertError.message,
      );
    }
  }

  // Recalculate total_steps from all step_logs for this user.
  const { data: stepRows, error: sumError } = await adminClient
    .from("step_logs")
    .select("steps")
    .eq("user_id", profile.id);

  if (sumError) {
    console.error(`oura-sync: sum query failed for user ${profile.id}:`, sumError.message);
    return today;
  }

  const totalSteps = (stepRows ?? []).reduce((sum, r) => sum + r.steps, 0);

  const { error: updateError } = await adminClient.from("profiles").update({
    total_steps: totalSteps,
    oura_last_sync_date: today,
  }).eq("id", profile.id);

  if (updateError) {
    console.error(`oura-sync: profile update failed for user ${profile.id}:`, updateError.message);
  } else {
    console.log(
      `oura-sync: user=${profile.id} synced ${entries.length} day(s) total_steps=${totalSteps}`,
    );
  }

  return today;
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
    const clientId = Deno.env.get("OURA_CLIENT_ID");
    const clientSecret = Deno.env.get("OURA_CLIENT_SECRET");
    const cronSecret = Deno.env.get("OURA_CRON_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
      console.error("oura-sync: missing required environment variables");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Determine caller: cron (x-cron-secret header) or authenticated user (JWT).
    const incomingCronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization");

    let targetUserId: string | null = null;

    if (cronSecret && incomingCronSecret === cronSecret) {
      // Cron mode — sync every user that has connected Oura.
      targetUserId = null;
    } else if (authHeader?.startsWith("Bearer ")) {
      // Per-user mode — sync only the authenticated user.
      const jwt = authHeader.slice(7);
      const { data: { user }, error: userError } = await adminClient.auth.getUser(jwt);
      if (userError || !user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      targetUserId = user.id;
    } else {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const baseQuery = adminClient
      .from("profiles")
      .select(
        "id, oura_access_token, oura_refresh_token, oura_token_expires_at, oura_last_sync_date, created_at",
      )
      .not("oura_access_token", "is", null);

    const { data: profiles, error: profilesError } = targetUserId
      ? await baseQuery.eq("id", targetUserId)
      : await baseQuery;

    if (profilesError) {
      console.error("oura-sync: profiles query failed:", profilesError.message);
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    if (!profiles?.length) {
      return jsonResponse({ ok: true, synced: 0 });
    }

    let lastSyncDate = "";
    for (const profile of profiles as OuraProfile[]) {
      lastSyncDate = await syncUser(adminClient, profile, clientId, clientSecret);
    }

    const result: Record<string, unknown> = { ok: true, synced: profiles.length };
    // When called for a single user (per-user mode), return the sync date so the
    // frontend can update its display without a full profile reload.
    if (targetUserId) result.last_sync_date = lastSyncDate;

    return jsonResponse(result);
  } catch (err) {
    console.error("Unhandled error in oura-sync:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
