# Postgres image with the first-init script baked in, so it works regardless of
# host bind-mount / file-sharing quirks. init.sql runs once (as the postgres
# superuser) on an empty data dir: it creates the non-superuser 'erp' role and
# the erp / erp_test databases it owns.
FROM postgres:16
COPY init.sql /docker-entrypoint-initdb.d/init.sql
