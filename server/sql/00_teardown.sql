-- ============================================================================
--  00_teardown.sql - DESTRUCTIVE full reset
-- ----------------------------------------------------------------------------
--  Drops every schema this app owns so 01..12 can recreate them from scratch.
--  This DELETES ALL DATA. It is intentionally NOT run by initDb().
--
--  Run it deliberately, e.g.:
--     psql "$POSTGRESQL_CONN" -v confirm=YES -f server/sql/00_teardown.sql
--  The guard below aborts unless you pass -v confirm=YES.
--
--  Note: the `interaction` schema here is the LOCAL MIRROR in this app's DB.
--  The interaction-service microservice has its own separate database which
--  this script does NOT touch.
-- ============================================================================

\if :{?confirm}
\else
  \echo '*** Refusing to drop: re-run with  -v confirm=YES  to confirm teardown ***'
  \quit
\endif

\echo 'Tearing down all schemas (app, manual, ga_landing, shopify, shopline, odoo, commerce, interaction, public)...'

DROP SCHEMA IF EXISTS app         CASCADE;
DROP SCHEMA IF EXISTS manual      CASCADE;
DROP SCHEMA IF EXISTS ga_landing  CASCADE;
DROP SCHEMA IF EXISTS shopify     CASCADE;
DROP SCHEMA IF EXISTS shopline    CASCADE;
DROP SCHEMA IF EXISTS odoo        CASCADE;
DROP SCHEMA IF EXISTS commerce    CASCADE;
DROP SCHEMA IF EXISTS interaction CASCADE;

-- public held only throwaway LinkedU test data - drop its tables but keep the
-- schema itself (Postgres needs public to exist; extensions live there).
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;

\echo 'Teardown complete. Now run 01_extensions.sql .. 12_profiles_identity.sql, then seed.'
