# Oura Ring Integration Setup

This doc covers every manual step required to get the Oura Ring integration running. Code changes are already in the repo — you just need to wire up credentials and deploy.

---

## 1. Create an Oura OAuth application

1. Sign in to [cloud.ouraring.com/oauth/applications](https://cloud.ouraring.com/oauth/applications).
2. Click **New Application**.
3. Fill in:
   - **Name**: Camino de Mount Doom (or anything you like)
   - **Redirect URIs**: add both your production URL and localhost for development:
     ```
     https://camino-de-mount-doom.netlify.app/
     http://localhost:5173/
     ```
   - **Scopes**: check **Daily Activity** (`daily`)
4. Save. Note the **Client ID** and **Client Secret**.

---

## 2. Run the database migration

```bash
supabase db push
```

This applies `supabase/migrations/20260611000001_oura_tokens.sql`, which adds the Oura token columns to the `profiles` table.

If you already ran migrations manually via the Dashboard, mark it applied instead:

```bash
supabase migration repair --status applied 20260611000001
```

---

## 3. Set Supabase edge function secrets

In the Supabase Dashboard → **Edge Functions** → **Manage secrets**, add:

| Secret name         | Value                                               |
|---------------------|-----------------------------------------------------|
| `OURA_CLIENT_ID`    | Client ID from step 1                               |
| `OURA_CLIENT_SECRET`| Client Secret from step 1                          |
| `OURA_REDIRECT_URI` | `https://camino-de-mount-doom.netlify.app/` (production URL, must exactly match what you registered in Oura) |
| `OURA_CRON_SECRET`  | Any random secret string you choose, e.g. `openssl rand -hex 32` |

---

## 4. Deploy the edge functions

```bash
supabase functions deploy oura-callback
supabase functions deploy oura-sync --no-verify-jwt
```

`oura-callback` uses JWT auth (called from the browser with the user's session).  
`oura-sync` uses either a cron secret header (cron) or JWT (manual user sync) — hence `--no-verify-jwt`.

---

## 5. Set frontend environment variables

Add to your `.env` (and Netlify environment variables for production):

```env
VITE_OURA_CLIENT_ID=your_client_id_from_step_1
VITE_OURA_REDIRECT_URI=https://camino-de-mount-doom.netlify.app/
```

For local development, also add:

```env
VITE_OURA_REDIRECT_URI=http://localhost:5173/
```

> The `VITE_OURA_REDIRECT_URI` value must **exactly** match one of the redirect URIs registered in the Oura app.

---

## 6. Set up the cron jobs

The sync function runs daily at **10:00 UTC** and **00:00 UTC**.

### Prerequisites

Enable the `pg_net` extension in the Supabase Dashboard:  
**Database → Extensions → pg_net → Enable**

(`pg_cron` is already enabled by default on Supabase.)

### Run the cron SQL

Open the Supabase Dashboard → **SQL Editor** → **New query**.

Copy `supabase/cron.sql`, replace the two placeholders, and run it:

| Placeholder         | Replace with                                      |
|---------------------|---------------------------------------------------|
| `YOUR_PROJECT_REF`  | Your Supabase project reference (from Dashboard → Settings → General) |
| `YOUR_CRON_SECRET`  | The value you set for `OURA_CRON_SECRET` in step 3 |

To verify the jobs were created:

```sql
SELECT jobname, schedule FROM cron.job;
```

---

## 7. Test the integration

**Test OAuth flow:**
1. Open the web app → Profile tab.
2. Click **Connect Oura Ring** — you should be redirected to Oura's auth page.
3. Approve access and you're redirected back. The Profile page should show "Connected since…".

**Test manual sync:**
1. On the Profile tab, click **Sync now**.
2. The step count should update within a few seconds.

**Test cron sync manually:**
```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/oura-sync" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -d '{}'
```

Expected response: `{"ok":true,"synced":N}` where N is the number of connected users.

---

## Notes

- **Token storage**: Access and refresh tokens are stored in the `profiles` table. They are only accessible to edge functions via the service role key — no frontend query selects them.
- **Token refresh**: `oura-sync` automatically refreshes the access token when it expires (tokens are valid for 24 hours). If the refresh fails (e.g. user revoked access in Oura), that user is skipped and logged.
- **Step data conflicts**: If a user has both Garmin and Oura connected, both write to the same `step_logs(user_id, date)` row (upsert). The most recent sync wins. Oura's midnight sync will typically have the final step count for the day.
- **First sync lookback**: On first connect, the sync fetches up to 30 days of history (or since account creation, whichever is more recent).
- **Re-sync yesterday**: Every sync starts from `oura_last_sync_date` (the date of the previous sync), not from today. This ensures Oura's finalized data for the previous day is captured.
