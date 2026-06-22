# Module Roadmap

Phased delivery plan for ERP Việt. Each phase adds a self-contained vertical slice on
top of the foundation. Phase 0 is the invariant base; later phases must not violate the
contracts established here (RLS, posting-engine rule, money convention, citation rule).

---

## Phase 0 — Foundation (DONE)

Everything listed here is shipped, tested, and green in CI.

- **Monorepo tooling:** pnpm 11 workspaces + Turborepo, TypeScript 5 (ESM/NodeNext),
  ESLint, Prettier, Vitest. Node v24.
- **Domain primitives (`@erp/domain`):** `bigint` minor-unit `Money` type; `add`,
  `subtract`, `negate`, `sumLines`, `applyRate` (explicit rounding); `findEffectiveRule`
  (effective-dated rule lookup, exclusive end date, ISO-date comparison).
- **Full entity hierarchy schema (`@erp/db`):** `owner` (singleton), `users`,
  `sessions`, `company_access`, `companies` (with `owner_id` FK), `ownership_links`
  (optional, `ownership_pct` as basis points with CHECK), `groups` (STATUTORY |
  MANAGEMENT), `group_memberships` (with `weight_bp` CHECK), `group_chart_of_accounts`,
  `coa_mappings`, `chart_of_accounts`, `currencies`, `tax_rules`, `audit_log`.
- **PostgreSQL RLS (company-scoped, fail-closed):** FORCE RLS on company-scoped tables;
  single `erp` role (NOSUPERUSER NOBYPASSRLS); per-request GUCs set inside a Drizzle
  `db.transaction()`; `app_is_admin()` and `app_accessible_companies()` helpers.
- **Migrate runner + idempotent RLS SQL** (`packages/db/src/migrate.ts`, `rls.sql`).
- **Demo seed:** Demo Owner, one Circular 133 SME + one Circular 88 household company,
  one MANAGEMENT portfolio group spanning both, effective-dated tax rules.
- **NestJS 10 API:** `TxMiddleware` → `runInTenantTx` → `AsyncLocalStorage`; session
  auth (Argon2id, http-only cookie); `POST /auth/bootstrap`, `POST /auth/login`,
  `POST /auth/logout`; `GET|POST /companies`; `GET|POST /groups`; `POST /access/users`,
  `POST /access/grants`; `GET /health`. AES-256-GCM field encryption helper.
- **RBAC guards:** `AuthGuard` (401), `AdminGuard` (403).
- **Audit interceptor:** append-only `audit_log` insert, awaited inside request tx
  (`mergeMap`), commits atomically with the request.
- **Pluggable regime registry (`@erp/config-regimes`):** `getRegimeConfig` / `listRegimes`;
  Circular 133/88/132/200 stubs registered (content Phase 1).
- **i18n (`@erp/i18n`):** Vietnamese-first TypeScript `as const` catalogs (vi/en);
  `next-intl` 4 in web; `localeDetection: false`.
- **Next.js 16 web shell:** `[locale]` App Router; login page; companies list; groups
  form; `proxy.ts` (next-intl middleware); `/api/*` rewrite to API_URL.
- **Docker Compose self-host:** custom db image baking `init.sql`; api migrate-on-start;
  web depends on api healthy.
- **CI (GitHub Actions):** install → lint → typecheck → build → migrate → test.
- **Access-isolation e2e test:** proves RLS + guard fail-closed (5 assertions).
- **Compliance docs:** `compliance-map.md`, `docs/open-questions.md`,
  `docs/regulations/README.md`, `docs/glossary.md`, `CLAUDE.md`, `ARCHITECTURE.md`.

---

## Phase 1 — Accounting core vertical slice

Target: first complete accounting flow for a Circular 133 SME — from chart of accounts
to financial statements. This phase delivers the headline `PostingEngine` and makes the
consolidation data model live.

- **Chart of Accounts seeded per regime:** Circular 133 account tree from MoF appendix;
  Circular 88 account tree. Loader in `@erp/config-regimes`.
- **Journal entries + double-entry enforcement:** `journal_batches` + `journal_lines`
  tables; `PostingEngine` — the single write path to the GL; app-layer invariant
  (Σdebits = Σcredits); DB-layer constraint/trigger.
- **General Ledger (GL):** account balances computed from journal lines; query helpers.
- **Trial Balance:** per-company, per-period.
- **Period management:** `accounting_periods` table; open/close/lock lifecycle.
- **Balance Sheet + Income Statement:** for Circular 133 (Thông tư 133/2016/TT-BTC).
- **Group / consolidated trial balance:** MANAGEMENT portfolio view aggregating
  per-company trial balances via `coa_mappings`.
- **Intercompany tagging column** on journal lines: `ic_counterparty_company_id` (FK
  reserved in schema design; wired to posting in this phase).
- **Audit trail** wired to journal posting.
- **Full test coverage:** unit tests for double-entry invariant; integration tests for
  period open/close; e2e tests for the full post → trial balance flow.

---

## Phase 2+ — Operational modules

Modules below are listed in approximate delivery order. Each is a vertical slice that
builds on the Phase 1 GL.

### Sales (SD) — Order-to-Cash
AR sub-ledger, sales orders, delivery notes, invoices. RLS-isolated per company.
Revenue recognition via PostingEngine.

### Purchasing (MM) — Procure-to-Pay + Inventory
AP sub-ledger, purchase orders, goods receipts, vendor invoices. Inventory costing:
weighted-average method (Thông tư 200, Circular 133 and 88 variants). GR/IR clearing.

### Cash and Bank + Reconciliation
Bank accounts per company, payment journals, bank reconciliation (statement import vs
GL). Payments in VND and foreign currency (Phase 2 multi-currency).

### Fixed Assets (Circular 45/2013/TT-BTC)
Asset register, acquisition, depreciation schedules (straight-line / declining-balance
as permitted per Circular 45), disposal, revaluation. Depreciation auto-posting via
PostingEngine.

### E-Invoicing (Decree 123/2020/ND-CP + Circular 78/2021/TT-BTC)
Provider abstraction layer (plugin interface); adapters for Viettel, VNPT, MISA.
Supports authenticated e-invoices and cash-register e-invoices (Circular 78 chap. VI).
Submission, status polling, cancellation/replacement flows. PDF/XML storage.

### Tax Engine
- VAT: output VAT by invoice, input VAT deductibility (non-cash threshold from
  2025-07-01: ≥ VND 5,000,000 — Law 48/2024/QH15), declaration form generation (01/GTGT).
- CIT: provisional quarterly + final annual; effective rates per regime; declaration
  form (03/TNDN).
- PIT (withholding): rates, personal + dependent exemptions, declaration (05/QTT-TNCN).
- Household business: tier-based flat tax (Resolution 198/2025/QH15); declaration per
  forthcoming 2026 MoF circular.
- eTax/iHTKK XML export compatible with GDT portal.

### Payroll + BHXH/BHYT/BHTN
Salary, PIT withholding, social/health/unemployment insurance. Payroll journal via
PostingEngine. Monthly/annual declarations.

### Full VAS Financial Statements
- Cash Flow Statement (indirect method, per VAS 24 / Circular 200).
- Notes to Financial Statements.
- Circular 88 simplified statements for household businesses.

### Consolidation Engine
**Statutory consolidation (VAS 25 / Circular 202/2014/TT-BTC):**
- Eliminate intercompany transactions and balances.
- Non-controlling interests (NCI).
- Goodwill and impairment.
- Equity method for associates.
- Foreign currency translation (VAS 10 / Circular 200 chap. IV).

**Management / portfolio consolidation:**
- Aggregate any set of companies via MANAGEMENT group + `coa_mappings` — no ownership
  required.
- Portfolio-level trial balance, P&L, Balance Sheet in reporting currency.
- Intercompany netting report (optional for portfolio view).

### Multi-Currency
FX revaluation, translation gains/losses, currency translation for consolidation.

### BI Dashboards
Revenue/expense trends, cash position, AR/AP aging, group portfolio summary.

### Document Management
Attach source documents (scanned invoices, contracts) to journal batches. Link to
e-invoice records. Storage: local filesystem or S3-compatible (configurable).

### Point of Sale (POS)
Retail sales flow for household businesses; integrates with e-invoice (cash-register
type) and inventory.
