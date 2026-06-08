# Camino de Mount Doom

**Demo:** [https://camino-de-mount-doom.netlify.app/](https://camino-de-mount-doom.netlify.app/)

Track all-day steps from a Garmin watch, map cumulative progress on a Middle-earth route, and see your fellowship move in real time on a shared map. Users can belong to multiple groups; each group tracks progress independently from its creation date.

| Component | Technology |
|-----------|------------|
| Watch app | Garmin Connect IQ (Monkey C), background sync |
| Auth web view | `garmin-auth.html` (Supabase login → Garmin settings) |
| Backend | Supabase (Postgres, Auth, Realtime, Edge Functions) |
| Map app | React + Vite (web) |

## Architecture

```
Garmin Watch (Connect IQ)
  │  ActivityMonitor.steps (hourly background sync)
  │  Bluetooth → Garmin Connect on phone
  ▼
Garmin Connect app
  │  POST { steps, date, api_key }
  ▼
Supabase Edge Function (step-sync)
  │  upsert step_logs, update profiles.total_steps
  ▼
Supabase Postgres + Realtime
  ▼
Web map app (this repo)
  live markers for group members
```

**Auth (one-time per watch):** Garmin Connect opens `garmin-auth.html` in a settings web view. After login, the page writes the user's long-lived `api_key` from `profiles` into watch settings via `window.garmin.settings.set('api_key', …)`.

## Repository layout

```
├── src/                    Web map app (React + Vite)
├── garmin-app/             Connect IQ background watch app (Monkey C)
├── garmin-auth.html        Garmin settings web view (deploy over HTTPS)
├── privacy-policy.html     GDPR privacy policy (static)
├── public/map.jpg          Middle-earth map image
├── supabase/
│   ├── init.sql            One-shot schema + RLS + realtime (Dashboard paste)
│   ├── migrations/         Ordered migrations for Supabase CLI
│   ├── config.toml         CLI config (step-sync: verify_jwt = false)
│   └── functions/step-sync Edge function for watch step POSTs
└── .env.example            Web app environment template
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Supabase](https://supabase.com) project (free tier)
- [Garmin Developer](https://developer.garmin.com) account + [Connect IQ SDK](https://developer.garmin.com/connect-iq/sdk/)
- Garmin Connect app on your phone
- HTTPS hosting for `garmin-auth.html` (Vercel, Netlify, or `npm run build` output)

## 1. Database setup

### Option A — Supabase Dashboard

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → **New query**.
3. Paste and run the entire contents of [`supabase/init.sql`](supabase/init.sql).

### Option B — Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

Migrations run in order from `supabase/migrations/`. They are idempotent — safe if you already ran `init.sql` manually.

**Already set up via Dashboard?** Either run `supabase db push` again (migrations now skip existing objects), or tell the CLI the migrations are applied:

```bash
supabase migration repair --status applied 20240606000001
supabase migration repair --status applied 20240606000002
supabase migration repair --status applied 20240606000003
supabase migration repair --status applied 20240606000004
supabase migration repair --status applied 20240606000005
supabase migration repair --status applied 20260607000001
supabase migration repair --status applied 20260607000002
```

Do **not** use both `init.sql` and `db push` on a fresh project — pick one path.

### Schema summary

| Table | Purpose |
|-------|---------|
| `profiles` | User profile, `display_name`, `total_steps` (global), `api_key` for watch auth |
| `groups` | Fellowship name, 8-char `invite_code`, `created_at` |
| `group_members` | Many-to-many: users ↔ groups, with `joined_at` |
| `step_logs` | Daily step counts (`user_id`, `date`, `steps`) |

A user can belong to **multiple groups**. Within each group, progress is counted from `groups.created_at` (via the `get_group_members` RPC), so everyone starts at 0 regardless of prior global steps. A trigger creates a `profiles` row (with random `api_key`) on signup.

Realtime is enabled on `profiles`, `group_members`, and `step_logs` for live map updates.

## 2. Edge function — step sync

Deploy the function that receives watch POSTs:

```bash
supabase functions deploy step-sync --no-verify-jwt
```

The function URL is:

```
https://<project-ref>.supabase.co/functions/v1/step-sync
```

Set this as `EDGE_FUNCTION_URL` in `garmin-app/source/StepSync.mc`.

**Test manually:**

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/step-sync" \
  -H "Content-Type: application/json" \
  -d '{"steps": 4200, "date": "2026-06-06", "api_key": "your-api-key-from-profiles"}'
```

Expected response: `{"ok":true}`

## 3. Auth web page (Garmin settings)

1. Edit `garmin-auth.html` meta tags (or inject at deploy time):

   ```html
   <meta name="SUPABASE_URL" content="https://your-project.supabase.co">
   <meta name="SUPABASE_ANON_KEY" content="your-publishable-or-anon-key">
   ```

2. Deploy over **HTTPS** — Garmin Connect will not load HTTP settings URLs.

   - Host only the static pages: `npm run build` copies `garmin-auth.html` and `privacy-policy.html` into `dist/`.
   - Or deploy `garmin-auth.html` alone to Vercel/Netlify.

3. Set the deployed URL in `garmin-app/manifest.xml`:

   ```xml
   settingsView="https://your-domain.com/garmin-auth.html"
   ```

## 4. Connect IQ watch app

```bash
cd garmin-app
monkeyc -o camino-de-mount-doom.prg -f monkey.jungle -y developer_key.der
```

- Sideload `camino-de-mount-doom.prg` via Garmin Connect or Garmin Express for private use.
- Open **My Device → Camino de Mount Doom → Settings** in Garmin Connect and sign in.
- Background sync runs on a temporal event (default: hourly; minimum on most devices: 5 minutes for testing).

**Permissions** (in `manifest.xml`): `BACKGROUND_SYNC`, `COMMUNICATIONS`, `FIT_CONTRIBUTOR`.

**Requirements:** Garmin Connect installed, logged in, and phone has internet when sync runs. HTTP is relayed through the phone, not directly from the watch.

## 5. Web map app

```bash
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY

npm install
npm run dev        # http://localhost:5173
npm run build      # output in dist/
npm run preview    # preview production build
```

### Screens

- **Map** — pannable/zoomable Middle-earth map with live member markers and named landmark pins (~3M steps = Bag End → Mount Doom). Dropdown to switch between groups when in multiple.
- **Group** — list of all your fellowships, each showing invite code, members with group-relative progress, and a leave button. Create new groups or join via invite code at any time.
- **Profile** — your global stats, editable display name, log out, delete account.

### Environment variables

| Variable | Used by |
|----------|---------|
| `VITE_SUPABASE_URL` | Web app |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Web app |

Get both from Supabase Dashboard → **Settings → API**.

## Recommended build order

1. Run database setup (`supabase/init.sql` or `supabase db push`)
2. Deploy `garmin-auth.html` → note HTTPS URL
3. Build & sideload watch app with auth URL + edge function URL
4. Deploy `step-sync` edge function → test with `curl`
5. Connect watch in Garmin Connect settings → wait for first sync (or use 300s interval for testing)
6. Run web app → sign up → create/join group → confirm realtime markers

## Gotchas

| Topic | Notes |
|-------|-------|
| Temporal event interval | Minimum ~5 minutes on most devices; 3600s is battery-friendly for production |
| Step count resets | `ActivityMonitor` steps reset at midnight; sync sends today's count and upserts by `date` |
| API key vs JWT | Watch uses long-lived `profiles.api_key`, not JWT — avoids refresh complexity |
| Free tier pause | Supabase pauses after ~1 week of inactivity; daily watch syncs keep the project alive |
| Map asset | Use a fan-made CC Middle-earth map (`public/map.jpg`); avoid commercial Tolkien/New Line assets |

## Privacy

Host [`privacy-policy.html`](privacy-policy.html) alongside the app. Replace `[YOUR_EMAIL]` before publishing. Users can delete their account from the Profile screen.

---

*Not all those who wander are lost — but their steps are now in Postgres.*
