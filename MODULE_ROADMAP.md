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

## Phase 1 — Accounting core vertical slice (DONE)

Everything listed here is shipped, tested, and green in CI.

- **Chart of Accounts per regime:** Circular 133 (TT133/2016/TT-BTC, Phụ lục 1, ~90 accounts) and Circular 88 (TT88/2021/TT-BTC) account trees in `@erp/config-regimes`; `getChartOfAccounts(regime)` loads them. CoA provisioned per company in `packages/db/src/seed.ts`.
- **Accounting periods:** `accounting_periods` table with 12 regular monthly periods (periodType='regular') and 3 special periods (13=closing, 14=audit, 15=retrospective, periodType='special', null dates). FY2026 seeded for the demo SME.
- **Posting engine (`PostingEngine`):** the sole write path to the GL. Enforces draft → lines → posted lifecycle. Draft entries accept line inserts; a DB deferred trigger checks Σdebit = Σcredit per entry at COMMIT; posted entries are immutable (DB trigger blocks UPDATE/DELETE). Reversals create a new mirrored entry and mark both `reversed`. Source: `apps/api/src/accounting/posting-engine.service.ts`.
- **General Ledger (GL):** account balances computed from `journal_lines` (SUM debit_minor, SUM credit_minor grouped by account). Source: `apps/api/src/accounting/gl.service.ts`.
- **Trial Balance:** per-company, per-period, with opening / period / closing balance columns. Source: `apps/api/src/accounting/trial-balance.service.ts`.
- **Balance Sheet (B01-DNN) + Income Statement (B02-DNN):** Circular 133 statement engine maps TT133 account codes to MoF form lines via `_neg` sign-flip convention for contra accounts. Source: `apps/api/src/accounting/statements.service.ts`; templates in `packages/config-regimes/src/statements/circular-133.ts`.
- **Demo seed with real numbers:** FY2026 Period 1 demo journals (E1–E5: capital injection, goods purchase, sales, COGS, admin expense) are posted so the trial balance and B01/B02 render live figures (revenue 1.2 B VND, COGS 700 M, operating profit 350 M). Source: `packages/db/src/seed.ts`.
- **Read-only web UI:** Next.js pages for Trial Balance, Balance Sheet (B01-DNN), and Income Statement (B02-DNN) with regime selector. Source: `apps/web/src/app/[locale]/accounting/`.
- **RLS extended to journals/reports:** `journal_entries`, `journal_lines`, `accounting_periods`, `chart_of_accounts` all protected by FORCE RLS; e2e test proves cross-company isolation. Source: `packages/db/src/rls.sql`, `apps/api/test/access-isolation.e2e.test.ts`.
- **Full test coverage:** domain balance-validation unit tests; CoA/regime unit tests; statements engine unit tests; posting-engine integration tests; access-isolation e2e.
- **Intercompany tagging column** `ic_counterparty_company_id` on `journal_lines` reserved (FK) for Phase 2 elimination engine.

---

## Phase 2a — Sales billing → AR → receipts (DONE)

Everything listed here is shipped, tested, and green in CI.

- **Customer master (`business_partners`):** code, name, MST (tax code), partner type
  (customer/vendor/both), RLS-isolated per company. CRUD at `GET|POST /customers`, `GET|PATCH /customers/:id`.
- **Document → GL posting framework (`DocumentPostingService`):** thin wrapper over `PostingEngine`
  that records the source document reference (sales invoice, receipt) on the journal entry,
  enforcing the single-write-path rule for all operational modules.
- **Sales invoice output VAT:** `SalesInvoiceService` resolves effective-dated VAT rates
  (`findEffectiveRule`) per invoice date, computes line net + VAT with bigint helpers
  (`lineNet`, `vatFor`), enforces Σ-balance, posts Dr 131 / Cr 511 / Cr 3331.
  VAT rule type + resolved percent stored per line for audit trail.
  Sources: Law on VAT 48/2024/QH15, Resolution 204/2025/QH15.
- **AR sub-ledger resolving the TK 131 dual-nature limitation:** `journal_lines.partner_id`
  FK to `business_partners` tags every AR/AP line with its counterparty. `ArService`
  aggregates per-customer debit/credit from journal lines so overdrawn (credit) 131 positions
  are visible per customer even when the aggregate net is a debit. Resolves the Phase-1
  open-question on 131/331 dual-nature accounts for the receivable side.
- **Customer receipts:** `CustomerReceiptsService` posts Dr 111 (or 112) / Cr 131 with
  `partnerId`, linking the receipt to the originating invoice's partner; `customer_receipts`
  table records receipt status and journal entry reference.
- **E-invoice domain + selectable-provider stubs:** `einvoices` table with serial-uniqueness
  and at-most-one-issued-per-sales-invoice constraints. `EinvoiceService` dispatches to the
  configured provider adapter (`companies.einvoice_provider`: viettel/vnpt/misa); all three
  are stubs (no live HTTP). Sources: Decree 123/2020/ND-CP, Circular 78/2021/TT-BTC,
  GDT XML schema 1450/QĐ-TCT, Decree 70/2025/ND-CP.
- **Demo seed:** 2 customers (KH001 An Phát, KH002 Bình Minh); 1 posted sales invoice
  (2 lines: 10M@10% + 5M@8% VAT = total 16,400,000); 1 partial receipt (6,000,000);
  1 issued e-invoice stub. KH001 AR balance = 10,400,000 VND.
- **Read-only web UI:** customers list/detail, sales invoices list/detail with VAT breakdown,
  AR aging table. Source: `apps/web/src/app/[locale]/sales/`.
- **RLS extended to sales/AR/einvoice:** `business_partners`, `sales_invoices`,
  `sales_invoice_lines`, `customer_receipts`, `einvoices` all covered by FORCE RLS; e2e
  access-isolation tests prove cross-company isolation.

---

## Phase 2b — Purchasing (MM) (PLANNED)

AP sub-ledger, purchase orders, goods receipts, vendor invoices. Inventory costing:
weighted-average method (Thông tư 200, Circular 133 and 88 variants). GR/IR clearing.
TK 331 (Phải trả người bán) sub-ledger via `partner_id` on journal lines (same pattern
as 131 in Phase 2a).

## Phase 2c — Cash / Bank (PLANNED)

Bank accounts per company, payment journals, bank reconciliation (statement import vs
GL). Payments in VND and foreign currency (Phase 2 multi-currency).

## Phase 2d — Fixed Assets (PLANNED)

Asset register, acquisition, depreciation schedules (straight-line / declining-balance
as permitted per Circular 45/2013/TT-BTC), disposal, revaluation. Depreciation
auto-posting via PostingEngine.

## Phase 2e — E-invoice live transmission (PLANNED)

Replace provider stubs with live HTTP adapters for Viettel, VNPT, and MISA.
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
