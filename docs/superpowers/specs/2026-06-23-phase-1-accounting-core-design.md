# Phase 1 — Accounting Core (Vertical Slice) Design

**Date:** 2026-06-23
**Status:** Draft for review
**Builds on:** Phase 0 foundation (merged to `master`). Reuses the tenant-tx/RLS model,
`@erp/domain` money, `@erp/config-regimes`, the audit interceptor, and the entity schema.

## Confirmed decisions
- **Scope:** posting engine + GL + trial balance + period open/close/lock + Balance Sheet
  & Income Statement (Circular 133), with full test coverage, **plus minimal Vietnamese
  read-only UI** to view a trial balance and the two statements (and fix the Phase-0
  regime dropdown).
- **Chart of Accounts:** seed the **full official** Circular 133 and Circular 88 account lists.
- **Currency:** **VND-only** for Phase 1 (functional currency = VND; multi-currency
  translation stays a later phase).

## Non-negotiable principles (carried from Phase 0 / CLAUDE.md)
- Money is `bigint` minor units (`@erp/domain`); double-entry must balance (Σdebit = Σcredit),
  enforced at **both** the app layer (domain invariant) **and** the DB layer (constraint/trigger).
- **One posting engine** is the only path to the GL. No module or UI writes journal/GL rows directly.
- Journals are **append-only**: a posted entry is immutable; corrections are **reversal** entries.
- Every accounting rule cites its source regulation in code + `compliance-map.md`.
- New financial tables are **company-scoped RLS (FORCE)**, proven by tests.

---

## 1. Data model additions (all company-scoped, RLS FORCED)

- **`accounting_periods`** — `id, company_id, fiscal_year, period_no (1–12 or 0 for annual),
  start_date, end_date, status ('open'|'closed'|'locked'), closed_at, closed_by`.
  Unique `(company_id, fiscal_year, period_no)`.
- **`journal_entries`** — `id, company_id, period_id, entry_no, entry_date, description,
  status ('draft'|'posted'|'reversed'), reverses_entry_id (nullable), created_by, posted_at`.
  Append-only once `posted`.
- **`journal_lines`** — `id, entry_id, company_id (denormalized for RLS), account_id,
  debit_minor bigint, credit_minor bigint, ic_counterparty_company_id (nullable, reserved
  for Phase 2 eliminations), line_memo`. Exactly one of debit/credit is non-zero per line.
- `chart_of_accounts` already exists (Phase 0); Phase 1 **populates** it per company from the
  regime template.

**DB integrity:**
- A **deferred constraint trigger** on `journal_entries`/`journal_lines` asserting, at commit,
  that each entry's `Σ debit_minor = Σ credit_minor` (the double-entry guarantee at the DB layer).
- Posted entries immutable: trigger blocks `UPDATE`/`DELETE` on `journal_entries`/`journal_lines`
  where the entry is `posted`/`reversed` (corrections go through reversal). Backs the audit
  "append-only" claim with DB enforcement (also addresses a Phase-0 open-question note).
- Posting into a `closed`/`locked` period is rejected (engine + a period-status check).

## 2. Chart of Accounts seeding (per regime)

- `@erp/config-regimes` gains the **full account lists**:
  - **Circular 133/2016/TT-BTC** — system of accounts (Appendix 1) for SMEs.
  - **Circular 88/2021/TT-BTC** — the household/individual-business bookkeeping accounts.
  - Each `AccountSeed` = `{ code, name (vi), type, parentCode? }`, citing the circular.
- A **CoA provisioning** step creates a company's `chart_of_accounts` rows from its regime
  template (invoked on company creation and exposed as an idempotent admin action / seed helper).

## 3. Posting engine (`@erp/domain` + API service)

- Pure domain in `@erp/domain`: `validateEntry(lines)` → balanced check using `Money`
  (Σdebit = Σcredit, same currency VND, no zero-zero or double-sided lines), returns typed errors.
- `PostingEngine` (API service): `post(input)` runs **inside the request tenant tx**:
  1. resolve target period (must be `open`), 2. validate accounts belong to the company,
  3. validate balance (domain), 4. assign `entry_no`, 5. insert entry + lines, 6. mark `posted`.
  - `reverse(entryId)` creates a mirror-image entry (`reverses_entry_id` set), in an open period.
  - The engine is the **sole** writer of journal/GL rows; future SD/MM/POS modules call it.

## 4. General Ledger, Trial Balance

- **GL**: derived (no separate table) — query journal_lines by account over a date/period range:
  opening balance + movements + running/closing balance. Read service + read-only API.
- **Trial Balance**: per company + period — aggregate `Σdebit`, `Σcredit`, and net balance per
  account; the report must balance (total debits = total credits), asserted in tests.

## 5. Accounting periods

- Open/close/lock operations (admin). `closed` blocks posting but allows reopen; `locked` is
  terminal (no reopen) — for finalized statutory periods. Posting/period checks in the engine.

## 6. Financial statements — Circular 133

- Statement **templates as data** in `@erp/config-regimes` (not hardcoded): a mapping from
  statement line items → account-code ranges / sign rules.
  - **Balance Sheet (Mẫu B01‑DNN)** and **Income Statement (Mẫu B02‑DNN)** per Circular 133.
- A statement engine evaluates a template against a company's account balances for a period →
  a structured statement (line code, label vi, amount bigint). Deterministic; fully tested
  against a known journal dataset.
- (Cash Flow B03‑DNN + Notes B09‑DNN are **deferred** to a later phase.)

## 7. Minimal read-only UI (Vietnamese)

- New screens under the existing Next.js shell (still no business logic in web — all via API):
  - **Trial Balance** view for a selected company + period.
  - **Balance Sheet** and **Income Statement** views (Circular 133).
- **Fix Phase-0 web gap:** the create-company regime dropdown uses the real four regimes
  (`circular_133/88/132/200`) with Vietnamese labels from `@erp/config-regimes`; company/group
  lists show friendly regime labels instead of raw codes.

## 8. Tests (full coverage of financial logic)

- Domain: balanced vs unbalanced entry validation; reversal produces an exactly offsetting entry.
- Engine (DB-backed, RLS role): post a balanced entry; reject unbalanced (DB trigger fires);
  reject posting into closed/locked period; immutability (UPDATE/DELETE on posted entry blocked);
  `entry_no` sequencing.
- GL/TB: aggregation correctness on a fixed dataset; trial balance balances; deterministic bigint.
- Statements: BS and IS produce the expected line amounts for a known dataset (Circular 133 mapping).
- RLS: journal_entries/journal_lines/accounting_periods are company-scoped — an accountant
  granted Company A cannot read/post Company B's journals (extends the Phase-0 isolation e2e).
- Period locking end-to-end.

## 9. Demo data

- Extend the seed: provision the SME's Circular 133 CoA, open a period, and post a handful of
  balanced journal entries so the Trial Balance and BS/IS render real numbers; leave the
  household company minimal. Exercises the multi-company group (TB per company) and the
  read-only UI.

---

## Out of scope for Phase 1 (later phases)
Cash Flow + Notes statements; tax declarations (VAT/CIT/PIT); AR/AP, SD, MM, POS; Fixed Assets;
e-invoicing; multi-currency translation; the consolidation **engine** (statutory + portfolio).
Phase 1 delivers a correct single-company accounting core with viewable statements.

## Compliance sources to cite
- Law on Accounting 88/2015/QH13 — double-entry, immutability, accounting periods.
- Circular 133/2016/TT-BTC — SME chart of accounts (Appendix 1) + financial statements (B01‑DNN, B02‑DNN).
- Circular 88/2021/TT-BTC — household/individual-business accounts & books.

## Open questions for the user
1. **Fiscal year** convention for the demo/periods: calendar year (Jan–Dec) assumed — OK, or
   support a configurable fiscal-year start now?
2. **Entry numbering**: per-company sequential `entry_no` per fiscal year (assumed) — acceptable?
