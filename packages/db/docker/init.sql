-- Runs once, as the postgres superuser, on first DB init
-- (mounted into /docker-entrypoint-initdb.d).
--
-- Create the non-superuser, NOBYPASSRLS app role that OWNS the databases,
-- so FORCE ROW LEVEL SECURITY applies to it. A superuser (or a BYPASSRLS role)
-- would silently skip RLS policies, defeating tenant isolation.
CREATE ROLE erp LOGIN PASSWORD 'erp' NOSUPERUSER NOCREATEDB NOBYPASSRLS;
CREATE DATABASE erp OWNER erp;
CREATE DATABASE erp_test OWNER erp;
