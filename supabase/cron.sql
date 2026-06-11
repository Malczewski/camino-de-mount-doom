-- Oura sync cron jobs — run this SQL once in the Supabase Dashboard SQL Editor
-- after deploying the oura-sync edge function.
--
-- Prerequisites:
--   1. pg_net extension enabled:  Extensions → pg_net → Enable
--   2. OURA_CRON_SECRET set in edge function secrets (Supabase Dashboard →
--      Edge Functions → oura-sync → Secrets)
--   3. oura-sync deployed: supabase functions deploy oura-sync --no-verify-jwt
--
-- Replace the two placeholders below with your actual values before running:
--   YOUR_PROJECT_REF  — found in Dashboard → Settings → General
--   YOUR_CRON_SECRET  — the value you set for OURA_CRON_SECRET

SELECT cron.schedule(
  'oura-sync-morning',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/oura-sync',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'oura-sync-midnight',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/oura-sync',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- To verify jobs were created:
-- SELECT jobname, schedule, command FROM cron.job;

-- To remove jobs if needed:
-- SELECT cron.unschedule('oura-sync-morning');
-- SELECT cron.unschedule('oura-sync-midnight');
