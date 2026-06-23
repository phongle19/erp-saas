# Phase 1 — Accounting Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A correct single-company accounting vertical slice on the Phase 0 foundation: full Circular 133 + 88 charts of accounts, configurable fiscal year with 12 regular + special adjustment periods, double-entry journal entries through one posting engine (append-only, DB-enforced balance + immutability), General Ledger, Trial Balance, period open/close/lock, and Balance Sheet (B01-DNN) + Income Statement (B02-DNN) for Circular 133 — with minimal Vietnamese read-only UI and full tests.

**Architecture:** Pure accounting invariants in `@erp/domain` (bigint Money). Regime data (CoA + statement templates) in `@erp/config-regimes`. New company-scoped tables (RLS FORCED) in `@erp/db` with DB triggers guaranteeing per-entry balance and posted-entry immutability. A single `PostingEngine` in the NestJS API is the only writer of journal rows; GL/TB/statements are read-only derivations. Web stays logic-free (calls `/api`). VND-only.

**Tech stack:** unchanged from Phase 0 (TS monorepo, NestJS 10 ESM, Next 16, PostgreSQL 16 + Drizzle, Vitest, Docker, GitHub Actions).

**Spec:** `docs/superpowers/specs/2026-06-23-phase-1-accounting-core-design.md`

**Standing rules (CLAUDE.md):** money is `bigint` minor units; one posting engine writes the GL; journals append-only (corrections = reversals); cite regulations in code + `compliance-map.md`; request-path queries use `currentTx().db`; new financial tables are company-scoped RLS (FORCE); tests run as a NOBYPASSRLS role; no business logic in web; ESM `.js` import extensions; `.test.ts` excluded from package builds.

**Test DB note (every DB-backed task):** start a throwaway PG and a NOBYPASSRLS owner role:
`docker run -d --name erp-p1-<task> -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p <port>:5432 postgres:16`; `psql -U postgres -c "CREATE ROLE erp LOGIN PASSWORD 'erp' NOSUPERUSER NOCREATEDB NOBYPASSRLS;" -c "CREATE DATABASE erp OWNER erp;"`; `DATABASE_URL=postgres://erp:erp@localhost:<port>/erp`; run `pnpm --filter @erp/db migrate`; clean up the container after.

---

## Task 1: `@erp/domain` — journal entry invariants + reversal (TDD)

**Files:** Create `packages/domain/src/journal.ts`, `packages/domain/src/journal.test.ts`; add `export * from './journal.js'` to `packages/domain/src/index.ts`.

Model (pure, no I/O):
```ts
import { type Money, money, sumLines } from './money.js';
export interface JournalLineInput { accountCode: string; debit: Money; credit: Money; memo?: string; }
export interface BalanceError { code: 'EMPTY' | 'CURRENCY_MISMATCH' | 'LINE_BOTH_SIDES' | 'LINE_NEITHER_SIDE' | 'UNBALANCED'; detail?: string; }
```
Functions (TDD — write tests first, see them fail, implement):
- `validateBalanced(lines: JournalLineInput[], currency: string): BalanceError | null` — returns null if valid, else the first error. Rules: non-empty; every line same `currency`; each line has exactly one of debit>0 / credit>0 (not both, not neither — `LINE_BOTH_SIDES`/`LINE_NEITHER_SIDE`); `Σdebit === Σcredit` (`UNBALANCED`). Use `Money`/`sumLines`; integer-only.
- `buildReversal(lines: JournalLineInput[]): JournalLineInput[]` — swaps debit/credit on each line (an exact offsetting set). Property: `validateBalanced(buildReversal(L)) === null` whenever `validateBalanced(L) === null`, and concatenating L+reversal nets to zero per account.

Tests must cover: balanced 2-line entry passes; unbalanced fails UNBALANCED; a line with both sides set fails; a line with neither fails; mixed currency fails; empty fails; reversal of a valid entry is valid and offsets exactly (sum of each account's debit-minus-credit across L+reversal is 0).

- [ ] Step 1: write `journal.test.ts` with the cases above. Step 2: `pnpm --filter @erp/domain test journal` → FAIL. Step 3: implement `journal.ts`. Step 4: add barrel export. Step 5: test → PASS; `build` + `typecheck` clean. Step 6: commit `feat(domain): journal entry balance validation + reversal`.

---

## Task 2: `@erp/config-regimes` — full CoA (TT133, TT88) + statement templates (TDD)

**Files:** Create `packages/config-regimes/src/coa/circular-133.ts`, `coa/circular-88.ts`; `statements/circular-133.ts`; extend `registry.ts` + `types.ts`; `packages/config-regimes/src/coa.test.ts`, `statements.test.ts`.

CoA data — the **full official** account systems:
- `circular-133.ts`: the Circular 133/2016/TT-BTC system of accounts (Appendix 1) — every account & sub-account as `AccountSeed { code, name (vi), type, parentCode? }`. Classes 1–9 (and class 0 off-balance where applicable). Cite `// Circular 133/2016/TT-BTC, Phụ lục 1`.
- `circular-88.ts`: the Circular 88/2021/TT-BTC household/individual-business accounts. Cite the circular.
- **Compliance caveat:** `/docs/regulations/` does not yet contain the full circular text. Produce the lists to best fidelity from the regulation, and add an entry to `docs/open-questions.md`: "Verify the seeded Circular 133/88 chart-of-accounts (codes, Vietnamese names, completeness) against the official circular text before production." Cite the source in code + compliance-map.

Statement templates (data, not hardcoded logic):
```ts
export interface StatementLine { code: string; label_vi: string; level: number; // indentation
  // how to compute the amount: sum of balances of accounts whose code matches these prefixes,
  // with a sign convention. Leaf lines reference accounts; subtotal lines reference child line codes.
  accounts?: { prefixes: string[]; nature: 'debit' | 'credit' }; // leaf: net balance in its natural side
  subtotalOf?: string[]; // subtotal: sum of these StatementLine codes
}
export interface StatementTemplate { id: 'B01-DNN' | 'B02-DNN'; title_vi: string; lines: StatementLine[]; }
```
- `statements/circular-133.ts`: **Balance Sheet (Mẫu số B01-DNN)** and **Income Statement (Mẫu số B02-DNN)** templates for Circular 133, mapping the standard line items (TÀI SẢN / NGUỒN VỐN for BS; doanh thu/giá vốn/lợi nhuận for IS) to account-code prefixes + sign. Cite the circular's statement forms.
- Registry: `getChartOfAccounts(regime): AccountSeed[]`, `getStatementTemplates(regime): StatementTemplate[]` (empty for regimes not yet filled — 132/200). Keep `getRegimeConfig`/`listRegimes`.

- [ ] Step 1: tests — `coa.test.ts`: `getChartOfAccounts('circular_133').length > 0`, codes unique, every `parentCode` (if set) exists, every account `type` valid; same shape checks for `circular_88`. `statements.test.ts`: BS and IS templates exist for circular_133, line codes unique, every `subtotalOf` child code exists, leaf lines have `accounts`. Step 2: run → FAIL. Step 3: implement data + loaders. Step 4: tests PASS; build/typecheck clean. Step 5: append the verification note to `docs/open-questions.md`. Step 6: commit `feat(config-regimes): full Circular 133/88 CoA + B01/B02-DNN statement templates`.

---

## Task 3: `@erp/db` — accounting schema (periods, journals) + migration

**Files:** add `fiscalYearStartMonth` to `src/schema/companies.ts`; create `src/schema/periods.ts`, `src/schema/journals.ts`; add enums to `src/schema/enums.ts`; export from `src/schema/index.ts`; regenerate migration.

- `companies`: add `fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1)`.
- enums: `periodType ('regular'|'special')`, `periodStatus ('open'|'closed'|'locked')`, `journalStatus ('draft'|'posted'|'reversed')`.
- `accounting_periods` (company-scoped): `id, companyId FK companies cascade, fiscalYear int, periodNo int, periodType, purpose text null, nameVi text, startDate date null, endDate date null, status periodStatus default 'open', closedAt ts null, closedBy uuid null`; UNIQUE `(companyId, fiscalYear, periodNo)`; CHECK `periodNo >= 1`.
- `journal_entries` (company-scoped): `id, companyId FK cascade, periodId FK accounting_periods, fiscalYear int, entryNo int, entryDate date, description text, status journalStatus default 'draft', reversesEntryId uuid null (self-FK), createdBy uuid null, postedAt ts null, createdAt ts`; UNIQUE `(companyId, fiscalYear, entryNo)`.
- `journal_lines` (company-scoped): `id, entryId FK journal_entries cascade, companyId FK companies (denormalized for RLS), accountId FK chart_of_accounts, debitMinor bigint mode bigint notNull default 0, creditMinor bigint mode bigint notNull default 0, icCounterpartyCompanyId uuid null (reserved), lineMemo text null`; CHECK `(debit_minor >= 0 AND credit_minor >= 0)` and `NOT (debit_minor > 0 AND credit_minor > 0)`.

- [ ] Step 1: edit/create schema files (`.js` extensions, follow Phase-0 style; bigint via `bigint(..., { mode: 'bigint' })`). Step 2: export in `schema/index.ts`. Step 3: `pnpm --filter @erp/db generate` → new migration includes the 3 tables + enums + the companies column. Step 4: `build` + `typecheck` clean; runtime barrel smoke (`node -e import dist/index.js`, schema keys grew). Step 5: commit `feat(db): accounting periods + journal entries/lines schema`.

---

## Task 4: `@erp/db` — RLS + double-entry & immutability triggers (live-proven)

**Files:** extend `src/rls.sql` (append the new tables' policies + triggers). `migrate.ts` already applies `rls.sql` (re-runnable via DROP IF EXISTS).

Append to `rls.sql` (keep the existing `DROP POLICY IF EXISTS` re-runnable style; also `DROP TRIGGER IF EXISTS` / `DROP FUNCTION IF EXISTS` before create):
1. **Company-scoped RLS (ENABLE + FORCE)** on `accounting_periods`, `journal_entries`, `journal_lines`, with USING + WITH CHECK `app_is_admin() OR company_id = ANY(app_accessible_companies())` (mirror the Phase-0 companies policy).
2. **Double-entry balance** — a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `journal_lines` (and on `journal_entries` for the no-lines case) that, at commit, for each affected `entry_id`, asserts `SUM(debit_minor) = SUM(credit_minor)` and the entry has ≥1 line; raise exception otherwise. (Deferred so multi-line inserts within one tx are checked once at commit.)
3. **Immutability of posted entries** — a `BEFORE UPDATE OR DELETE` trigger on `journal_entries` and `journal_lines` that raises if the (owning) entry's `status` is `posted` or `reversed`. (Corrections must be reversals; backs the append-only/audit claim at the DB layer.)

- [ ] Step 1: write the SQL (functions + triggers + policies). Step 2: migrate against a throwaway PG as the `erp` role. Step 3: **live proof (paste output)** as the NOBYPASSRLS erp role, each scenario in its own tx with `set_config('app.is_admin','true',true)` to insert: (a) a balanced entry+lines commits; (b) an **unbalanced** entry's lines raise at COMMIT (deferred trigger); (c) updating/deleting a **posted** entry/line raises; (d) RLS: with a non-admin GUC scoped to company A, `SELECT`/`INSERT` on company B's journal rows returns nothing / is rejected; empty context → 0 rows. Step 4: re-run migrate twice (idempotent). Step 5: commit `feat(db): company-scoped RLS + deferred double-entry + immutability triggers for journals`.

---

## Task 5: API — fiscal-year/period generation + CoA provisioning + endpoints

**Files:** `apps/api/src/accounting/periods.service.ts` + controller; `apps/api/src/accounting/coa.service.ts` + controller; `accounting.module.ts`; wire into `app.module.ts`. Tests `apps/api/test/periods.int.test.ts`.

- `coa.service.provision(companyId)`: reads the company's regime, loads `getChartOfAccounts(regime)` from `@erp/config-regimes`, inserts `chart_of_accounts` rows (idempotent — skip if already provisioned), via `currentTx().db` (RLS: admin context). Endpoint `POST /companies/:id/chart-of-accounts:provision` (AdminGuard). `GET /companies/:id/accounts` (AuthGuard) lists CoA.
- `periods.service.generateFiscalYear(companyId, fiscalYear, { specialPeriods?: Array<{periodNo, purpose, nameVi}> })`: computes the 12 regular periods from `fiscal_year_start_month` (correct month/date math, year rollover) + creates requested special periods (13/14/15…); idempotent on `(company, fy, periodNo)`. Endpoints: `POST /companies/:id/fiscal-years` (AdminGuard, body fiscalYear + optional special list), `GET /companies/:id/periods?fiscalYear=` (AuthGuard), `POST /periods/:id:close|:reopen|:lock` (AdminGuard).
- Period status guard helper `assertOpen(periodId)` for the engine (Task 6).

- [ ] TDD-ish: Step 1 test (DB-backed, erp role): provision CoA for the C133 SME → accounts present and `GET` returns them; generate FY2026 with `fiscal_year_start_month=4` → period 1 = April 2026 … period 12 = March 2027 (assert dates), plus special periods 13/14/15 created with purposes; close→reopen→lock transitions; re-running generate/provision is idempotent. Step 2 → FAIL. Step 3 implement. Step 4 PASS; build/typecheck. Step 5 commit `feat(api): CoA provisioning + configurable fiscal-year/period generation`.

---

## Task 6: API — PostingEngine (post/reverse) + journal endpoints + tests

**Files:** `apps/api/src/accounting/posting-engine.service.ts`; `journals.controller.ts`; tests `apps/api/test/posting.int.test.ts`.

`PostingEngine` (runs inside the request tenant tx via `currentTx().db`), the **sole** journal writer:
- `post({ companyId, periodId, entryDate, description, lines })`: 1) `assertOpen(periodId)` (else 422); 2) resolve `lines[].accountCode` → `accountId` for the company (else 422 unknown account); 3) `validateBalanced(lines, 'VND')` from `@erp/domain` (else 422 with the BalanceError); 4) compute `fiscalYear` from the period; 5) assign next `entry_no` for `(company, fiscalYear)` (e.g. `MAX(entry_no)+1` within the tx); 6) insert `journal_entries` (status `posted`, postedAt now) + `journal_lines`; 7) return the entry. The deferred DB trigger is the backstop for balance.
- `reverse(entryId)`: load the posted entry+lines (RLS-scoped), require an open target period, create a new entry with `buildReversal` lines and `reverses_entry_id` set, mark the original `reversed`.
Endpoints: `POST /journal-entries` (AuthGuard — any user with access to the company; the RLS WITH CHECK + account-company check enforce scope), `POST /journal-entries/:id:reverse` (AuthGuard), `GET /journal-entries/:id` (AuthGuard).

- [ ] Tests (DB-backed, erp role): post a balanced entry → 201, entry_no=1; post another → entry_no=2; unbalanced → 422 (and nothing persisted — proves tx rollback on the 4xx via the Phase-0 middleware); posting into a `closed` period → 422; posting into a **special** period (13) → ok; `reverse` creates an offsetting entry and marks original reversed; attempting to post referencing another company's account → rejected; entry_no resets in a new fiscal year. Step order: write tests → FAIL → implement → PASS → build/typecheck → commit `feat(api): posting engine (post/reverse) with period + balance + account-scope guards`.

---

## Task 7: API — General Ledger + Trial Balance (read) + tests

**Files:** `apps/api/src/accounting/ledger.service.ts`; `reports.controller.ts`; tests `apps/api/test/ledger.int.test.ts`.

- `trialBalance(companyId, fiscalYear, throughPeriodNo)`: aggregate posted `journal_lines` for the company across periods with `periodNo <= throughPeriodNo` in that fiscal year → per account `{ code, name, debit, credit, balance }` (bigint), plus totals; assert in tests that total debit = total credit. "throughPeriodNo" enables pre-adjustment (≤12) vs post-adjustment (≤15) cumulative views.
- `generalLedger(companyId, accountCode, fiscalYear, throughPeriodNo)`: opening balance + ordered movements + running balance for one account.
Endpoints: `GET /companies/:id/trial-balance?fiscalYear=&through=` (AuthGuard), `GET /companies/:id/ledger?account=&fiscalYear=&through=` (AuthGuard). Read-only — no writes.

- [ ] Tests: on a fixed posted dataset, trial balance balances (Σdebit=Σcredit) and per-account balances match hand-computed values; GL running balance correct; a special-period (13) adjustment changes the `through=15` TB but not `through=12`. TDD order; commit `feat(api): general ledger + trial balance reports`.

---

## Task 8: API — Financial statements (B01-DNN, B02-DNN) + tests

**Files:** `apps/api/src/accounting/statements.service.ts`; add endpoints to `reports.controller.ts`; tests `apps/api/test/statements.int.test.ts`.

- `statement(companyId, fiscalYear, throughPeriodNo, templateId)`: load the regime's `getStatementTemplates`, fetch account balances (reuse the TB aggregation), evaluate each `StatementLine` — leaf lines = net balance of accounts matching `accounts.prefixes` taken in the line's `nature` (debit/credit); subtotal lines = sum of referenced child line codes. Return `{ id, title_vi, lines: [{code,label_vi,level,amount}] }` (bigint amounts). Deterministic.
- Endpoints: `GET /companies/:id/statements/balance-sheet?fiscalYear=&through=` and `.../income-statement?...` (AuthGuard). Only available for regimes with templates (circular_133); others → 404/not-implemented.

- [ ] Tests: post a known set of entries (sales, COGS, expenses, cash, payables) for the C133 SME, then assert specific BS line amounts (e.g. cash, total assets = total resources) and IS line amounts (revenue, gross profit, net result) match hand-computed expected values; BS must balance (assets = liabilities + equity); compare `through=12` vs `through=15` when an adjustment entry is posted in period 13. TDD; commit `feat(api): Circular 133 Balance Sheet + Income Statement engine`.

---

## Task 9: API — extend access isolation to journals (e2e)

**Files:** extend `apps/api/test/access-isolation.e2e.test.ts` (or a new `journals-isolation.e2e.test.ts`) + `helpers/seed-test.ts`.

- Seed: admin provisions CoA + a fiscal year for both SME and household; posts an entry to each; the accountant is granted only the SME.
- Assert: accountant can read SME journals/TB/statements but gets 404/empty for the household's journal entry, TB, and ledger; accountant cannot post to the household company (RLS WITH CHECK / account-scope → rejected); unauth → 401. Proves the new financial tables honor the Phase-0 isolation guarantee.

- [ ] Write tests → run as the erp NOBYPASSRLS role → PASS (twice, repeatable via truncateAll which must now also truncate the new tables — update `helpers/make-app.ts`). Commit `test(api): access-isolation extended to journals/ledger/statements`.

---

## Task 10: Web — read-only Trial Balance / BS / IS views + regime dropdown fix

**Files:** `apps/web/src/app/[locale]/companies/[id]/...` (or `/reports`) pages; extend `lib/api.ts`; add i18n keys to `@erp/i18n` (vi/en) for report labels; fix the create-company regime `<select>`.

- A company **reports** area: select a fiscal year + "through period", view **Trial Balance** (table: account, debit, credit, balance, totals), **Balance Sheet**, **Income Statement** (rendered from the API statement structure, respecting `level` indentation). Server components fetch via the cookie-forwarding pattern (Phase-0 fix); no business logic in web — formatting only.
- VND formatting: display bigint minor units as Vietnamese-formatted đồng (no decimals for VND). Add a small client-side formatter (presentation only).
- **Fix Phase-0 gap:** the create-company regime `<select>` options become the real four regimes (`circular_133/88/132/200`) with Vietnamese labels from `@erp/config-regimes` (or i18n); company/group lists show friendly regime labels instead of raw codes.
- Add i18n keys: `reports.trialBalance`, `reports.balanceSheet`, `reports.incomeStatement`, `reports.fiscalYear`, `reports.throughPeriod`, `reports.debit`, `reports.credit`, `reports.balance`, etc. (vi + en parity).

- [ ] Build green (`pnpm --filter @erp/web build`); lint clean; a Playwright smoke that (with the API + a seeded company running) loads the Trial Balance page and asserts a Vietnamese report heading renders, OR (if wiring a live API in the web test is heavy) at minimum a smoke asserting the reports route renders its heading. Commit `feat(web): read-only trial balance + financial statements views; correct regime selector`.

---

## Task 11: Demo seed + final verification + docs

**Files:** extend `packages/db/src/seed.ts`; update `compliance-map.md`, `MODULE_ROADMAP.md` (Phase 1 → done), `ARCHITECTURE.md` (accounting core section), `docs/open-questions.md` (CoA verification note if not already added).

- Seed: provision the SME's Circular 133 CoA; generate FY2026 (with special periods 13/14/15); post a small set of balanced entries (so TB + BS + IS render real numbers); keep household minimal. Idempotent guard preserved.
- `compliance-map.md`: add rows — Circular 133 CoA (Phụ lục 1), B01-DNN, B02-DNN; Circular 88 CoA; Law on Accounting 88/2015 (double-entry, immutability, periods) → the trigger + engine files.
- Final pipeline (paste): throwaway PG + erp role → `pnpm install && pnpm lint && pnpm typecheck && pnpm build && pnpm --filter @erp/db migrate && pnpm --filter @erp/db seed && pnpm test` all green (incl. the new posting/ledger/statement/isolation tests).
- [ ] Commit `feat: phase 1 demo seed + docs (compliance-map, roadmap, architecture)`.

---

## Definition of Done (Phase 1)
- Full pipeline green (`install/lint/typecheck/build/migrate/seed/test`) with the new accounting tests passing as a NOBYPASSRLS role.
- Double-entry enforced at app (domain) **and** DB (deferred trigger); posted entries immutable at the DB layer; corrections via reversal.
- Configurable fiscal year + 12 regular + special periods (13/14/15+); `entry_no` per `(company, fiscal_year)`.
- Full Circular 133 + 88 CoA seeded (with a verification note vs the official text); single posting engine is the only GL writer.
- GL + Trial Balance (balances) + Circular 133 Balance Sheet & Income Statement, with pre/post-adjustment cumulative views.
- Access isolation extended to journals/reports and proven; minimal Vietnamese read-only UI renders TB/BS/IS; regime selector fixed.
- **STOP after Phase 1 and present for review before Phase 2.**
