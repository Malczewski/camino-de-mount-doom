import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface StepSyncRequest {
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
      console.error("Failed to parse request JSON");
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const { steps, date, api_key } = body;

    if (
      typeof steps !== "number" ||
      !Number.isFinite(steps) ||
      steps < 0 ||
      typeof date !== "string" ||
      date.length === 0 ||
      typeof api_key !== "string" ||
      api_key.length === 0
    ) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("api_key", api_key)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed:", profileError);
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    if (!profile) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userId = profile.id as string;

    const { error: upsertError } = await supabase.from("step_logs").upsert(
      { user_id: userId, date, steps },
      { onConflict: "user_id,date" },
    );

    if (upsertError) {
      console.error("step_logs upsert failed:", upsertError);
      return jsonResponse({ error: "Failed to save steps" }, 500);
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

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("Unhandled error in step-sync:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
