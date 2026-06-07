# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

Camino de Mount Doom is a step-tracking app that maps cumulative Garmin watch steps onto a Middle-earth route from Bag End to Mount Doom. Three separate systems work together:

1. **Garmin watch app** (Monkey C) — hourly background sync of daily step counts
2. **React web app** (TypeScript + Vite) — live fellowship map, group management, profile
3. **Supabase backend** — Postgres, Auth, Realtime, and an Edge Function for the watch sync endpoint

## Commands

```bash
# Web app
npm run dev        # local dev server → http://localhost:5173
npm run build      # tsc -b && vite build → dist/
npm run preview    # preview production build

# Supabase Edge Function
supabase functions deploy step-sync --no-verify-jwt

# Database migrations
supabase link --project-ref <ref>
supabase db push

# Garmin watch app (requires Garmin Connect IQ SDK)
monkeyc -o camino-de-mount-doom.prg -f garmin-app/monkey.jungle -y garmin-app/developer_key.der
```

There are no automated tests.

## Environment Variables

Copy `.env.example` to `.env` and fill in:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase anon key (public, safe for client)

## Architecture

### Data Flow

```
Garmin watch
  → POST /functions/v1/step-sync  (api_key auth, no JWT)
  → upserts step_logs(user_id, date, steps)
  → recalculates profiles.total_steps

Web app
  ← Supabase Realtime subscriptions (step_logs, profiles, group_members)
  ← RPC get_group_members(group_id) → members + group_steps
```

### Step Counting Logic

`total_steps` on `profiles` is always the **all-time lifetime total** (sum of all `step_logs`). Per-group progress is computed separately by `get_group_members()`, which only sums `step_logs` with `date >= group.created_at`. This means joining a group later gives you a fresh start for that group while preserving your lifetime total.

### Route Positioning (`src/lib/mapPosition.ts`)

The route is defined as `LANDMARKS` (9 checkpoints, ~3.56M steps total) and `RouteConfig` (an array of `{x, y}` percentage positions on the map image). `getPositionOnRoute()` interpolates between route points proportionally to step count. The Editor component lets users draw custom routes with optional Catmull-Rom spline smoothing; custom routes are saved to `localStorage`.

### Watch Auth

The Garmin watch cannot handle OAuth/JWT refresh flows. Instead, each user has a random `api_key` in their `profiles` row (generated on signup via a Postgres trigger). The watch stores this key in device settings (entered via the `garmin-auth.html` settings web view served at the Netlify URL). The `step-sync` Edge Function is deployed with `--no-verify-jwt` and validates only via `api_key`.

### Garmin App Entry Points

- `App.mc` — registers a 3600s background temporal event; if no `api_key` is stored, opens the settings URL in the app
- `BackgroundService.mc` — handles the temporal event, calls `StepSync.sync()`
- `StepSync.mc` — reads `ActivityMonitor.steps` (resets daily at midnight), POSTs `{steps, date, api_key}` to the edge function

### Static HTML Files

`garmin-auth.html` and `privacy-policy.html` live at the repo root and are copied to `dist/` during build by a custom Vite plugin in `vite.config.ts`. They are standalone pages, not part of the React app.

### Routing in the React App

The React app uses hash-based routing: navigating to `#editor` renders the `Editor` component; everything else renders the main app (`App.tsx`). There is no React Router.

### Database Schema

Key tables: `groups`, `profiles`, `group_members`, `step_logs`. The `get_group_members` RPC is the primary read path for the map — it returns members with `group_steps` scoped to the group's creation date. Row-level security is enabled; the `step-sync` function uses the service role key (not anon) to bypass RLS when upserting step data.

## Deployment

- Web app deploys as static files to Netlify (live at https://camino-de-mount-doom.netlify.app/)
- Garmin watch app is sideloaded via Garmin Connect (`.prg` file)
- Database schema can be initialized either via `init.sql` pasted into the Supabase Dashboard SQL Editor, or via `supabase db push` using the migration files in `supabase/migrations/`
