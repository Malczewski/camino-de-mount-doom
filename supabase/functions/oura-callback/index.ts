import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in?: number;
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
    const clientId = Deno.env.get("OURA_CLIENT_ID");
    const clientSecret = Deno.env.get("OURA_CLIENT_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
      console.error("Missing required environment variables");
      return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }
    const jwt = authHeader.slice(7);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await adminClient.auth.getUser(jwt);
    if (userError || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    let body: { code?: unknown; redirect_uri?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }

    if (typeof body.code !== "string" || body.code.length === 0) {
      return jsonResponse({ ok: false, error: "code required" }, 400);
    }
    if (typeof body.redirect_uri !== "string" || body.redirect_uri.length === 0) {
      return jsonResponse({ ok: false, error: "redirect_uri required" }, 400);
    }

    //console.log(`oura-callback: exchanging code, client_id=${clientId}, redirect_uri=${body.redirect_uri}, code_prefix=${body.code.slice(0, 8)}`);

    const credentials = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch("https://api.ouraring.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: body.code,
        redirect_uri: body.redirect_uri,
      }),
    });

    const rawTokenBody = await tokenRes.text();
    //console.log(`oura-callback: token exchange status=${tokenRes.status} body=${rawTokenBody}`);

    if (!tokenRes.ok) {
      return jsonResponse({ ok: false, error: "Failed to exchange authorization code" }, 400);
    }

    let tokenData: OuraTokenResponse;
    try {
      tokenData = JSON.parse(rawTokenBody) as OuraTokenResponse;
    } catch {
      console.error("oura-callback: could not parse token response as JSON");
      return jsonResponse({ ok: false, error: "Invalid token response from Oura" }, 500);
    }

    if (!tokenData.access_token || !tokenData.refresh_token) {
      console.error("oura-callback: token response missing required fields");
      return jsonResponse({ ok: false, error: "Invalid token response from Oura" }, 500);
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    const connectedAt = new Date().toISOString();

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({
        oura_access_token: tokenData.access_token,
        oura_refresh_token: tokenData.refresh_token,
        oura_token_expires_at: expiresAt,
        oura_connected_at: connectedAt,
        oura_last_sync_date: null,
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("oura-callback: failed to store tokens:", updateError.message);
      return jsonResponse({ ok: false, error: "Failed to store tokens" }, 500);
    }

    console.log(`oura-callback: connected user ${user.id}`);
    return jsonResponse({ ok: true, connected_at: connectedAt });
  } catch (err) {
    console.error("Unhandled error in oura-callback:", err);
    return jsonResponse({ ok: false, error: "Internal server error" }, 500);
  }
});
