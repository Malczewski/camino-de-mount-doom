-- Camino de Mt.Doom — core schema
-- Idempotent: safe if you already ran supabase/init.sql manually.

CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  total_steps  BIGINT NOT NULL DEFAULT 0,
  group_id     UUID REFERENCES groups(id) ON DELETE SET NULL,
  api_key      TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_group_id_idx ON profiles(group_id);
CREATE INDEX IF NOT EXISTS profiles_api_key_idx ON profiles(api_key);

CREATE TABLE IF NOT EXISTS step_logs (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  steps   INTEGER NOT NULL CHECK (steps >= 0),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS step_logs_user_id_idx ON step_logs(user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
