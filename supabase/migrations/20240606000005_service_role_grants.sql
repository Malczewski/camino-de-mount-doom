-- Edge functions (e.g. step-sync) use the service_role key to look up profiles
-- by api_key and write step_logs without a user JWT.

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON step_logs TO service_role;
