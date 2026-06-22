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

## Posting engine principle (forward-looking — Phase 1)

The single `PostingEngine` is the **only** path to the GL. No module, service, or UI
may write journal entries directly. Journals are append-only; corrections are reversals.
Double-entry is enforced at both layers:
- App domain invariant: Σdebits = Σcredits per journal batch.
- DB constraint/trigger: rejects an unbalanced batch atomically.

Phase 0 establishes the audit trail and schema substrate; the engine is implemented in
Phase 1 alongside the accounting vertical slice.

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
