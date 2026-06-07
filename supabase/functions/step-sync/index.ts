import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface StepEntry {
  date: string;
  steps: number;
}

interface StepSyncRequest {
  // Batch format (new Garmin app)
  dates?: unknown;
  // Legacy single-entry format
  steps?: unknown;
  date?: unknown;
  api_key?: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseEntries(body: StepSyncRequest): StepEntry[] | null {
  const { dates, steps, date } = body;

  if (Array.isArray(dates)) {
    const entries: StepEntry[] = [];
    for (const raw of dates) {
      if (
        typeof raw === "object" &&
        raw !== null &&
        typeof (raw as Record<string, unknown>).date === "string" &&
        typeof (raw as Record<string, unknown>).steps === "number"
      ) {
        const e = raw as { date: string; steps: number };
        if (Number.isFinite(e.steps) && e.steps >= 0 && e.date.length > 0) {
          entries.push({ date: e.date, steps: e.steps });
        }
      }
    }
    return entries.length > 0 ? entries : null;
  }

  // Legacy single-entry format
  if (
    typeof steps === "number" &&
    Number.isFinite(steps) &&
    steps >= 0 &&
    typeof date === "string" &&
    date.length > 0
  ) {
    return [{ date: date as string, steps: steps as number }];
  }

  return null;
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
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    let body: StepSyncRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.api_key !== "string" || body.api_key.length === 0) {
      return jsonResponse({ error: "api_key required" }, 400);
    }

    const keyPrefix = body.api_key.substring(0, 8);
    const entries = parseEntries(body);
    if (!entries) {
      console.warn(`step-sync: no valid entries, api_key prefix=${keyPrefix}`);
      return jsonResponse({ error: "No valid step entries" }, 400);
    }

    console.log(`step-sync: api_key prefix=${keyPrefix} entries=${entries.length}`);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

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
      console.warn(`step-sync: no profile found for api_key prefix=${keyPrefix}`);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userId = profile.id as string;
    console.log(`step-sync: userId=${userId} syncing ${entries.length} date(s)`);

    for (const entry of entries) {
      const { error: upsertError } = await supabase.from("step_logs").upsert(
        { user_id: userId, date: entry.date, steps: entry.steps },
        { onConflict: "user_id,date" },
      );
      if (upsertError) {
        console.error(`step_logs upsert failed for ${entry.date}:`, upsertError);
      }
    }

    const { data: stepRows, error: sumError } = await supabase
      .from("step_logs")
      .select("steps")
      .eq("user_id", userId);

    if (sumError) {
      console.error("step_logs sum query failed:", sumError);
      return jsonResponse({ error: "Failed to compute total steps" }, 500);
    }

    const totalSteps = (stepRows ?? []).reduce(
      (total, row) => total + row.steps,
      0,
    );

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ total_steps: totalSteps })
      .eq("id", userId);

    if (updateError) {
      console.error("profiles.total_steps update failed:", updateError);
      return jsonResponse({ error: "Failed to update profile" }, 500);
    }

    return jsonResponse({ ok: true, entries: entries.length });
  } catch (err) {
    console.error("Unhandled error in step-sync:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
