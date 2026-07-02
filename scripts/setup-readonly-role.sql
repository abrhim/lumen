-- Scoped read-only role for the web app (SEC-1). The app should never connect
-- as postgres: that bypasses RLS and grants DDL. Run with :password set, e.g.
--   psql -v password='...' -f scripts/setup-readonly-role.sql
-- (or via node with the placeholder substituted from env)

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lumen_read') THEN
    CREATE ROLE lumen_read LOGIN PASSWORD :'password';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA lumen TO lumen_read;
GRANT SELECT ON ALL TABLES IN SCHEMA lumen TO lumen_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA lumen GRANT SELECT ON TABLES TO lumen_read;
