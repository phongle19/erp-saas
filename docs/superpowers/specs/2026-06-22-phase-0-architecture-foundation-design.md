# Phase 0 — Architecture & Foundation Design

**Date:** 2026-06-22
**Status:** Draft for review
**Scope:** Foundation only. No operational modules, no consolidation engine, no accounting
vertical slice (those are Phase 1+). This document defines the monorepo, multi-tenancy,
auth/RBAC, the **full entity hierarchy data model**, the effective-dated rules + regime
config substrate, audit trail, i18n, migrations/seed, tests, CI, and the compliance docs.

---

## 1. Confirmed decisions

| Decision | Choice | Rationale |
|---|---|---|
| Stack | **TypeScript** end-to-end (NestJS API + Next.js web) | One language, strong typing for the financial domain, largest VN talent pool, fast iteration. |
| Tenant isolation | **Shared schema + PostgreSQL Row-Level Security (RLS)** | Scales to millions of low-ARPU household tenants; cheapest ops; isolation enforced at the DB, not just the app. |
| Database | **PostgreSQL** | RLS, `NUMERIC`, `JSONB` for pluggable regime config, strong transactional integrity. |
| ORM / migrations | **Drizzle** | Typed SQL with explicit control over RLS policies and double-entry DB constraints. |
| Hosting | **Vietnam in-country cloud** (Viettel IDC / VNG / FPT) | Data-localization compliance (Decree 53/2022) for taxpayer financial data. Build cloud-agnostic (containers, env config) to avoid lock-in. |
| Auth | **Self-hosted in API** — session-based, Argon2id, optional TOTP MFA | VN residency rules out US-managed auth providers. |
| Money | **`bigint` minor units**, per-currency `minor_unit_scale` (VND scale 0) | Never floats. VND has no subunit; multi-currency ready without rework. |

---

## 2. Why shared-schema + RLS (multi-tenancy model justification)

The target market includes ~3.8M household/individual businesses — high tenant count,
low revenue per tenant. The isolation model must be cheap per tenant and operationally
sane at that scale.

- **Schema-per-tenant** breaks down: DDL migrations must run across thousands of schemas,
  and the PG catalog bloats. Rejected for the mass market.
- **Database-per-tenant** is operationally heavy; reserved as a future opt-in for large
  Circular 200 enterprise tenants only (not built in Phase 0).
- **Shared schema + RLS** is the default: every tenant-owned row carries `tenant_id`;
  PostgreSQL RLS policies filter every query by the session's current tenant.

**Enforcement mechanism (defense in depth):**

1. **DB layer (authoritative):** Each request opens a transaction and runs
   `SET LOCAL app.current_tenant = '<tenant_id>'`. Every tenant-scoped table has an RLS
   policy `USING (tenant_id = current_setting('app.current_tenant')::uuid)`. The
   application DB role is **not** `BYPASSRLS`. A buggy or malicious query physically
   cannot return another tenant's rows.
2. **App layer (guard):** A NestJS request-scoped `TenantContext` resolved from the
   authenticated session; a Drizzle middleware asserts `tenant_id` is set before any
   query runs and stamps it on inserts.
3. **Proof:** A dedicated `tenant-isolation` test suite seeds two tenants and asserts
   every cross-tenant read returns **zero** rows, and that a missing `app.current_tenant`
   causes queries to fail closed (return nothing / error), never to leak.

`tenant = Owner account`. Companies, Groups, journals, and all financial rows belong to
exactly one tenant.

---

## 3. Entity hierarchy data model (built in full now)

The consolidation **engine** is later, but the **data model** must support both
consolidation types from day one. No bolting on later.

```
Owner (= Tenant)
  └─ Company (statutory books unit: regime, functional currency, MST, local CoA)
       ├─ ChartOfAccount (per-company, seeded per regime)
       └─ (financial data: journals, etc. — Phase 1)

OwnershipLink   (Company → Company, OPTIONAL)
  parent_company_id, child_company_id, ownership_pct, control_type
  (subsidiary | associate | joint_venture), acquisition_date, goodwill_amount

Group / ConsolidationSet  (first-class)
  type: STATUTORY | MANAGEMENT
  reporting_currency
  GroupMembership (Group ↔ Company, with role/weight)

GroupChartOfAccount      (group-level accounts)
CoaMapping               (per-company local account → group account)
```

### Core tables (Phase 0)

- **`owners`** — the tenant/subscriber. `id`, billing/plan fields (minimal in Phase 0).
- **`users`** — belong to an owner; auth credentials live here (hash, MFA secret encrypted).
- **`companies`** — `tenant_id`, `name`, `mst` (tax code), `accounting_regime`
  (`circular_133 | circular_88 | circular_132 | circular_200`), `functional_currency`,
  `household_tier` (nullable: `lt_200m | 200m_1b | gt_1b | gt_3b`), status, timestamps.
- **`ownership_links`** — optional inter-company ownership (fields above). Nullable by
  design: portfolio owners have none.
- **`groups`** — `tenant_id`, `name`, `type (STATUTORY|MANAGEMENT)`, `reporting_currency`.
- **`group_memberships`** — `group_id`, `company_id` (+ optional weight/role).
- **`group_chart_of_accounts`** — group-level CoA (`tenant_id`, `group_id`, code, name, type).
- **`coa_mappings`** — `company_account_id → group_account_id`, the bridge that lets a
  Circular 133 SME and a Circular 88 household aggregate into one consolidated trial balance.
- **`currencies`** — `code`, `minor_unit_scale`, name. Seeded with VND (scale 0) + a few majors.
- **`chart_of_accounts`** — per-company accounts (codes/names depend on regime; seeded in Phase 1).

> Note: Circular 133 (SME) and Circular 88 (household) entities are generally **not**
> required to file statutory consolidated FS. For those segments the STATUTORY group mode
> is dormant and the MANAGEMENT/portfolio view is the product. The model supports both;
> the portfolio view must work for any owner regardless of regime or ownership links.

### Intercompany tagging
Every transaction line model (Phase 1+) will carry an optional `ic_counterparty_company_id`
so statutory eliminations auto-generate and portfolio IC reports are available. The column
and FK are reserved in the schema design now even though posting is Phase 1.

---

## 4. Effective-dated rules + pluggable regime config

These **change over time** and must never be inlined in code.

- **`tax_rules`** (effective-dated, versioned): `rule_type`
  (`vat_rate | input_vat_noncash_threshold | pit_deduction | household_tier_threshold | ...`),
  `value` (bigint or NUMERIC as appropriate), `effective_from`, `effective_to` (nullable),
  `source_regulation` (citation string), `notes`. Lookups are always
  "the row whose `[effective_from, effective_to)` contains the transaction date."
  - Seeded examples: VAT 10/8/5/0/exempt; **8% reduced rate effective through 2026-12-31**
    (Resolution 204/2025/QH15); non-cash payment threshold **≥ VND 5,000,000** from
    2025-07-01 (previously 20M); household tiers 200M / 1B / 3B VND.
- **Regime config** is data/config keyed by `accounting_regime`, not `if/switch` branches:
  - `packages/config-regimes/` holds, per regime: chart-of-accounts seed, financial-statement
    templates, declaration-form definitions. Phase 0 establishes the **structure + loader**;
    Phase 1 fills Circular 133 and 88 content.

Every rule row and every code path that applies a rule **cites its source regulation** in a
code comment and in `compliance-map.md`. Ambiguities go to `docs/open-questions.md` and are
raised with the user — never guessed.

---

## 5. Audit trail & financial integrity (foundations)

- **`audit_log`** — append-only: `tenant_id`, `actor_user_id`, `action`, `entity_type`,
  `entity_id`, `before`/`after` (JSONB), `at`. Written for every financial mutation.
  Phase 0 builds the table + a NestJS interceptor; Phase 1 wires it to journal posting.
- **Append-only / reversal-based** principle established now: financial records are never
  silently edited; corrections are reversals. (Journal tables themselves are Phase 1.)
- **Double-entry** will be enforced at **both** layers (Phase 1 posting engine): app-layer
  domain invariant (Σdebits = Σcredits) + DB-layer constraint/trigger on balanced batches.
  Phase 0 documents the contract; the **single `PostingEngine`** is the only path to the GL —
  no module or UI writes the GL directly.

---

## 6. Auth, RBAC, security

- **Auth:** session-based, Argon2id password hashing, optional TOTP MFA, secure
  http-only cookies. Self-hosted in the API.
- **RBAC:** `roles` + `permissions` + `user_roles`, scoped at two levels — **tenant-wide**
  (Owner admin) and **per-company** (e.g. accountant for Company A only). Permission checks
  via a NestJS guard.
- **Security baseline:** secrets via env/KMS; AES-256-GCM field encryption for sensitive
  columns (bank account, national ID, MFA secret); input validation everywhere (Zod);
  rate limiting (Nest throttler); OWASP basics (CSRF, secure headers, parameterized queries
  via Drizzle).

---

## 7. i18n

- Vietnamese-first, English secondary. `next-intl` on the web; message catalogs in
  `packages/i18n` (`vi`, `en`). VN date/number formats and tax terminology.
- `/docs/glossary.md` (VI↔EN accounting glossary) created and referenced by the catalogs.

---

## 8. Monorepo layout

```
erp-saas/
├─ apps/
│  ├─ api/                 # NestJS backend
│  └─ web/                 # Next.js frontend (no business logic)
├─ packages/
│  ├─ domain/              # pure domain types + money (bigint) + invariants, no I/O
│  ├─ db/                  # Drizzle schema, migrations, RLS policies, seed
│  ├─ config-regimes/      # per-regime CoA/statement/declaration config + loader
│  └─ i18n/                # vi/en message catalogs
├─ docs/
│  ├─ regulations/         # regulatory library (citations index)
│  ├─ glossary.md
│  ├─ open-questions.md
│  └─ superpowers/specs/   # design docs
├─ CLAUDE.md
├─ ARCHITECTURE.md
├─ MODULE_ROADMAP.md
├─ compliance-map.md
├─ pnpm-workspace.yaml
└─ turbo.json
```

Tooling: pnpm workspaces + Turborepo.

---

## 9. Migrations, seed, testing, CI

- **Migrations:** Drizzle migrations for every schema change; RLS policies created in
  migrations. Run against ephemeral PG in CI.
- **Seed:** a **demo tenant** with a small **multi-company group** (e.g. one Circular 133
  SME + one Circular 88 household under one Owner, plus a MANAGEMENT group spanning both)
  so the entity model + portfolio path are exercised from Phase 0. (Journals/financials
  added in Phase 1.)
- **Tests:**
  - `tenant-isolation` suite (cross-tenant leakage = zero rows; fail-closed on missing context).
  - Unit tests for money helpers and effective-dated rule lookup (deterministic).
  - e2e smoke: onboarding → create company → pick regime → create group.
- **CI (GitHub Actions):** install → lint → typecheck → migrate ephemeral PG → unit + isolation + e2e.

---

## 10. Compliance documentation produced in Phase 0

- **`CLAUDE.md`** — repo conventions for future work (money rules, posting-engine rule,
  citation requirement, RLS contract).
- **`ARCHITECTURE.md`** — this design, distilled + diagrams.
- **`MODULE_ROADMAP.md`** — phased module plan (AR/AP, SD, MM, Cash/Bank, Fixed Assets,
  E-invoicing, Tax engine, Payroll, full VAS statements, Consolidation engine, XML export,
  BI, POS, multi-currency, DMS).
- **`compliance-map.md`** — table mapping each rule/feature → source regulation.
- **`docs/regulations/`** — index of the regulatory library from the prompt appendix
  (laws/decrees/circulars), with the items flagged **VERIFY** (new CIT law, PIT Dec-2025
  amendments) recorded.
- **`docs/open-questions.md`** — ambiguities to resolve with the user (seeded with the
  VERIFY items and the 2026 household declaration circular still forthcoming).

---

## 11. Explicitly out of scope for Phase 0 (later phases)

Journal entries, GL, trial balance, period open/close, financial statements (Phase 1);
posting engine implementation (Phase 1); operational modules SD/MM/POS, Cash/Bank, Fixed
Assets, E-invoicing, Tax engine, Payroll, Consolidation engine, XML export, BI, multi-currency
translation (Phase 2+). Phase 0 only establishes the substrate these depend on.

---

## 12. Open questions for the user

1. **E-invoice provider** to target first behind the provider interface (Viettel / VNPT /
   MISA)? Affects the invoice domain field mapping later — not blocking Phase 0.
2. **Demo-tenant composition** — is "1 SME (C133) + 1 household (C88) + 1 MANAGEMENT group"
   the right minimal exercise, or do you want a statutory ownership link demoed too?
3. **Plan/billing model** for Owners — needed eventually; Phase 0 keeps `owners` minimal. OK?
