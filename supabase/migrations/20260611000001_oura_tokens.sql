-- Oura Ring OAuth token storage and sync tracking.
-- Tokens are only read by edge functions via the service role key;
-- no frontend query should select these columns.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS oura_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS oura_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS oura_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oura_connected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oura_last_sync_date DATE;
