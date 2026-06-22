# Phase 0 — Architecture & Foundation Design

**Date:** 2026-06-22
**Status:** Draft for review (revised — open-source, single-tenant)
**Scope:** Foundation only. No operational modules, no consolidation engine, no accounting
vertical slice (those are Phase 1+). This document defines the monorepo, the single-tenant
self-hosted model, auth + per-company access control, the **full entity hierarchy data
model**, the effective-dated rules + regime config substrate, audit trail, i18n,
migrations/seed, tests, CI, packaging, and the compliance docs.

---

## 0. Product framing

An **open-source, self-hosted** Vietnamese ERP/accounting system. Each customer runs
**their own instance** (`docker-compose`), so the customer controls where their data lives.
A single instance serves **one Owner** (the customer/admin), who may own **several
Companies** — related or not. The headline capability is the **consolidation / portfolio
view**: rolling up multiple companies that may or may not be legally related into one
combined view. Licensed **AGPL-3.0**.

---

## 1. Confirmed decisions

| Decision | Choice | Rationale |
|---|---|---|
| License | **AGPL-3.0** | Strong copyleft keeps hosted modifications open; discourages closed-SaaS forks. |
| Deployment | **Single-tenant, self-hosted** (one instance = one Owner) | Customer owns their data and chooses where it lives. No SaaS multi-tenancy. |
| Stack | **TypeScript** end-to-end (NestJS API + Next.js web) | One language, strong typing for the financial domain, large VN talent pool, fast iteration. |
| Database | **PostgreSQL** | `NUMERIC`, `JSONB` for pluggable regime config, RLS for company-scoped access, strong transactional integrity. |
| ORM / migrations | **Drizzle** | Typed SQL with explicit control over RLS policies and double-entry DB constraints. |
| Access isolation | **PostgreSQL RLS keyed on per-company access** (+ app-layer RBAC guard) | An accountant granted Company A cannot query Company B's books — enforced at the DB, proven by tests. |
| Hosting / data residency | **Deployer's choice** (ship Docker + compose, env config, no telemetry) | Each self-hoster handles their own jurisdiction (e.g. Decree 53/2022 is the deployer's responsibility). |
| Auth | **Self-hosted, session-based**, Argon2id, optional TOTP MFA | Admin + accountant accounts; no SaaS onboarding/billing. |
| Money | **`bigint` minor units**, per-currency `minor_unit_scale` (VND scale 0) | Never floats. VND has no subunit; multi-currency ready without rework. |

---

## 2. Single-tenant model + per-company access control (isolation justification)

One instance serves exactly **one Owner**. Multi-tenant cross-subscriber isolation is **not**
needed. The isolation that *does* matter is **within** the instance: an accountant granted
access to Company A must not be able to read or write Company B's books. So the same rigor
the prompt demands ("enforce in queries AND prove it with tests") applies, just re-keyed
from `tenant_id` to **company access**.

**Enforcement mechanism (defense in depth):**

1. **DB layer (authoritative):** Each request opens a transaction and sets
   `SET LOCAL app.accessible_companies = '<uuid,uuid,...>'` (and `app.user_id`,
   `app.is_admin`). Company-scoped tables have an RLS policy
   `USING (company_id = ANY(string_to_array(current_setting('app.accessible_companies'), ',')::uuid[]))`.
   The admin's session lists all companies. The app DB role is **not** `BYPASSRLS`, so a
   buggy query physically cannot return a company the user wasn't granted.
2. **App layer (guard):** A NestJS request-scoped `AccessContext` resolved from the session;
   an authorization guard checks the user holds the required permission **for the target
   company** before the handler runs.
3. **Proof:** An `access-isolation` test suite seeds an admin + an accountant granted only
   Company A, then asserts every Company-B read returns **zero** rows and writes are
   rejected, and that an empty/absent `app.accessible_companies` fails closed.

> Owner is a **singleton** in each instance (one row): it is the root of the org tree and
> the consolidation grouping, and carries instance/org-level settings. Companies and Groups
> reference it. The schema keeps the Owner FK so the model stays clean, but the app enforces
> exactly one Owner per instance.

---

## 3. Entity hierarchy data model (built in full now)

The consolidation **engine** is later, but the **data model** supports both consolidation
types from day one. No bolting on later.

```
Owner (singleton: the customer/admin org for this instance)
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

- **`owner`** — singleton org/instance identity + settings (one row).
- **`users`** — accountant/admin accounts; auth credentials (Argon2id hash, encrypted MFA secret).
- **`company_access`** — the grant table: `user_id × company_id × role` (admin grants these).
- **`companies`** — `name`, `mst` (tax code), `accounting_regime`
  (`circular_133 | circular_88 | circular_132 | circular_200`), `functional_currency`,
  `household_tier` (nullable: `lt_200m | 200m_1b | gt_1b | gt_3b`), status, timestamps.
- **`ownership_links`** — optional inter-company ownership (fields above). Nullable by
  design: portfolio owners have none.
- **`groups`** — `name`, `type (STATUTORY|MANAGEMENT)`, `reporting_currency`.
- **`group_memberships`** — `group_id`, `company_id` (+ optional weight/role).
- **`group_chart_of_accounts`** — group-level CoA (`group_id`, code, name, type).
- **`coa_mappings`** — `company_account_id → group_account_id`, the bridge that lets a
  Circular 133 SME and a Circular 88 household aggregate into one consolidated trial balance.
- **`currencies`** — `code`, `minor_unit_scale`, name. Seeded with VND (scale 0) + a few majors.
- **`chart_of_accounts`** — per-company accounts (codes/names depend on regime; seeded in Phase 1).

> Circular 133 (SME) and Circular 88 (household) entities are generally **not** required to
> file statutory consolidated FS. For those segments the STATUTORY group mode is dormant and
> the **MANAGEMENT/portfolio view is the product** — the core niche: one owner, several
> unrelated businesses, one combined view in a chosen reporting currency, IC netting optional.
> The portfolio view must work for any Owner regardless of regime or ownership links.

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
  `source_regulation` (citation), `notes`. Lookups always select the row whose
  `[effective_from, effective_to)` contains the transaction date.
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

- **`audit_log`** — append-only: `actor_user_id`, `action`, `entity_type`, `entity_id`,
  `before`/`after` (JSONB), `at`. Written for every financial mutation. Phase 0 builds the
  table + a NestJS interceptor; Phase 1 wires it to journal posting.
- **Append-only / reversal-based** principle established now: financial records are never
  silently edited; corrections are reversals. (Journal tables themselves are Phase 1.)
- **Double-entry** will be enforced at **both** layers (Phase 1 posting engine): app-layer
  domain invariant (Σdebits = Σcredits) + DB-layer constraint/trigger on balanced batches.
  Phase 0 documents the contract; the **single `PostingEngine`** is the only path to the GL —
  no module or UI writes the GL directly.

---

## 6. Auth, RBAC, security

- **Auth:** session-based, Argon2id password hashing, optional TOTP MFA, secure http-only
  cookies. Self-hosted in the API. First-run **admin bootstrap** (the Owner admin).
- **RBAC:** `roles` + `permissions`; access is granted **per company** via `company_access`
  (`user_id × company_id × role`). The admin (Owner) can see/manage everything and issues
  grants; an accountant only sees the companies granted to them. A NestJS guard checks the
  permission **for the target company**.
- **Security baseline:** secrets via env; AES-256-GCM field encryption for sensitive columns
  (bank account, national ID, MFA secret) with deployer-controlled key; input validation
  everywhere (Zod); rate limiting (Nest throttler); OWASP basics (CSRF, secure headers,
  parameterized queries via Drizzle). No telemetry / phone-home.

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
├─ docker-compose.yml      # one-command self-host (api + web + postgres)
├─ .env.example
├─ LICENSE                 # AGPL-3.0
├─ CLAUDE.md
├─ ARCHITECTURE.md
├─ MODULE_ROADMAP.md
├─ compliance-map.md
├─ pnpm-workspace.yaml
└─ turbo.json
```

Tooling: pnpm workspaces + Turborepo.

---

## 9. Packaging & self-hosting (open source)

- **`docker-compose.yml`** brings up Postgres + API + web with one command; `.env.example`
  documents all config (DB URL, session secret, field-encryption key, locale defaults).
- **No telemetry / no phone-home.** Data stays wherever the deployer runs it; data-residency
  obligations (e.g. Decree 53/2022) are the deployer's responsibility — documented in README.
- **First-run setup:** migrations auto-run; an admin-bootstrap step creates the Owner admin.
- **`LICENSE` (AGPL-3.0)**, `README` with self-host quickstart, `CONTRIBUTING.md` later.

---

## 10. Migrations, seed, testing, CI

- **Migrations:** Drizzle migrations for every schema change; RLS policies created in
  migrations. Run against ephemeral PG in CI.
- **Seed:** a **demo Owner** with a small **multi-company group** (one Circular 133 SME +
  one Circular 88 household, plus a **MANAGEMENT** group spanning both) so the entity model +
  portfolio path are exercised from Phase 0, plus a sample accountant user granted only one
  company (to exercise per-company access). (Journals/financials added in Phase 1.)
- **Tests:**
  - `access-isolation` suite (accountant cannot read/write a non-granted company; fail-closed
    on empty access context).
  - Unit tests for money helpers and effective-dated rule lookup (deterministic).
  - e2e smoke: admin bootstrap → create company → pick regime → create group → grant a user.
- **CI (GitHub Actions):** install → lint → typecheck → migrate ephemeral PG → unit +
  access-isolation + e2e.

---

## 11. Compliance documentation produced in Phase 0

- **`CLAUDE.md`** — repo conventions (money rules, posting-engine rule, citation requirement,
  RLS/access contract, no-business-logic-in-UI).
- **`ARCHITECTURE.md`** — this design, distilled + diagrams.
- **`MODULE_ROADMAP.md`** — phased module plan (AR/AP, SD, MM, Cash/Bank, Fixed Assets,
  E-invoicing, Tax engine, Payroll, full VAS statements, **Consolidation engine — statutory +
  management/portfolio**, XML export, BI, POS, multi-currency, DMS).
- **`compliance-map.md`** — table mapping each rule/feature → source regulation.
- **`docs/regulations/`** — index of the regulatory library from the prompt appendix, with the
  **VERIFY** items flagged (new CIT law, PIT Dec-2025 amendments, forthcoming 2026 household
  declaration circular).
- **`docs/open-questions.md`** — ambiguities to resolve with the user.

---

## 12. Explicitly out of scope for Phase 0 (later phases)

Journal entries, GL, trial balance, period open/close, financial statements (Phase 1);
posting engine implementation (Phase 1); operational modules SD/MM/POS, Cash/Bank, Fixed
Assets, E-invoicing, Tax engine, Payroll, **consolidation engine (statutory + portfolio)**,
XML export, BI, multi-currency translation (Phase 2+). Phase 0 only establishes the substrate.

---

## 13. Open questions for the user

1. **E-invoice provider** to target first behind the provider interface (Viettel / VNPT /
   MISA)? Affects invoice field mapping later — not blocking Phase 0.
2. **Demo composition** — is "1 SME (C133) + 1 household (C88) + 1 MANAGEMENT group + 1
   restricted accountant" the right minimal exercise, or also demo a **statutory ownership
   link** between two companies?
