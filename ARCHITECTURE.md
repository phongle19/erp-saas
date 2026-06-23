# Architecture — ERP Việt (Phase 0, AS-BUILT)

**Stack:** Node v24, pnpm 11, Turborepo, TypeScript 5 (ESM/NodeNext),
NestJS 10, Next.js 16 (App Router), next-intl 4, Drizzle ORM + postgres.js,
PostgreSQL 16, Argon2id, Vitest, Docker Compose. License: AGPL-3.0.

---

## Monorepo layout

```
erp-saas/
├─ apps/
│  ├─ api/                 # NestJS 10 — REST API, auth, RBAC, tenant tx, audit
│  └─ web/                 # Next.js 16 — Vietnamese-first thin client, no business logic
├─ packages/
│  ├─ domain/              # Pure domain: bigint money helpers + effective-dated rule lookup
│  ├─ db/                  # Drizzle schema, migrations, rls.sql, migrate runner, seed
│  ├─ config-regimes/      # Pluggable accounting-regime registry (Circular 133/88/132/200)
│  └─ i18n/                # vi/en message catalogs (TypeScript modules, not JSON)
├─ docs/
│  ├─ regulations/         # Regulatory library index
│  ├─ glossary.md          # VI↔EN accounting glossary
│  ├─ open-questions.md    # Unresolved regulatory / technical items
│  └─ superpowers/         # Design docs and implementation plans
├─ docker-compose.yml      # One-command self-host (db + api + web)
├─ .env.example
├─ LICENSE                 # AGPL-3.0
├─ CLAUDE.md               # Repo conventions (read first)
├─ ARCHITECTURE.md         # This file
├─ MODULE_ROADMAP.md       # Phased module plan
└─ compliance-map.md       # Regulation → implementation mapping
```

All packages use `"type": "module"` with `module: NodeNext`. Intra-package imports
use `.js` extensions throughout.

---

## Single-tenant model + per-company access isolation

One instance serves exactly **one Owner** (the deploying organisation). Multi-subscriber
isolation is not needed. The isolation that matters is **within** the instance: an
accountant granted Company A must not read or write Company B's data.

### Enforcement (defense in depth)

**Layer 1 — PostgreSQL RLS (authoritative)**

The application connects as the `erp` role: `NOSUPERUSER NOCREATEDB NOBYPASSRLS`.
All company-scoped tables have `FORCE ROW LEVEL SECURITY` so the policy applies even
to the table owner. Policies use two helper functions:

```sql
app_is_admin()              -- reads app.is_admin GUC
app_accessible_companies()  -- reads app.accessible_companies GUC → uuid[]
```

If `app.accessible_companies` is unset or empty, `app_accessible_companies()` returns
an empty array and `id = ANY(ARRAY[]::uuid[])` yields no rows. **Fail-closed by design.**

Company-scoped tables (`companies`, `chart_of_accounts`, `group_memberships`,
`ownership_links`): `USING (app_is_admin() OR <company_fk> = ANY(app_accessible_companies()))`.
`groups` is owner-global: `USING (true)` / `WITH CHECK (app_is_admin())`.

Tables without RLS (readable by any authenticated user via app-layer guards):
`owner`, `users`, `currencies`, `tax_rules`, `sessions`, `company_access`, `audit_log`.

**Layer 2 — Per-request tenant transaction and GUC propagation**

`TxMiddleware` (`apps/api/src/db/tx.middleware.ts`) wraps every request (except `GET /health`) in a single Postgres transaction via `runInTenantTx` (`apps/api/src/db/tenant-tx.ts`):

```
resolveSession(req)
  → { userId, isAdmin, accessibleCompanies }

runInTenantTx(ctx, fn):
  db.transaction(async (tx) => {
    SET LOCAL app.user_id            = '<uuid>';
    SET LOCAL app.is_admin           = 'true'|'false';
    SET LOCAL app.accessible_companies = '<uuid,uuid,...>';
    txStorage.run({ db: tx, ... }, fn);   // AsyncLocalStorage
  })
```

`set_config(..., true)` is the transaction-local form of `SET LOCAL`. Because the entire
request lifecycle runs inside one `db.transaction()` call on a single pinned connection,
every downstream query sees the GUCs. Handlers obtain the handle with `currentTx().db`.

**Commit vs rollback:** the middleware resolves (→ commit) when the response finishes
with status < 400, and rejects (→ rollback) on status >= 400 or socket error.

**Important implementation note (deviation from original plan):**
Drizzle's `db.transaction(async (tx) => ...)` is used rather than wrapping a raw
postgres.js transaction handle with `drizzle(pgTx, { schema })`. The latter throws
because a postgres.js transaction handle lacks `.options.parsers`. The `tx` object
received by the callback is the correct Drizzle transaction type.

**Layer 3 — App-layer RBAC guards**

`AuthGuard` (401 if no `userId`) and `AdminGuard` (403 if not admin) in
`apps/api/src/access/rbac.guard.ts`. Guards run after `TxMiddleware` so `currentTx()`
is already populated. A `CompanyGuard` checking per-company permission will be added
in Phase 1 for resource-level operations.

**Proof:** `apps/api/test/access-isolation.e2e.test.ts` seeds admin + restricted
accountant, then asserts: admin sees both companies; accountant sees only the granted
company; direct GET of the other company returns 404 (RLS-hidden); unauthenticated
request returns 401.

---

## Entity hierarchy

```
Owner  (singleton: 1 row per instance)
  │
  ├─ Company  (statutory accounting unit: regime, functional currency, MST)
  │    ├─ ChartOfAccounts  (per-company, seeded per regime — Phase 1)
  │    └─ (journals, ledger — Phase 1)
  │
  ├─ OwnershipLink  (Company → Company, OPTIONAL)
  │    parent_company_id, child_company_id
  │    ownership_pct  [basis points 0–10000 for 2-decimal precision]
  │    control_type   [subsidiary | associate | joint_venture]
  │    acquisition_date, goodwill_minor [bigint, minor units]
  │
  └─ Group / ConsolidationSet
       type: STATUTORY | MANAGEMENT
       reporting_currency
       │
       ├─ GroupMembership  (Group ↔ Company, weight in basis points)
       ├─ GroupChartOfAccounts  (group-level accounts)
       └─ CoaMapping  (company account → group account)
```

`ownership_pct` is stored as basis points (integer 0–10000) for 2-decimal precision
without floats. A `CHECK` constraint enforces the range.

For SME portfolios (Circular 133 + Circular 88 companies with no legal ownership
relationship), the MANAGEMENT group type is the product's headline feature: one owner,
several unrelated businesses, one combined view. The STATUTORY path supports VAS 25 /
Circular 202 consolidation (Phase 1+ engine).

---

## Accounting core (Phase 1)

### Posting engine

`PostingEngine` (`apps/api/src/accounting/posting-engine.service.ts`) is the **sole
write path to the GL**. No module, service, or UI may insert `journal_entries` or
`journal_lines` directly. All GL mutations go through the engine.

**Draft → posted lifecycle:**

1. Insert `journal_entries` with `status = 'draft'`.
2. Insert all `journal_lines` (DB check: each line has exactly one non-zero side;
   amounts non-negative; companyId matches entry's companyId).
3. `UPDATE journal_entries SET status = 'posted', posted_at = now()`.
   A deferred DB trigger fires at COMMIT and rejects the transaction if Σdebit_minor ≠
   Σcredit_minor for any entry in the batch.

**Append-only / reversal:** posted entries are immutable. A DB trigger blocks any
`UPDATE` or `DELETE` on posted `journal_entries`. Corrections must be reversals: the
engine inserts a mirrored entry (all debits/credits swapped) and marks both entries
`reversed`. This satisfies Luật Kế toán 88/2015/QH13, Art. 19 (chứng từ kế toán
không được tẩy xóa).

### DB-enforced double-entry + immutability

Two deferred triggers live in `packages/db/src/rls.sql`:

- **Balance trigger:** at the end of each transaction, for every `journal_entry` whose
  `id` was modified in that transaction, checks `Σdebit_minor = Σcredit_minor`. Fires as
  a deferred CONSTRAINT TRIGGER so the full batch (all lines) is present before the check
  runs.
- **Immutability trigger:** `BEFORE UPDATE OR DELETE ON journal_entries` — raises an
  exception if `OLD.status = 'posted'` (the PostingEngine's own status-flip is the only
  permitted UPDATE, from `'draft'` to `'posted'`).

### Accounting periods

`accounting_periods` table (`packages/db/src/schema/periods.ts`) with:
- **Regular periods** (periodNo 1–12, periodType='regular'): one per calendar month for
  the fiscal year. `startDate` / `endDate` set to the first and last day of the month.
- **Special periods** (periodNo 13+, periodType='special'): null dates. Three predefined
  purposes — `'closing'` (period 13, year-end adjustment), `'audit'` (period 14,
  post-audit adjustments), `'retrospective'` (period 15, prior-period corrections).

Fiscal year start month is configurable in the period generator; the seed uses
January-start (Jan 2026 = period 1, Dec 2026 = period 12).

### GL / Trial Balance / Statement derivations

All three are **read-only aggregations** over `journal_lines`; no separate balance tables
are maintained (no redundancy, no synchronisation bugs):

Both the General Ledger and Trial Balance live in **`apps/api/src/accounting/ledger.service.ts`**;
financial statements in **`apps/api/src/accounting/statements.service.ts`**. All consume only
entries with `status <> 'draft'` (so a reversed original and its reversal net to zero) and are
**cumulative through a chosen period** (`periodNo <= through`), enabling pre-adjustment (through
period 12) vs post-adjustment (through 13/14/15) views.

- **Trial Balance** (`ledger.service.trialBalance`): aggregates `SUM(debit_minor)/SUM(credit_minor)`
  per account over the company's non-draft lines through the period; `balance = debit − credit`;
  totals must satisfy Σdebit = Σcredit.
- **General Ledger** (`ledger.service.generalLedger`): per-account movements ordered by
  date/entry-no with a running balance (Phase 1 has no prior-year opening carryforward).
- **Financial Statements (B01/B02-DNN):** `StatementsService` evaluates the statement template
  (`packages/config-regimes/src/statements/circular-133.ts`) against the trial-balance account
  balances. Leaf lines have `accounts: { prefixes, nature }` (sum of accounts whose code starts
  with a prefix, taken on the line's `debit`/`credit` nature); subtotal lines have `subtotalOf`
  (child line codes). Credit-nature lines present their natural balance as positive.

### `_neg` sign convention in statement templates

A child reference in a subtotal's `subtotalOf` array may carry a **`_neg` suffix**, meaning
"subtract that child's value" (strip the suffix to find the line, then negate before summing).
This is how contra-assets (accumulated depreciation 214x, provisions), treasury stock (419),
and income-statement deductions/expenses reduce their subtotals.

```ts
// Real shape (circular-133.ts): leaf lines + a subtotal that subtracts a contra child.
{ code: 'A.II.2b', label_vi: 'Hao mòn TSCĐ', level: 3, accounts: { prefixes: ['2141'], nature: 'credit' } }
{ code: 'A.II.2',  label_vi: 'Tài sản cố định (giá trị còn lại)', level: 2,
  subtotalOf: ['A.II.2a', 'A.II.2b_neg'] } // net book value = cost − accumulated depreciation
```

### Known limitation: 131/331 dual-nature accounts

TK 131 (Phải thu khách hàng) and TK 331 (Phải trả người bán) are dual-nature: they
can have either a debit or credit balance depending on business conditions (overpayment,
advance). The current implementation maps them statically to `asset` and `liability`
respectively. A customer advance (credit balance on 131) will appear as a negative asset
on the Balance Sheet rather than being reclassified to liability. This is a known
limitation tracked in `docs/open-questions.md`.

**Phase 2a update:** TK 131 is now decomposable per counterparty via `journal_lines.partner_id`.
`ArService` aggregates per-customer debit/credit independently, so a credit balance on 131
for one customer is visible without being masked by debit balances of others. The aggregate
B01 mapping limitation remains (the statement engine still uses the net 131 balance), but
the AR sub-ledger provides faithful per-customer representation. TK 331 (AP) resolution
follows in Phase 2b (Purchasing / MM).

---

## Sales / AR (Phase 2a)

### Document → GL posting framework

`DocumentPostingService` (`apps/api/src/sales/document-posting.service.ts`) is a thin
wrapper over `PostingEngine` that records the originating document reference (sales
invoice id, receipt id) on the journal entry. All operational modules (sales, purchasing,
cash, fixed assets) must go through this service rather than calling `PostingEngine`
directly, preserving the single-write-path invariant.

### Sales invoice posting

`SalesInvoiceService` (`apps/api/src/sales/sales-invoice.service.ts`) handles the full
invoice lifecycle:

1. Validate period is open; resolve effective-dated VAT rate via `findEffectiveRule`.
2. Compute line net + VAT with `lineNet(qty, unitPrice)` and `vatFor(net, ratePct)` —
   both bigint, HALF_UP, no floats.
3. Insert `sales_invoices` (draft) + `sales_invoice_lines` (with `vatRuleType`,
   `vatRatePct` stored for audit trail per Decree 123/2020/ND-CP).
4. Post GL entry via `DocumentPostingService`: **Dr 131 / Cr 511 / Cr 3331**.
   `partner_id` on the 131 line tags the customer for AR sub-ledger decomposition.
5. Mark invoice `posted`.

VAT sources: Law on VAT 48/2024/QH15 Art. 8.1 (10%); Resolution 204/2025/QH15 (8%
through 2026-12-31). A post-2026 invoice claiming the 8% rate returns HTTP 422.

### AR sub-ledger and the `partner_id` dimension

`journal_lines.partner_id` (FK → `business_partners`) is the key mechanism. Every AR/AP
posting carries the counterparty id on the affected control account line (131 for
receivables, 331 for payables in Phase 2b). `ArService`
(`apps/api/src/sales/ar.service.ts`) aggregates `SUM(debit_minor)` and
`SUM(credit_minor)` from `journal_lines` filtered by `account_code LIKE '131%'` and
grouped by `partner_id`. This gives per-customer outstanding (debit) and overpayment
(credit) without conflating counterparties. The per-customer net is the true receivable
balance used for aging.

This design resolves the Phase-1 dual-nature limitation for TK 131 as documented in
`docs/open-questions.md`.

### Customer receipts

`CustomerReceiptsService` (`apps/api/src/sales/customer-receipts.service.ts`) posts
**Dr 111 (or 112) / Cr 131** with `partnerId`, reducing the customer's AR balance.
The `customer_receipts` table records the settlement account, amount, period, and
journal entry reference for the audit trail.

### E-invoice domain + selectable-provider registry

`EinvoiceService` (`apps/api/src/einvoice/einvoice.service.ts`) dispatches to the
configured provider adapter. The provider is selected per company
(`companies.einvoice_provider`: `viettel` | `vnpt` | `misa`). All three adapters are
currently stubs (no live HTTP to provider APIs). The `einvoices` table enforces two
invariants at the DB level:

- **Serial uniqueness** (`einvoice_serial_uq`): `(company_id, mau_so, ky_hieu, so_hoa_don)`
  unique — satisfies Decree 123/2020/ND-CP requirement that an issued serial is unique
  per taxpayer. NULL `so_hoa_don` values are distinct (multiple pending rows allowed).
- **At-most-one-issued per sales invoice** (`einvoice_one_issued_per_invoice`): partial
  unique index on `(sales_invoice_id)` WHERE `status = 'issued'` — closes the concurrent
  double-issue race at the DB layer.

Regulatory sources: Decree 123/2020/ND-CP; Circular 78/2021/TT-BTC; GDT XML schema
1450/QĐ-TCT; Decree 70/2025/ND-CP (amended).

---

## Materials Management (Phase 2b)

### Weighted-average inventory engine

`packages/domain/src/inventory.ts` provides two pure functions that implement the
perpetual weighted-average (moving-average) method mandated by VAS 02 /
Thông tư 133/2016/TT-BTC, Điều 14:

- **`receiptBalance(prevQty, prevValue, q, cost)`** — adds q units at total cost `cost`.
  Returns `{ qty: prevQty + q, value: prevValue + cost }`. The weighted-average unit cost
  is always derived on-demand (`value / qty`) and never stored as a fraction, keeping
  everything integer-exact and reconcilable to the GL balance of the inventory account.

- **`issueCost(prevQty, prevValue, q)`** — removes q units at the current
  weighted-average cost. Returns `{ costOut, qty, value }`. Uses integer
  multiply-then-divide with HALF_UP rounding (`applyRate`). If q equals prevQty (entire
  stock), the full remaining value is taken, clearing it to exactly 0n — this prevents
  penny-rounding drift accumulating across many sequential issues.

**Monotonic seq column:** `inventory_movements.seq` is a `bigserial`, providing a
strict insertion-order key independent of `created_at` clock skew. Combined with an
advisory lock in `InventoryService.applyReceipt` / `applyIssue`, it prevents
concurrent movements from racing and producing incorrect balances.

### Procure-to-pay posting

`PurchaseInvoiceService` (`apps/api/src/purchasing/purchase-invoice.service.ts`) handles
the full purchase invoice lifecycle:

1. Validate period open; resolve effective-dated input-VAT rate via `findEffectiveRule`.
2. Compute line cost + VAT with bigint helpers (`lineNet`, `vatFor`) — no floats.
3. Insert `purchase_invoices` (draft) + `purchase_invoice_lines` with `vatRuleType`,
   `vatRatePct`, `inventoryAccountCode` stored per line for audit trail.
4. Post GL entry via `DocumentPostingService`:
   **Dr 156 (or 152) / Dr 1331 / Cr 331** with `partner_id` on the 331 line.
5. Create `inventory_movements` (type `'receipt'`) via `InventoryService.applyReceipt`,
   updating the weighted-average balance.
6. Mark invoice `posted`.

Non-cash payment condition: `purchase_invoices.non_cash_payment` flag must be `true`
for input-VAT deductibility on invoices ≥ VND 5,000,000 (Law 48/2024/QH15, effective
2025-07-01; Decree 181/2025).

### Goods issue — COGS at weighted-average

`GoodsIssueService` (`apps/api/src/inventory/goods-issue.service.ts`) calls
`issueCost(prevQty, prevValue, q)` for bigint-exact COGS, then posts:
**Dr 632 / Cr 156 (or 152)** at the computed cost. The `inventory_movements` row
(type `'issue'`) records `totalCostMinor`, `balanceQtyAfter`, `balanceValueAfter` —
the on-hand balance after issue is the authoritative source for inventory reconciliation
to the Trial Balance.

### AP sub-ledger and the `partner_id` dimension

The same `journal_lines.partner_id` mechanism used for AR (TK 131, Phase 2a) applies
to AP (TK 331, Phase 2b). Every AP posting carries the vendor id on the 331 control
account line. `ApService` (`apps/api/src/purchasing/ap.service.ts`) aggregates
`SUM(debit_minor)` and `SUM(credit_minor)` from `journal_lines` filtered by
`account_code LIKE '331%'` and grouped by `partner_id`. Per-vendor outstanding (credit)
and advance positions (debit) are visible without conflating vendors. The per-vendor net
reconciles to the Trial Balance TK 331 aggregate.

This resolves the Phase-1 known limitation for TK 331 (dual-nature accounts):
the AP sub-ledger provides faithful per-vendor representation, identical in design to
the AR sub-ledger that resolved TK 131 in Phase 2a.

**Inventory ↔ GL reconciliation:** `inventory_movements.balanceValueAfter` for the
latest movement of each material reconciles to the GL balance of its inventory account
(TK 152 for raw materials, TK 156 for merchandise). Both are read-only aggregations
over the same set of posted journal entries, so they always agree.

---

## Audit trail

`audit_log` (`packages/db/src/schema/audit.ts`) is an append-only table:
`actor_user_id`, `action`, `entity_type`, `entity_id`, `before`/`after` (JSONB), `at`.

`AuditInterceptor` (`apps/api/src/audit/audit.interceptor.ts`) intercepts `POST`,
`PATCH`, `DELETE` responses via RxJS `mergeMap`, awaiting the `audit_log` INSERT inside
the same request transaction (`currentTx().db`). This guarantees atomic commit: if the
request rolls back, the audit row rolls back with it. Fire-and-forget would allow silent
audit loss on rollback.

The interceptor logs the handler *result* (not the request body), so password fields —
which only appear in request bodies — are never persisted to the audit log.

---

## Effective-dated rules + pluggable regimes

**Tax rules** (`tax_rules` table, `packages/domain/src/rules.ts`):
Each row has `rule_type`, `value` (string, preserving bigint precision), `effective_from`,
`effective_to` (exclusive, null = open-ended), `source_regulation`, `notes`.

`findEffectiveRule(rules, ruleType, onDate)` returns the single row whose
`[effective_from, effective_to)` window contains `onDate`. ISO `YYYY-MM-DD` strings
compare correctly as lexicographic strings.

Example (seeded): `vat_rate_reduced = '8'`, `effective_from = '2025-01-01'`,
`effective_to = '2027-01-01'` (exclusive) → 8% VAT applies through 2026-12-31.
Source: Resolution 204/2025/QH15.

**Regime config** (`packages/config-regimes/`): A `Map<Regime, RegimeConfig>` registry
(no `if/switch` at call sites). Phase 0 registers Circular 133/88/132/200 with empty
`chartOfAccounts`, `statementTemplates`, `declarationForms` arrays (Phase 1 fills them).
Enum values: `circular_133 | circular_88 | circular_132 | circular_200`.

---

## Auth and session model

- **Bootstrap:** `POST /auth/bootstrap` — allowed only when `users` table is empty;
  creates the Owner admin (Argon2id hash). Also inserts the `owner` row if absent.
- **Login:** `POST /auth/login` — Argon2id verify; creates a `sessions` row (stores
  `SHA-256(token)`); sets `sid` http-only secure SameSite=Lax cookie (7-day TTL).
- **Session resolution:** `resolveSession(req)` (pre-tx, separate connection) reads
  `sessions` + `users` + `company_access` to build the `ResolvedSession`. This runs
  before `runInTenantTx` so the GUCs can be set correctly.
- **Field encryption:** AES-256-GCM for sensitive columns (`mfa_secret_enc`, future
  bank account / national ID fields). Key is 64 hex chars in `FIELD_ENCRYPTION_KEY` env
  var; `fieldKey()` validates length at call time.

---

## i18n

Vietnamese-first. `next-intl` 4 in the web app. Message catalogs are **TypeScript
`as const` modules** (not JSON) in `packages/i18n/src/vi.ts` and `en.ts`, giving full
type inference across the web. `localeDetection: false` — always defaults to Vietnamese
regardless of `Accept-Language`.

---

## Docker topology

```
db  (postgres:16 custom image)
│   └─ Dockerfile bakes packages/db/docker/init.sql into
│      /docker-entrypoint-initdb.d (creates erp role NOBYPASSRLS + erp/erp_test DBs)
│   healthcheck: pg_isready
│
api (apps/api/Dockerfile, multi-stage)
│   depends_on: db (healthy)
│   On start: runs Drizzle migrations + RLS, then serves on :3001
│   healthcheck: node fetch('http://localhost:3001/health')
│
web (apps/web/Dockerfile, multi-stage)
    depends_on: api (healthy)
    API_URL=http://api:3001  (container-network name)
    next.config rewrites /api/* → API_URL
    serves on :3000
```

The DB image is **built** (not vanilla postgres:16) so `init.sql` is reliably run even
on hosts where single-file bind mounts misbehave (e.g. Docker Desktop macOS VirtioFS).

The web middleware file is `apps/web/src/proxy.ts` — Next.js 16 renamed `middleware.ts`
to `proxy.ts`. This is correct behaviour for Next 16, not a bug.

---

## CI (GitHub Actions — `.github/workflows/ci.yml`)

```
postgres:16 service → create erp role (NOBYPASSRLS) + erp_test DB
→ pnpm install --frozen-lockfile
→ pnpm lint
→ pnpm typecheck
→ pnpm build
→ pnpm --filter @erp/db migrate
→ pnpm test   (unit + integration + access-isolation e2e)
```

All steps run in one job; no separate Playwright browser e2e in CI (Next build/lint
already covered). Browser e2e step is commented out in the workflow for future use.

---

## AS-BUILT deviations from the original plan

| Topic | Original plan | AS-BUILT |
|---|---|---|
| RLS role model | Two-role idea (separate app role + migrations role) | Single `erp` role, `NOBYPASSRLS`; `FORCE ROW LEVEL SECURITY` on every company-scoped table; superuser only for initial DB setup in `init.sql` |
| Transaction API | `drizzle(pgTx, { schema })` wrapping a postgres.js tx | `db.transaction(async (tx) => ...)` (Drizzle's own API); the raw postgres.js tx handle lacks `.options.parsers` and cannot be rewrapped |
| Audit interceptor | Possibly fire-and-forget | `mergeMap` (not `tap`) — the INSERT is awaited inside the request tx so it commits atomically and rolls back with the request |
| i18n catalogs | JSON message files | TypeScript `as const` modules (`vi.ts`, `en.ts`) — enables full type inference |
| Next.js middleware | `middleware.ts` | `proxy.ts` — Next.js 16 renamed the file; this is correct and intentional |
| Node version | Plan said Node 22 | Runtime is Node v24 (LTS at time of build); all tooling compatible |
| pnpm version | Plan said pnpm 9 | pnpm 11.3.0 (`packageManager` field in root `package.json`) |
| `DbModule` global provider | Planned for DI | Omitted; services call `currentTx().db` directly (simpler, avoids REQUEST-scope propagation) |
