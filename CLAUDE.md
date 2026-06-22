# CLAUDE.md — Repo conventions for contributors and agentic workers

Read this before touching any code. Conventions here are non-negotiable for financial
correctness and auditability.

---

## Money

- **Money is always `bigint` minor units.** Use the `@erp/domain` helpers (`money`,
  `add`, `subtract`, `applyRate`, etc.). Never use `number` or `float` for any monetary
  value — floating-point arithmetic is forbidden for money.
- VND has `minor_unit_scale = 0` (no subunit). Other currencies carry their own scale in
  the `currencies` table.
- When computing VAT or other percentage amounts, use `applyRate(amount, numerator,
  denominator, Rounding.HALF_UP)`. Always specify rounding explicitly; never let JS
  coerce a bigint to a float.

## GL / Posting engine

- **All General Ledger writes go through the single `PostingEngine` (Phase 1).** No
  module, controller, service, or UI component may write to journal tables directly.
- Journals are **append-only**. Financial records are never silently edited. Corrections
  are made by posting a reversing entry first, then the corrected entry.
- Double-entry is enforced at both layers: the app-layer domain invariant
  (Σdebits = Σcredits per batch) and a DB constraint/trigger on journal batches (Phase 1).

## Regulatory citations

- Every tax rule, accounting rule, or compliance decision **must** cite its source
  regulation in a code comment, e.g.:
  ```ts
  // VAT reduced rate 8% through 2026-12-31 — Resolution 204/2025/QH15
  ```
- The same rule must appear in `compliance-map.md` with its implementation file and
  status. Do not add a rule without updating the map.
- Any ambiguity, grey area, or unconfirmed regulatory interpretation goes to
  `docs/open-questions.md`. **Never guess** — flag it and wait for confirmation.

## RLS / Tenant transaction contract

- Every request-path query must run inside the tenant transaction established by
  `TxMiddleware`. Obtain the DB handle with `currentTx().db` from
  `apps/api/src/db/tx-context.ts`. Never open a new DB connection inside a request
  handler.
- The function `runInTenantTx` (in `apps/api/src/db/tenant-tx.ts`) opens a Drizzle
  `db.transaction(...)`, sets the three RLS GUCs (`app.user_id`, `app.is_admin`,
  `app.accessible_companies`) as transaction-local (`set_config(..., true)`), and runs
  the caller's function inside `AsyncLocalStorage`. The transaction commits on HTTP
  status < 400 and rolls back on >= 400 or on any thrown error.
- The application connects as the `erp` role: `NOSUPERUSER NOCREATEDB NOBYPASSRLS`.
  **Never add a `BYPASSRLS` or superuser connection for request handling.** FORCE RLS
  is set on all company-scoped tables.
- Tests that touch company-scoped data must run as the `erp` (NOBYPASSRLS) role. A
  superuser connection would silently skip RLS and make isolation tests meaningless.
- `company_access` and `audit_log` reads at the API layer should be scoped to admin-only
  or the current user — they are not RLS-protected at the DB level and rely on app-layer
  guards.

## No business logic in the web app

- `apps/web` is a thin Vietnamese-first client. It calls `/api/*` for all data and
  operations. No domain logic, no direct DB access, no money arithmetic in the web layer.

## ESM / TypeScript conventions

- The monorepo uses `"module": "NodeNext"` / `"moduleResolution": "NodeNext"`.
  **All intra-package imports must use `.js` extensions** (even when the source file is
  `.ts`), e.g.:
  ```ts
  import { money } from './money.js';
  ```
- `.test.ts` files are **excluded from package builds** (`tsconfig.json` `include` arrays
  cover `src/**` but not test files). Test-only imports therefore do not need to resolve
  at build time.

## Monorepo commands

```bash
pnpm install                            # install all workspace deps
pnpm build                              # turbo: builds all packages in dependency order
pnpm lint                               # turbo: eslint across all packages
pnpm typecheck                          # turbo: tsc --noEmit across all packages
pnpm test                               # turbo: vitest run across all packages
pnpm --filter @erp/db migrate           # run Drizzle migrations + RLS policies
pnpm --filter @erp/db seed              # seed demo owner/companies/group/tax-rules
pnpm --filter @erp/<pkg> build          # build a single package
pnpm --filter @erp/<pkg> test           # test a single package
```

Environment variables required for migrate/test:
```bash
DATABASE_URL=postgres://erp:erp@localhost:5432/erp_test
TEST_DATABASE_URL=postgres://erp:erp@localhost:5432/erp_test
FIELD_ENCRYPTION_KEY=<64 hex chars>   # 256-bit AES key; never commit a real key
```

## Adding a new accounting/tax rule

1. Add a row to `tax_rules` (via a new seed value or migration).
2. Set `source_regulation` to the exact instrument (e.g. `Resolution 204/2025/QH15`).
3. Add a code comment at every call site that applies the rule.
4. Add a row to `compliance-map.md`.
5. If the regulation is unconfirmed or ambiguous, add to `docs/open-questions.md` first.

## Adding a new accounting regime

1. Add the enum value to `packages/db/src/schema/enums.ts` and generate a migration.
2. Add a `RegimeConfig` entry in `packages/config-regimes/src/registry.ts` with the
   correct source circular in the comment.
3. Phase 1: populate `chartOfAccounts`, `statementTemplates`, `declarationForms`.
