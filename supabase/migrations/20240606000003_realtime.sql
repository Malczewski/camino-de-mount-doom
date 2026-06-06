-- Enable Supabase Realtime on tables the map app subscribes to.
-- Safe to re-run: skips tables already in the publication.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'step_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE step_logs;
  END IF;
END $$;
