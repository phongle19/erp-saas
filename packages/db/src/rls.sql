-- Company-scoped Row-Level Security (single-role + FORCE + GUC-driven).
-- The application connects as a NON-superuser role and sets, per transaction:
--   SELECT set_config('app.user_id', '<uuid>', true);
--   SELECT set_config('app.is_admin', 'true'|'false', true);
--   SELECT set_config('app.accessible_companies', '<uuid,uuid,...>', true);  -- may be empty
-- Policies FAIL CLOSED: an unset/empty GUC yields an empty company set => no rows, no writes.
-- FORCE makes RLS apply even to the table-owner role (so a single role is sufficient).
-- Superusers always bypass RLS, so seed/migrate must NOT run as a superuser if they rely on RLS;
-- migrate only runs DDL (not subject to RLS) and seed runs in an explicit admin GUC context.

CREATE OR REPLACE FUNCTION app_accessible_companies() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.accessible_companies', true), '') = '' THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.accessible_companies', true), ',')::uuid[]
  END;
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.is_admin', true), 'false') = 'true';
$$;

-- companies: a company is visible/writable if admin, or its own id is granted
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_access ON companies;
CREATE POLICY companies_access ON companies
  USING (app_is_admin() OR id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR id = ANY(app_accessible_companies()));

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coa_access ON chart_of_accounts;
CREATE POLICY coa_access ON chart_of_accounts
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_access ON group_memberships;
CREATE POLICY gm_access ON group_memberships
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

ALTER TABLE ownership_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ol_access ON ownership_links;
CREATE POLICY ol_access ON ownership_links
  USING (app_is_admin() OR parent_company_id = ANY(app_accessible_companies()) OR child_company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR parent_company_id = ANY(app_accessible_companies()) OR child_company_id = ANY(app_accessible_companies()));

-- groups are owner-global (single tenant): any authenticated user may read; only admin may write.
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS groups_read ON groups;
CREATE POLICY groups_read ON groups USING (true) WITH CHECK (app_is_admin());
