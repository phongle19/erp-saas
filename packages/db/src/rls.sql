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

-- =====================================================================
-- Phase 1 Task 4: accounting tables RLS + integrity triggers
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Company-scoped RLS (ENABLE + FORCE + USING + WITH CHECK)
-- ---------------------------------------------------------------------
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ap_access ON accounting_periods;
CREATE POLICY ap_access ON accounting_periods
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS je_access ON journal_entries;
CREATE POLICY je_access ON journal_entries
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jl_access ON journal_lines;
CREATE POLICY jl_access ON journal_lines
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- ---------------------------------------------------------------------
-- 2. Deferred double-entry balance enforcement (CONSTRAINT TRIGGER @ COMMIT)
--    A balanced entry := has >= 1 line AND SUM(debit_minor) = SUM(credit_minor).
--    Deferred to COMMIT so a multi-line entry is validated once, after all
--    lines of the tx are present. The "entry still exists" guard makes the
--    cascade-delete of a draft entry+lines safe (the per-line deferred check
--    fires for the deleted lines, but the owning entry is already gone).
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS jl_balance_check ON journal_lines;
DROP TRIGGER IF EXISTS je_balance_check ON journal_entries;
DROP FUNCTION IF EXISTS enforce_entry_balanced();

CREATE FUNCTION enforce_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id uuid;
  v_exists   boolean;
  v_count    bigint;
  v_debit    bigint;
  v_credit   bigint;
BEGIN
  -- Identify the affected entry from whichever table fired the trigger.
  IF TG_TABLE_NAME = 'journal_lines' THEN
    v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
  ELSE
    v_entry_id := COALESCE(NEW.id, OLD.id);
  END IF;

  -- Skip if the entry was deleted within this tx (cascade-delete of draft).
  SELECT EXISTS (SELECT 1 FROM journal_entries WHERE id = v_entry_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN NULL;
  END IF;

  SELECT count(*), COALESCE(sum(debit_minor), 0), COALESCE(sum(credit_minor), 0)
    INTO v_count, v_debit, v_credit
    FROM journal_lines
   WHERE entry_id = v_entry_id;

  IF v_count = 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'journal entry % is unbalanced or empty (debit=%, credit=%)',
      v_entry_id, v_debit, v_credit;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER jl_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_entry_balanced();

CREATE CONSTRAINT TRIGGER je_balance_check
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_entry_balanced();

-- ---------------------------------------------------------------------
-- 3. Immutability of posted/reversed entries (BEFORE INSERT/UPDATE/DELETE)
--    CHOSEN RULE:
--      * journal_entries:
--          - DELETE of a posted/reversed entry  -> always blocked.
--          - UPDATE of a posted/reversed entry  -> blocked, EXCEPT the single
--            legitimate transition posted -> reversed (the P6 reversal flow
--            marks the original entry 'reversed'). That exception additionally
--            requires every other column to be unchanged, so no financial or
--            identifying field can ride along with the status flip.
--          - draft entries -> freely editable / deletable.
--      * journal_lines:
--          - any INSERT/UPDATE/DELETE of a line whose owning entry is
--            posted/reversed -> blocked. INSERT is included to close the hole
--            where a balanced line pair (e.g. debit 1M + credit 1M) could be
--            inserted into a posted entry and pass the deferred balance check,
--            silently altering the entry's account distribution.
--          - lines of a draft entry -> freely editable / deletable.
--
--    P6 POSTING FLOW — REQUIRED SEQUENCING (within a single transaction):
--      Because inserting lines into a posted/reversed entry is now blocked,
--      the P6 PostingEngine MUST follow this exact order inside ONE transaction:
--        1. INSERT journal_entry with status = 'draft'
--        2. INSERT all journal_lines (entry is still draft -> INSERT allowed)
--        3. UPDATE journal_entry status: 'draft' -> 'posted'
--      The deferred balance constraint (jl_balance_check / je_balance_check)
--      validates at COMMIT regardless of step ordering, so this sequence is
--      safe. Attempting to INSERT lines after the UPDATE to 'posted' will
--      raise "entry is posted and cannot be modified".
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS je_immutable ON journal_entries;
DROP TRIGGER IF EXISTS jl_immutable ON journal_lines;
DROP FUNCTION IF EXISTS block_posted_mutation();

CREATE FUNCTION block_posted_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status journal_status;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status IN ('posted', 'reversed') THEN
        RAISE EXCEPTION 'journal entry % is % and cannot be deleted', OLD.id, OLD.status;
      END IF;
      RETURN OLD;
    END IF;

    -- UPDATE
    IF OLD.status IN ('posted', 'reversed') THEN
      -- Permit ONLY posted -> reversed with no other column changed.
      IF OLD.status = 'posted' AND NEW.status = 'reversed'
         AND NEW.id              IS NOT DISTINCT FROM OLD.id
         AND NEW.company_id      IS NOT DISTINCT FROM OLD.company_id
         AND NEW.period_id       IS NOT DISTINCT FROM OLD.period_id
         AND NEW.fiscal_year     IS NOT DISTINCT FROM OLD.fiscal_year
         AND NEW.entry_no        IS NOT DISTINCT FROM OLD.entry_no
         AND NEW.entry_date      IS NOT DISTINCT FROM OLD.entry_date
         AND NEW.description     IS NOT DISTINCT FROM OLD.description
         AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
         AND NEW.created_by      IS NOT DISTINCT FROM OLD.created_by
         AND NEW.posted_at       IS NOT DISTINCT FROM OLD.posted_at
         AND NEW.created_at      IS NOT DISTINCT FROM OLD.created_at THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'journal entry % is % and is immutable (only posted->reversed status flip allowed)', OLD.id, OLD.status;
    END IF;
    RETURN NEW;
  END IF;

  -- journal_lines: look up the owning entry's status.
  SELECT status INTO v_status
    FROM journal_entries
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'journal line of entry % cannot be modified (entry is %)',
      COALESCE(NEW.entry_id, OLD.entry_id), v_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER je_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION block_posted_mutation();

CREATE TRIGGER jl_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION block_posted_mutation();

-- ---------------------------------------------------------------------
-- 4. Performance indexes (idempotent)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS journal_lines_company_account_idx ON journal_lines (company_id, account_id);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS journal_entries_company_fy_idx ON journal_entries (company_id, fiscal_year);

-- =====================================================================
-- Phase 2a Task A2: sales/AR/e-invoice RLS + indexes
-- =====================================================================

-- business_partners: scoped by company_id
ALTER TABLE business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_partners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_partners_access ON business_partners;
CREATE POLICY business_partners_access ON business_partners
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- sales_invoices: scoped by company_id
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_invoices_access ON sales_invoices;
CREATE POLICY sales_invoices_access ON sales_invoices
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- sales_invoice_lines: scoped by company_id (denormalised for RLS parity with journal_lines)
ALTER TABLE sales_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_invoice_lines_access ON sales_invoice_lines;
CREATE POLICY sales_invoice_lines_access ON sales_invoice_lines
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- customer_receipts: scoped by company_id
ALTER TABLE customer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_receipts_access ON customer_receipts;
CREATE POLICY customer_receipts_access ON customer_receipts
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- einvoices: scoped by company_id
ALTER TABLE einvoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE einvoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS einvoices_access ON einvoices;
CREATE POLICY einvoices_access ON einvoices
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- Performance indexes (idempotent)
CREATE INDEX IF NOT EXISTS sales_invoices_company_partner_idx ON sales_invoices (company_id, partner_id);
CREATE INDEX IF NOT EXISTS customer_receipts_company_partner_idx ON customer_receipts (company_id, partner_id);
CREATE INDEX IF NOT EXISTS journal_lines_company_partner_idx ON journal_lines (company_id, partner_id);
CREATE INDEX IF NOT EXISTS einvoices_sales_invoice_idx ON einvoices (sales_invoice_id);

-- =====================================================================
-- Phase 2b Task B2: MM (inventory + purchasing) RLS + indexes
-- =====================================================================

-- materials: scoped by company_id
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS materials_access ON materials;
CREATE POLICY materials_access ON materials
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- inventory_movements: scoped by company_id
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_movements_access ON inventory_movements;
CREATE POLICY inventory_movements_access ON inventory_movements
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- purchase_invoices: scoped by company_id
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_invoices_access ON purchase_invoices;
CREATE POLICY purchase_invoices_access ON purchase_invoices
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- purchase_invoice_lines: scoped by company_id (denormalised for RLS parity)
ALTER TABLE purchase_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_invoice_lines_access ON purchase_invoice_lines;
CREATE POLICY purchase_invoice_lines_access ON purchase_invoice_lines
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- goods_issues: scoped by company_id
ALTER TABLE goods_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_issues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goods_issues_access ON goods_issues;
CREATE POLICY goods_issues_access ON goods_issues
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- goods_issue_lines: scoped by company_id (denormalised for RLS parity)
ALTER TABLE goods_issue_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_issue_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goods_issue_lines_access ON goods_issue_lines;
CREATE POLICY goods_issue_lines_access ON goods_issue_lines
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- vendor_payments: scoped by company_id
ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_payments_access ON vendor_payments;
CREATE POLICY vendor_payments_access ON vendor_payments
  USING (app_is_admin() OR company_id = ANY(app_accessible_companies()))
  WITH CHECK (app_is_admin() OR company_id = ANY(app_accessible_companies()));

-- Performance indexes (idempotent)
CREATE INDEX IF NOT EXISTS purchase_invoices_company_partner_idx ON purchase_invoices (company_id, partner_id);
CREATE INDEX IF NOT EXISTS vendor_payments_company_partner_idx ON vendor_payments (company_id, partner_id);
CREATE INDEX IF NOT EXISTS goods_issue_lines_company_material_idx ON goods_issue_lines (company_id, material_id);
CREATE INDEX IF NOT EXISTS purchase_invoice_lines_company_material_idx ON purchase_invoice_lines (company_id, material_id);
