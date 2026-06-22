# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the open-source, self-hosted, single-tenant foundation — monorepo, domain primitives (bigint money + effective-dated rules), PostgreSQL schema with the full entity hierarchy and company-scoped RLS, session auth with per-company RBAC, a Vietnamese-first web shell, demo seed, tests proving access isolation, packaging, CI, and compliance docs — with **no** accounting vertical slice yet.

**Architecture:** TypeScript monorepo (pnpm + Turborepo). `packages/domain` holds pure, I/O-free financial primitives. `packages/db` owns the Drizzle schema, RLS policies, migrations, and seed. `apps/api` (NestJS) wraps every request in a Postgres transaction that sets `app.*` session GUCs so RLS enforces per-company access at the DB layer; an app-layer guard mirrors it. `apps/web` (Next.js) is a thin Vietnamese-first client with no business logic. Money is always `bigint` minor units.

**Tech Stack:** Node 22, pnpm 9, Turborepo, TypeScript 5, NestJS 10, Next.js 15 (app router) + next-intl, Drizzle ORM + drizzle-kit + postgres.js, PostgreSQL 16, argon2, Zod, Vitest, Playwright, GitHub Actions, Docker Compose. License: AGPL-3.0.

**Spec:** `docs/superpowers/specs/2026-06-22-phase-0-architecture-foundation-design.md`

---

## File Structure (decomposition)

```
erp-saas/
├─ package.json                      # root, pnpm workspace scripts
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
├─ .eslintrc.cjs / .prettierrc / .gitignore / .env.example
├─ docker-compose.yml
├─ LICENSE                           # AGPL-3.0 full text
├─ README.md / CLAUDE.md / ARCHITECTURE.md / MODULE_ROADMAP.md / compliance-map.md
├─ .github/workflows/ci.yml
├─ docs/
│  ├─ regulations/README.md          # regulatory library index
│  ├─ glossary.md                    # VI↔EN accounting glossary
│  └─ open-questions.md
├─ packages/
│  ├─ domain/                        # money.ts, rules.ts, types.ts (pure, tested)
│  ├─ db/                            # schema/*.ts, rls.sql, migrations, client.ts, seed.ts
│  ├─ config-regimes/               # loader + per-regime config stubs
│  └─ i18n/                          # vi.json, en.json, index.ts
└─ apps/
   ├─ api/                           # NestJS: auth, access-context, rbac, companies, groups
   └─ web/                           # Next.js: bootstrap, login, companies, groups screens
```

Each task below is sequenced so the project always builds and tests pass.

---

## Task 1: Repo skeleton, workspace tooling, license & base docs

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore` (exists — extend), `.prettierrc`, `.eslintrc.cjs`, `LICENSE`, `README.md`
- Create: `docs/regulations/README.md`, `docs/glossary.md`, `docs/open-questions.md`

- [ ] **Step 1: Pin Node and pnpm**

Create `.nvmrc`:
```
22
```
Run: `corepack enable && corepack prepare pnpm@9.12.0 --activate`
Expected: `pnpm -v` prints `9.12.0`.

- [ ] **Step 2: Root `package.json`**

```json
{
  "name": "erp-saas",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "db:migrate": "pnpm --filter @erp/db migrate",
    "db:seed": "pnpm --filter @erp/db seed"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "prettier": "^3.3.0",
    "eslint": "^8.57.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 5: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 6: `.prettierrc` and `.eslintrc.cjs`**

`.prettierrc`:
```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```
`.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', '.next', 'node_modules', '*.config.*'],
};
```

- [ ] **Step 7: Extend `.gitignore`** — already contains node_modules etc.; ensure it has `*.tsbuildinfo` and `playwright-report/`.

- [ ] **Step 8: `LICENSE`** — write the full **GNU AGPL-3.0** text.

Run: `curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE`
Expected: `LICENSE` begins with "GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007".
(If offline, paste the canonical AGPL-3.0 text manually.)

- [ ] **Step 9: Compliance/README docs**

`docs/regulations/README.md` — index table of the regulatory library from the spec appendix with columns: Domain | Instrument | Status. Mark **VERIFY** rows: new CIT law (2025), PIT Dec-2025 amendments, forthcoming 2026 household declaration circular.

`docs/glossary.md` — seed the VI↔EN accounting glossary with the terms used so far: Hộ kinh doanh / Household business; Bút toán / Journal entry; Sổ cái / General ledger; Bảng cân đối thử / Trial balance; Hợp nhất / Consolidation; Mã số thuế (MST) / Tax code; Chế độ kế toán / Accounting regime.

`docs/open-questions.md` — seed with: (1) confirm current CIT rates vs the 2025 CIT law; (2) confirm revised PIT exemption thresholds & family deductions (Dec-2025 amendment); (3) content of the forthcoming 2026 household declaration circular; (4) first e-invoice provider to target (Viettel/VNPT/MISA).

`README.md` — project intro, AGPL-3.0 note, self-host quickstart placeholder (filled in Task 12), and an explicit line: **"Data residency is the deployer's responsibility (e.g. Decree 53/2022)."**

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: monorepo tooling, AGPL-3.0 license, base compliance docs"
```

---

## Task 2: `packages/domain` — bigint money primitives (TDD)

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`
- Create: `packages/domain/src/money.ts`, `packages/domain/src/types.ts`
- Test: `packages/domain/src/money.test.ts`

- [ ] **Step 1: Package manifest & tsconfig**

`packages/domain/package.json`:
```json
{
  "name": "@erp/domain",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```
`packages/domain/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```
`packages/domain/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 2: Write failing tests**

`packages/domain/src/money.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { money, add, subtract, negate, sumLines, equals, isZero, applyRate, Rounding } from './money.js';

const VND = 'VND';

describe('money', () => {
  it('constructs from bigint minor units', () => {
    expect(money(1000n, VND)).toEqual({ minor: 1000n, currency: VND });
  });
  it('adds same-currency amounts', () => {
    expect(add(money(1000n, VND), money(250n, VND))).toEqual(money(1250n, VND));
  });
  it('subtracts and can go negative', () => {
    expect(subtract(money(100n, VND), money(150n, VND))).toEqual(money(-50n, VND));
  });
  it('negates', () => {
    expect(negate(money(100n, VND))).toEqual(money(-100n, VND));
  });
  it('throws on currency mismatch', () => {
    expect(() => add(money(1n, VND), money(1n, 'USD'))).toThrow(/currency/i);
  });
  it('sums an array of lines, zero for empty', () => {
    expect(sumLines([money(10n, VND), money(20n, VND)], VND)).toEqual(money(30n, VND));
    expect(sumLines([], VND)).toEqual(money(0n, VND));
  });
  it('detects equality and zero', () => {
    expect(equals(money(5n, VND), money(5n, VND))).toBe(true);
    expect(isZero(money(0n, VND))).toBe(true);
  });
  it('applies a rate with explicit rounding (10% VAT on 1005 -> 101 half-up, 100 down)', () => {
    expect(applyRate(money(1005n, VND), 10n, 100n, Rounding.HALF_UP)).toEqual(money(101n, VND));
    expect(applyRate(money(1005n, VND), 10n, 100n, Rounding.DOWN)).toEqual(money(100n, VND));
  });
  it('applies 8% rate deterministically', () => {
    expect(applyRate(money(1_000_000n, VND), 8n, 100n, Rounding.HALF_UP)).toEqual(money(80_000n, VND));
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `pnpm --filter @erp/domain test`
Expected: FAIL — `Cannot find module './money.js'`.

- [ ] **Step 4: Implement `types.ts` and `money.ts`**

`packages/domain/src/types.ts`:
```ts
/** ISO-4217 code; VND has minor_unit_scale 0 (no subunit). */
export type CurrencyCode = string;

/** Money is always integer minor units. Never use number for money. */
export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}
```
`packages/domain/src/money.ts`:
```ts
import type { CurrencyCode, Money } from './types.js';
export type { Money } from './types.js';

export const money = (minor: bigint, currency: CurrencyCode): Money => ({ minor, currency });

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export const add = (a: Money, b: Money): Money => (assertSame(a, b), money(a.minor + b.minor, a.currency));
export const subtract = (a: Money, b: Money): Money => (assertSame(a, b), money(a.minor - b.minor, a.currency));
export const negate = (a: Money): Money => money(-a.minor, a.currency);
export const equals = (a: Money, b: Money): boolean => a.currency === b.currency && a.minor === b.minor;
export const isZero = (a: Money): boolean => a.minor === 0n;
export const isNegative = (a: Money): boolean => a.minor < 0n;

export const sumLines = (lines: readonly Money[], currency: CurrencyCode): Money =>
  lines.reduce((acc, l) => add(acc, l), money(0n, currency));

export enum Rounding { HALF_UP = 'HALF_UP', DOWN = 'DOWN' }

/**
 * Multiply a Money by a rational rate (numerator/denominator) using integer math only.
 * Used for VAT/PIT etc. Rounding is explicit and deterministic.
 */
export function applyRate(m: Money, numerator: bigint, denominator: bigint, rounding: Rounding): Money {
  if (denominator === 0n) throw new Error('denominator must not be zero');
  const product = m.minor * numerator;
  let q = product / denominator; // truncates toward zero
  const r = product % denominator;
  if (rounding === Rounding.HALF_UP && r !== 0n) {
    const twiceRem = (r < 0n ? -r : r) * 2n;
    if (twiceRem >= denominator) q += product < 0n ? -1n : 1n;
  }
  return money(q, m.currency);
}
```

- [ ] **Step 5: Add barrel `src/index.ts`**

```ts
export * from './types.js';
export * from './money.js';
export * from './rules.js';
```

- [ ] **Step 6: Run tests, verify pass**

Run: `pnpm --filter @erp/domain test`
Expected: PASS (all money tests green). (`rules.js` export will fail build until Task 3 — write `rules.ts` first if running typecheck; tests for money alone pass via vitest transform.)

- [ ] **Step 7: Commit** (after Task 3 so the barrel resolves)

---

## Task 3: `packages/domain` — effective-dated rule lookup (TDD)

**Files:**
- Create: `packages/domain/src/rules.ts`
- Test: `packages/domain/src/rules.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/domain/src/rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { findEffectiveRule, type Rule } from './rules.js';

const rules: Rule[] = [
  { ruleType: 'vat_rate', value: '10', effectiveFrom: '2014-01-01', effectiveTo: null, sourceRegulation: 'Law 13/2008' },
  { ruleType: 'vat_rate_reduced', value: '8', effectiveFrom: '2025-01-01', effectiveTo: '2026-12-31', sourceRegulation: 'Resolution 204/2025/QH15' },
  { ruleType: 'input_vat_noncash_threshold', value: '20000000', effectiveFrom: '2014-01-01', effectiveTo: '2025-06-30', sourceRegulation: 'old' },
  { ruleType: 'input_vat_noncash_threshold', value: '5000000', effectiveFrom: '2025-07-01', effectiveTo: null, sourceRegulation: 'Law 48/2024/QH15' },
];

describe('findEffectiveRule', () => {
  it('picks the row whose [from,to) window contains the date', () => {
    expect(findEffectiveRule(rules, 'input_vat_noncash_threshold', '2025-08-15')?.value).toBe('5000000');
    expect(findEffectiveRule(rules, 'input_vat_noncash_threshold', '2025-06-30')?.value).toBe('20000000');
  });
  it('treats effectiveTo as exclusive upper bound', () => {
    expect(findEffectiveRule(rules, 'input_vat_noncash_threshold', '2025-07-01')?.value).toBe('5000000');
  });
  it('treats null effectiveTo as open-ended', () => {
    expect(findEffectiveRule(rules, 'vat_rate', '2099-01-01')?.value).toBe('10');
  });
  it('returns the reduced 8% rate only inside its window', () => {
    expect(findEffectiveRule(rules, 'vat_rate_reduced', '2026-12-31')?.value).toBe('8');
    expect(findEffectiveRule(rules, 'vat_rate_reduced', '2027-01-01')).toBeUndefined();
  });
  it('returns undefined when no rule matches', () => {
    expect(findEffectiveRule(rules, 'vat_rate', '2000-01-01')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @erp/domain test rules`
Expected: FAIL — `Cannot find module './rules.js'`.

- [ ] **Step 3: Implement `rules.ts`**

```ts
/** A versioned, effective-dated rule. `value` kept as string to preserve bigint/decimal precision. */
export interface Rule {
  ruleType: string;
  value: string;
  effectiveFrom: string; // ISO date 'YYYY-MM-DD' (inclusive)
  effectiveTo: string | null; // ISO date (exclusive) or null = open-ended
  sourceRegulation: string;
}

/** Returns the single rule of `ruleType` whose [effectiveFrom, effectiveTo) contains `onDate`. */
export function findEffectiveRule(rules: readonly Rule[], ruleType: string, onDate: string): Rule | undefined {
  return rules.find(
    (r) =>
      r.ruleType === ruleType &&
      r.effectiveFrom <= onDate &&
      (r.effectiveTo === null || onDate < r.effectiveTo),
  );
}
```
(ISO `YYYY-MM-DD` strings compare correctly lexicographically.)

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @erp/domain test`
Expected: PASS (money + rules).

- [ ] **Step 5: Build + commit**

```bash
pnpm --filter @erp/domain build
git add packages/domain
git commit -m "feat(domain): bigint money primitives and effective-dated rule lookup"
```

---

## Task 4: `packages/db` — Drizzle schema for the full entity hierarchy

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`, `packages/db/src/schema/index.ts` and one file per table group:
  `enums.ts`, `org.ts` (owner, users, company_access, roles), `companies.ts`, `groups.ts`, `coa.ts`, `currencies.ts`, `rules.ts`, `audit.ts`

- [ ] **Step 1: Package manifest**

`packages/db/package.json`:
```json
{
  "name": "@erp/db",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "generate": "drizzle-kit generate",
    "migrate": "tsx src/migrate.ts",
    "seed": "tsx src/seed.ts",
    "test": "vitest run"
  },
  "dependencies": { "drizzle-orm": "^0.36.0", "postgres": "^3.4.4" },
  "devDependencies": { "drizzle-kit": "^0.28.0", "tsx": "^4.19.0", "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```
`packages/db/tsconfig.json`: same shape as domain's.

- [ ] **Step 2: `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/erp' },
});
```

- [ ] **Step 3: `src/client.ts`**

```ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

export function makeSql(url = process.env.DATABASE_URL!) {
  return postgres(url, { max: 10 });
}
export function makeDb(sql = makeSql()) {
  return drizzle(sql, { schema });
}
export type Db = ReturnType<typeof makeDb>;
export { schema };
```

- [ ] **Step 4: `src/schema/enums.ts`**

```ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const accountingRegime = pgEnum('accounting_regime', [
  'circular_133', 'circular_88', 'circular_132', 'circular_200',
]);
export const householdTier = pgEnum('household_tier', ['lt_200m', '200m_1b', 'gt_1b', 'gt_3b']);
export const groupType = pgEnum('group_type', ['STATUTORY', 'MANAGEMENT']);
export const controlType = pgEnum('control_type', ['subsidiary', 'associate', 'joint_venture']);
export const accountType = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);
```

- [ ] **Step 5: `src/schema/org.ts`** (owner singleton, users, roles, company_access)

```ts
import { pgTable, uuid, text, timestamp, boolean, unique } from 'drizzle-orm/pg-core';

export const owner = pgTable('owner', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  defaultLocale: text('default_locale').notNull().default('vi'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  mfaSecretEnc: text('mfa_secret_enc'), // AES-256-GCM ciphertext, nullable
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// per-company access grant: the admin issues these
export const companyAccess = pgTable(
  'company_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull(),
    role: text('role').notNull(), // 'accountant' | 'viewer' (RBAC role key)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uq: unique('company_access_user_company_uq').on(t.userId, t.companyId) }),
);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // opaque session token (hashed)
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 6: `src/schema/currencies.ts`**

```ts
import { pgTable, text, integer } from 'drizzle-orm/pg-core';
export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(),       // 'VND', 'USD'
  name: text('name').notNull(),
  minorUnitScale: integer('minor_unit_scale').notNull(), // VND=0, USD=2
});
```

- [ ] **Step 7: `src/schema/companies.ts`** (companies + ownership_links)

```ts
import { pgTable, uuid, text, timestamp, integer, date, bigint } from 'drizzle-orm/pg-core';
import { accountingRegime, householdTier, controlType } from './enums.js';
import { currencies } from './currencies.js';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  mst: text('mst'), // tax code; nullable for not-yet-registered households
  regime: accountingRegime('regime').notNull(),
  functionalCurrency: text('functional_currency').notNull().references(() => currencies.code),
  householdTier: householdTier('household_tier'), // nullable; only for household regime
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// OPTIONAL inter-company ownership; portfolio owners have none.
export const ownershipLinks = pgTable('ownership_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentCompanyId: uuid('parent_company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  childCompanyId: uuid('child_company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  ownershipPct: integer('ownership_pct').notNull(), // basis points? store as 0-10000 for 2dp precision
  controlType: controlType('control_type').notNull(),
  acquisitionDate: date('acquisition_date'),
  goodwillMinor: bigint('goodwill_minor', { mode: 'bigint' }), // minor units, nullable
});
```
> Note: `ownershipPct` stored as **basis points (0–10000)** to keep 2-decimal precision as an integer. Document this in `compliance-map.md`.

- [ ] **Step 8: `src/schema/groups.ts`** (groups + memberships)

```ts
import { pgTable, uuid, text, timestamp, integer, unique } from 'drizzle-orm/pg-core';
import { groupType } from './enums.js';
import { companies } from './companies.js';
import { currencies } from './currencies.js';

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: groupType('type').notNull(),
  reportingCurrency: text('reporting_currency').notNull().references(() => currencies.code),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const groupMemberships = pgTable(
  'group_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    weightBp: integer('weight_bp').notNull().default(10000), // basis points; portfolio weighting
  },
  (t) => ({ uq: unique('group_membership_uq').on(t.groupId, t.companyId) }),
);
```

- [ ] **Step 9: `src/schema/coa.ts`** (per-company CoA + group CoA + mapping)

```ts
import { pgTable, uuid, text, unique } from 'drizzle-orm/pg-core';
import { accountType } from './enums.js';
import { companies } from './companies.js';
import { groups } from './groups.js';

export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
  },
  (t) => ({ uq: unique('coa_company_code_uq').on(t.companyId, t.code) }),
);

export const groupChartOfAccounts = pgTable(
  'group_chart_of_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
  },
  (t) => ({ uq: unique('group_coa_code_uq').on(t.groupId, t.code) }),
);

// the bridge: per-company local account -> group account
export const coaMappings = pgTable(
  'coa_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyAccountId: uuid('company_account_id').notNull().references(() => chartOfAccounts.id, { onDelete: 'cascade' }),
    groupAccountId: uuid('group_account_id').notNull().references(() => groupChartOfAccounts.id, { onDelete: 'cascade' }),
  },
  (t) => ({ uq: unique('coa_mapping_uq').on(t.companyAccountId, t.groupAccountId) }),
);
```

- [ ] **Step 10: `src/schema/rules.ts`** (effective-dated tax rules)

```ts
import { pgTable, uuid, text, date } from 'drizzle-orm/pg-core';
export const taxRules = pgTable('tax_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleType: text('rule_type').notNull(),
  value: text('value').notNull(),               // string to preserve bigint/decimal precision
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),             // null = open-ended
  sourceRegulation: text('source_regulation').notNull(),
  notes: text('notes'),
});
```

- [ ] **Step 11: `src/schema/audit.ts`** (append-only audit log)

```ts
import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 12: `src/schema/index.ts`** — re-export every table

```ts
export * from './enums.js';
export * from './org.js';
export * from './currencies.js';
export * from './companies.js';
export * from './groups.js';
export * from './coa.js';
export * from './rules.js';
export * from './audit.js';
```

- [ ] **Step 12b: `src/index.ts`** — package barrel (the `package.json` `main` points here)

```ts
export * from './client.js'; // makeSql, makeDb, Db, schema (namespace re-export)
```
> `client.ts` already does `export { schema }` (a `* as schema` namespace), so consumers use `import { makeSql, makeDb, schema } from '@erp/db'`. There is no namespace import of `@erp/db` anywhere — always `import { schema } from '@erp/db'`.

- [ ] **Step 13: Generate the migration**

Run: `pnpm --filter @erp/db generate`
Expected: a SQL file under `packages/db/drizzle/` creating all tables/enums.

- [ ] **Step 14: Commit**

```bash
git add packages/db
git commit -m "feat(db): Drizzle schema for full entity hierarchy (owner, companies, groups, CoA mapping, rules, audit)"
```

---

## Task 5: `packages/db` — RLS policies, migrate runner, and the company-scoped contract

**Files:**
- Create: `packages/db/src/rls.sql`, `packages/db/src/migrate.ts`
- Create: `packages/db/drizzle/<NNNN>_rls.sql` (hand-authored, appended to migration list via `packages/db/drizzle/meta`) — simplest: run `rls.sql` in `migrate.ts` after Drizzle migrations.

- [ ] **Step 1: Write `src/rls.sql`** (company-scoped RLS; fails closed)

```sql
-- Company-scoped Row-Level Security.
-- The application connects as a NON-superuser, NON-BYPASSRLS role.
-- Each request sets, within its transaction:
--   SET LOCAL app.user_id = '<uuid>';
--   SET LOCAL app.is_admin = 'true'|'false';
--   SET LOCAL app.accessible_companies = '<uuid,uuid,...>';  -- may be empty
-- Policies fail CLOSED: if the GUC is unset, current_setting(...,true) returns NULL
-- and ANY(NULL) yields no rows.

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

-- helper to apply a standard company-scoped policy
-- (admins see all; others only granted companies)

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_access ON companies USING (
  app_is_admin() OR id = ANY(app_accessible_companies())
);

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY coa_access ON chart_of_accounts USING (
  app_is_admin() OR company_id = ANY(app_accessible_companies())
);

ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY gm_access ON group_memberships USING (
  app_is_admin() OR company_id = ANY(app_accessible_companies())
);

ALTER TABLE ownership_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY ol_access ON ownership_links USING (
  app_is_admin()
  OR parent_company_id = ANY(app_accessible_companies())
  OR child_company_id  = ANY(app_accessible_companies())
);

-- groups, owner, users, currencies, tax_rules are owner-global (single tenant):
-- readable by any authenticated user; writes are admin-only enforced in the app layer.
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_read ON groups USING (true);
```
> WITH CHECK clauses for writes are added in Phase 1 when posting begins; Phase 0 write-paths (create company, grant access) are admin-only via the app guard. Document this in `compliance-map.md`.

- [ ] **Step 2: Write `src/migrate.ts`**

```ts
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeSql, makeDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = makeSql();
  const db = makeDb(sql);
  await migrate(db, { migrationsFolder: join(__dirname, '../drizzle') });
  const rls = readFileSync(join(__dirname, 'rls.sql'), 'utf8');
  await sql.unsafe(rls);
  await sql.end();
  console.log('migrations + RLS applied');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Create the app DB role (documented; applied by compose init)**

Add to `packages/db/src/rls.sql` header comment and to the compose init (Task 12): the app must connect as a role created with neither SUPERUSER nor BYPASSRLS. For local dev the compose `erp` role is created without those attributes.

- [ ] **Step 4: Smoke-run migrate against local PG** (PG started in Task 12; if running now, use a throwaway container)

Run: `DATABASE_URL=postgres://erp:erp@localhost:5432/erp pnpm --filter @erp/db migrate`
Expected: prints `migrations + RLS applied`.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): company-scoped RLS policies (fail-closed) and migrate runner"
```

---

## Task 6: `packages/db` — seed demo Owner, companies, group, restricted accountant

**Files:**
- Create: `packages/db/src/seed.ts`

- [ ] **Step 1: Write `src/seed.ts`**

```ts
import { makeSql, makeDb, schema } from './client.js';

async function main() {
  const sql = makeSql();
  const db = makeDb(sql);

  await db.insert(schema.currencies).values([
    { code: 'VND', name: 'Vietnamese Dong', minorUnitScale: 0 },
    { code: 'USD', name: 'US Dollar', minorUnitScale: 2 },
  ]).onConflictDoNothing();

  const [own] = await db.insert(schema.owner)
    .values({ name: 'Demo Owner', defaultLocale: 'vi' }).returning();

  // one SME (Circular 133) + one household (Circular 88)
  const [sme] = await db.insert(schema.companies).values({
    name: 'Công ty TNHH Demo SME', mst: '0101234567', regime: 'circular_133',
    functionalCurrency: 'VND',
  }).returning();
  const [hkd] = await db.insert(schema.companies).values({
    name: 'Hộ kinh doanh Demo', mst: '8101234567', regime: 'circular_88',
    functionalCurrency: 'VND', householdTier: '200m_1b',
  }).returning();

  // a MANAGEMENT/portfolio group spanning both (unrelated companies)
  const [grp] = await db.insert(schema.groups).values({
    name: 'Danh mục tổng hợp (Portfolio)', type: 'MANAGEMENT', reportingCurrency: 'VND',
  }).returning();
  await db.insert(schema.groupMemberships).values([
    { groupId: grp.id, companyId: sme.id }, { groupId: grp.id, companyId: hkd.id },
  ]);

  // effective-dated tax rules (cite sources)
  await db.insert(schema.taxRules).values([
    { ruleType: 'vat_rate', value: '10', effectiveFrom: '2014-01-01', effectiveTo: null, sourceRegulation: 'Law on VAT' },
    { ruleType: 'vat_rate_reduced', value: '8', effectiveFrom: '2025-01-01', effectiveTo: '2027-01-01', sourceRegulation: 'Resolution 204/2025/QH15' }, // effectiveTo is EXCLUSIVE: 8% applies THROUGH 2026-12-31
    { ruleType: 'input_vat_noncash_threshold', value: '5000000', effectiveFrom: '2025-07-01', effectiveTo: null, sourceRegulation: 'Law 48/2024/QH15' },
    { ruleType: 'household_tier_threshold_exempt', value: '200000000', effectiveFrom: '2026-01-01', effectiveTo: null, sourceRegulation: 'Resolution 198/2025/QH15' },
  ]);

  // demo users: admin + accountant granted ONLY the SME (proves isolation)
  // password hashes are computed by the API bootstrap; for seed use placeholders replaced by Task 8 helper.
  console.log(JSON.stringify({ ownerId: own.id, smeId: sme.id, hkdId: hkd.id, groupId: grp.id }, null, 2));
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```
> User creation with real Argon2id hashes is wired in Task 8 (the API owns hashing). The seed prints the IDs the isolation tests (Task 9) consume.

- [ ] **Step 2: Run seed against local PG**

Run: `DATABASE_URL=postgres://erp:erp@localhost:5432/erp pnpm --filter @erp/db seed`
Expected: prints a JSON object with `ownerId`, `smeId`, `hkdId`, `groupId`.

- [ ] **Step 3: Commit**

```bash
git add packages/db
git commit -m "feat(db): seed demo owner, SME+household companies, portfolio group, tax rules"
```

---

## Task 7: `apps/api` — NestJS bootstrap + transaction-scoped tenant context (RLS wiring)

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/db/db.module.ts`, `apps/api/src/db/tx-context.ts`, `apps/api/src/db/tx.middleware.ts`

- [ ] **Step 1: Scaffold the Nest app**

Run: `pnpm dlx @nestjs/cli new apps/api --skip-git --package-manager pnpm --strict`
Then set `apps/api/package.json` name to `@erp/api`, add deps:
```
pnpm --filter @erp/api add @erp/db @erp/domain drizzle-orm postgres argon2 zod cookie
pnpm --filter @erp/api add -D vitest supertest @types/supertest tsx
```
Set `apps/api/tsconfig.json` to extend `../../tsconfig.base.json`.

- [ ] **Step 2: AsyncLocalStorage tx context**

`apps/api/src/db/tx-context.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from '@erp/db';

export interface TxContext { db: Db; userId: string | null; isAdmin: boolean; accessibleCompanies: string[]; }
export const txStorage = new AsyncLocalStorage<TxContext>();
export function currentTx(): TxContext {
  const ctx = txStorage.getStore();
  if (!ctx) throw new Error('no transaction context — request not wrapped by tx middleware');
  return ctx;
}
```

- [ ] **Step 3: Transaction middleware that sets RLS GUCs**

`apps/api/src/db/tx.middleware.ts`:
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { makeSql, schema } from '@erp/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import { txStorage } from './tx-context.js';
import { resolveSession } from '../auth/session.util.js';

const queryClient = makeSql();

@Injectable()
export class TxMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction) {
    const session = await resolveSession(req); // { userId, isAdmin, accessibleCompanies } | null
    const userId = session?.userId ?? null;
    const isAdmin = session?.isAdmin ?? false;
    const companies = session?.accessibleCompanies ?? [];

    await queryClient.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${userId ?? ''}, true)`;
      await tx`SELECT set_config('app.is_admin', ${isAdmin ? 'true' : 'false'}, true)`;
      await tx`SELECT set_config('app.accessible_companies', ${companies.join(',')}, true)`;
      const db = drizzle(tx, { schema });
      await new Promise<void>((resolve, reject) => {
        txStorage.run({ db, userId, isAdmin, accessibleCompanies: companies }, () => {
          // hand control to the rest of the request; resolve when response finished
          _res.on('finish', resolve);
          _res.on('close', resolve);
          next();
        });
      });
    });
  }
}
```
> `set_config(..., true)` is the function form of `SET LOCAL`, scoped to the transaction. Because the handler runs inside `queryClient.begin`, all its queries share the same connection and see the GUCs. Document this pattern in `ARCHITECTURE.md`.

- [ ] **Step 4: `db.module.ts`** exposes `currentTx().db` to providers via a request-scoped provider

`apps/api/src/db/db.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { currentTx } from './tx-context.js';

export const DB = Symbol('DB');
@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => currentTx().db }],
  exports: [DB],
})
export class DbModule {}
```
> Note: because the factory reads `currentTx()` at call time and providers resolve per request when scoped, mark the provider `scope: Scope.REQUEST`. Simpler alternative used by handlers: call `currentTx().db` directly in services. Prefer direct `currentTx()` calls in Phase 0 to avoid Nest scope complexity; keep `DB` token for later.

- [ ] **Step 5: Wire middleware in `app.module.ts`** and bootstrap in `main.ts` (cookie parser, global validation pipe, helmet, throttler).

`main.ts` essentials:
```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
```
Add deps: `pnpm --filter @erp/api add cookie-parser helmet @nestjs/throttler`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @erp/api typecheck`
Expected: passes (after `session.util.ts` stub from Task 8 exists — create a minimal stub returning `null` first if needed).

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): NestJS bootstrap + transaction-scoped RLS context middleware"
```

---

## Task 8: `apps/api` — auth (Argon2id, sessions) + admin bootstrap + field encryption

**Files:**
- Create: `apps/api/src/auth/crypto.util.ts` (Argon2id + AES-256-GCM), `apps/api/src/auth/session.util.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/src/auth/crypto.util.test.ts`

- [ ] **Step 1: Write failing test for field encryption round-trip**

`crypto.util.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encryptField, decryptField } from './crypto.util.js';

describe('field encryption', () => {
  it('round-trips a sensitive value', () => {
    const key = Buffer.alloc(32, 7); // 256-bit test key
    const ct = encryptField('123456789', key);
    expect(ct).not.toContain('123456789');
    expect(decryptField(ct, key)).toBe('123456789');
  });
  it('fails to decrypt with the wrong key', () => {
    const ct = encryptField('secret', Buffer.alloc(32, 1));
    expect(() => decryptField(ct, Buffer.alloc(32, 2))).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @erp/api test crypto`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `crypto.util.ts`**

```ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import argon2 from 'argon2';

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw);

// AES-256-GCM; output format: base64(iv).base64(tag).base64(ciphertext)
export function encryptField(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}
export function decryptField(payload: string, key: Buffer): string {
  const [ivB64, tagB64, ctB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
export function fieldKey(): Buffer {
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('FIELD_ENCRYPTION_KEY must be 64 hex chars (256-bit)');
  return Buffer.from(hex, 'hex');
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @erp/api test crypto`
Expected: PASS.

- [ ] **Step 5: Implement `session.util.ts`** (resolve session → access context)

```ts
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { makeDb, schema } from '@erp/db';

const db = makeDb(); // separate connection for session lookup (pre-tx)

export interface ResolvedSession { userId: string; isAdmin: boolean; accessibleCompanies: string[]; }

export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

export async function resolveSession(req: Request): Promise<ResolvedSession | null> {
  const raw = req.cookies?.['sid'];
  if (!raw) return null;
  const id = hashToken(raw);
  const now = new Date();
  const rows = await db.select().from(schema.sessions)
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, now))).limit(1);
  const s = rows[0];
  if (!s) return null;
  const user = (await db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1))[0];
  if (!user) return null;
  const grants = await db.select().from(schema.companyAccess).where(eq(schema.companyAccess.userId, user.id));
  return { userId: user.id, isAdmin: user.isAdmin, accessibleCompanies: grants.map((g) => g.companyId) };
}
```
> This session lookup uses a connection **outside** the request transaction (it must run before GUCs are set). It reads only `sessions`/`users`/`company_access`, which are owner-global, not company-scoped.

- [ ] **Step 6: Implement `auth.service.ts` + `auth.controller.ts`**

Endpoints (controller, with Zod DTOs validated via a pipe):
- `POST /auth/bootstrap` — allowed only when `users` is empty; creates the admin (Owner) user with `isAdmin=true`, hashed password; also inserts the `owner` row if absent. Returns 201.
- `POST /auth/login` — verify Argon2id, create a session row (store `hashToken(token)`), set `sid` http-only secure cookie. 
- `POST /auth/logout` — delete session row, clear cookie.

`auth.service.ts` (core methods):
```ts
import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { makeDb, schema } from '@erp/db';
import { hashPassword, verifyPassword } from './crypto.util.js';
import { hashToken } from './session.util.js';

@Injectable()
export class AuthService {
  private db = makeDb();
  async bootstrap(email: string, password: string, displayName: string, ownerName: string) {
    const count = (await this.db.execute(sql`select count(*)::int as n from users`)) as any;
    if (count[0].n > 0) throw new ConflictException('already bootstrapped');
    await this.db.insert(schema.owner).values({ name: ownerName }).onConflictDoNothing();
    await this.db.insert(schema.users).values({
      email, passwordHash: await hashPassword(password), displayName, isAdmin: true,
    });
  }
  async login(email: string, password: string): Promise<string> {
    const user = (await this.db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];
    if (!user || !(await verifyPassword(user.passwordHash, password))) throw new UnauthorizedException();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    await this.db.insert(schema.sessions).values({ id: hashToken(token), userId: user.id, expiresAt });
    return token;
  }
  async logout(token: string) {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  }
}
```
Controller sets the cookie: `res.cookie('sid', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7*24*3600*1000 })`.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): Argon2id auth, sessions, admin bootstrap, AES-256-GCM field encryption"
```

---

## Task 9: `apps/api` — companies/groups/access endpoints + RBAC guard, and the access-isolation test (TDD)

**Files:**
- Create: `apps/api/src/access/rbac.guard.ts`, `apps/api/src/companies/companies.controller.ts` + `.service.ts` + `.module.ts`, `apps/api/src/groups/...`, `apps/api/src/access/access.controller.ts` (grant)
- Test: `apps/api/test/access-isolation.e2e.test.ts`

- [ ] **Step 1: Write the failing access-isolation test**

`apps/api/test/access-isolation.e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { makeApp } from './helpers/make-app.js';      // boots Nest app against test DB
import { seedTwoCompaniesAndUsers } from './helpers/seed-test.js'; // admin + accountant(SME only)

let app: any, adminCookie: string, acctCookie: string, smeId: string, hkdId: string;

beforeAll(async () => {
  app = await makeApp();
  ({ adminCookie, acctCookie, smeId, hkdId } = await seedTwoCompaniesAndUsers(app));
});

describe('per-company access isolation (RLS + guard)', () => {
  it('admin sees all companies', async () => {
    const res = await request(app.getHttpServer()).get('/companies').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.id).sort()).toEqual([smeId, hkdId].sort());
  });
  it('accountant granted only the SME sees ONLY the SME', async () => {
    const res = await request(app.getHttpServer()).get('/companies').set('Cookie', acctCookie);
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.id)).toEqual([smeId]);
  });
  it('accountant cannot read the household company directly (zero rows)', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${hkdId}`).set('Cookie', acctCookie);
    expect(res.status).toBe(404); // RLS hides it -> not found
  });
  it('unauthenticated request fails closed', async () => {
    const res = await request(app.getHttpServer()).get('/companies');
    expect(res.status).toBe(401);
  });
});
```
Also create helpers: `test/helpers/make-app.ts` (uses `TEST_DATABASE_URL`, runs migrate+truncate), `test/helpers/seed-test.ts` (bootstrap admin, create SME+household, create accountant, grant SME only, return login cookies).

- [ ] **Step 2: Run test, verify it fails**

Run: `TEST_DATABASE_URL=postgres://erp:erp@localhost:5432/erp_test pnpm --filter @erp/api test access-isolation`
Expected: FAIL — endpoints `/companies` not implemented.

- [ ] **Step 3: Implement RBAC guard**

`access/rbac.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { currentTx } from '../db/tx-context.js';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    const tx = currentTx();
    if (!tx.userId) throw new UnauthorizedException();
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    const tx = currentTx();
    if (!tx.userId) throw new UnauthorizedException();
    if (!tx.isAdmin) throw new UnauthorizedException('admin only');
    return true;
  }
}
```

- [ ] **Step 4: Implement companies service/controller** (queries go through `currentTx().db`, so RLS filters automatically)

`companies/companies.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

@Injectable()
export class CompaniesService {
  list() { return currentTx().db.select().from(schema.companies); } // RLS-filtered
  async get(id: string) {
    const rows = await currentTx().db.select().from(schema.companies).where(eq(schema.companies.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundException(); // RLS-hidden -> not found
    return rows[0];
  }
  create(input: { name: string; regime: string; functionalCurrency: string }) {
    return currentTx().db.insert(schema.companies).values(input as any).returning();
  }
}
```
Controller: `GET /companies` (AuthGuard), `GET /companies/:id` (AuthGuard), `POST /companies` (AdminGuard, Zod DTO).

- [ ] **Step 5: Implement groups controller** (`POST /groups` AdminGuard; `GET /groups` AuthGuard) and **access controller** (`POST /company-access` AdminGuard → inserts a `company_access` grant).

- [ ] **Step 5b: Build the audit interceptor** `apps/api/src/audit/audit.interceptor.ts` — on any mutating route (POST/PATCH/DELETE), after the handler succeeds, append a row to `audit_log` via `currentTx().db`:

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next.handle();
    return next.handle().pipe(
      tap((result) => {
        const tx = currentTx();
        void tx.db.insert(schema.auditLog).values({
          actorUserId: tx.userId,
          action: `${req.method} ${req.route?.path ?? req.path}`,
          entityType: req.route?.path ?? 'unknown',
          entityId: (result as any)?.[0]?.id ?? (result as any)?.id ?? null,
          after: result ?? null,
        });
      }),
    );
  }
}
```
Register it globally in `app.module.ts` (`APP_INTERCEPTOR`). Add a test asserting that creating a company writes one `audit_log` row with the actor's id. (Journal-mutation wiring is Phase 1.)

- [ ] **Step 6: Run test, verify pass**

Run: `TEST_DATABASE_URL=postgres://erp:erp@localhost:5432/erp_test pnpm --filter @erp/api test access-isolation`
Expected: PASS — all four isolation assertions green.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): companies/groups/access endpoints, RBAC guards, access-isolation e2e proof"
```

---

## Task 10: `packages/i18n` and `packages/config-regimes` (loader scaffolds)

**Files:**
- Create: `packages/i18n/package.json`, `packages/i18n/src/vi.json`, `packages/i18n/src/en.json`, `packages/i18n/src/index.ts`
- Create: `packages/config-regimes/package.json`, `packages/config-regimes/src/index.ts`, `packages/config-regimes/src/types.ts`, `packages/config-regimes/src/registry.ts`
- Test: `packages/config-regimes/src/registry.test.ts`

- [ ] **Step 1: i18n catalogs** — `vi.json` (default) and `en.json` with the keys used by the web shell (Task 11): `app.title`, `nav.companies`, `nav.groups`, `auth.login`, `auth.email`, `auth.password`, `companies.create`, `companies.regime`, `groups.create`, `groups.type`.

`packages/i18n/src/index.ts`:
```ts
import vi from './vi.json' assert { type: 'json' };
import en from './en.json' assert { type: 'json' };
export const messages = { vi, en } as const;
export const defaultLocale = 'vi';
export type Locale = keyof typeof messages;
```

- [ ] **Step 2: config-regimes types**

`packages/config-regimes/src/types.ts`:
```ts
export type Regime = 'circular_133' | 'circular_88' | 'circular_132' | 'circular_200';
export interface AccountSeed { code: string; name: string; type: 'asset'|'liability'|'equity'|'revenue'|'expense'; }
export interface RegimeConfig {
  regime: Regime;
  label: string;            // VI label
  chartOfAccounts: AccountSeed[];   // filled in Phase 1
  statementTemplates: unknown[];    // filled in Phase 1
  declarationForms: unknown[];      // filled in Phase 1
}
```

- [ ] **Step 3: Write failing test for the registry loader**

`registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getRegimeConfig, listRegimes } from './registry.js';

describe('regime registry', () => {
  it('lists the four supported regimes', () => {
    expect(listRegimes().sort()).toEqual(['circular_132','circular_133','circular_200','circular_88']);
  });
  it('returns a config object keyed by regime (no hardcoded branching at call sites)', () => {
    expect(getRegimeConfig('circular_133').regime).toBe('circular_133');
  });
  it('throws on unknown regime', () => {
    // @ts-expect-error testing runtime guard
    expect(() => getRegimeConfig('circular_999')).toThrow(/unknown regime/i);
  });
});
```

- [ ] **Step 4: Run test, verify fail** → Run: `pnpm --filter @erp/config-regimes test` → FAIL (no module).

- [ ] **Step 5: Implement `registry.ts`** — a map from regime → `RegimeConfig` (CoA arrays empty in Phase 0), `getRegimeConfig`, `listRegimes`. Each stub config carries a code comment citing its circular (e.g. `// Circular 133/2016/TT-BTC — SME regime`).

- [ ] **Step 6: Run test, verify pass.** Build both packages. Commit.

```bash
git add packages/i18n packages/config-regimes
git commit -m "feat: i18n catalogs (vi/en) and pluggable regime config registry scaffold"
```

---

## Task 11: `apps/web` — Next.js Vietnamese-first shell (no business logic)

**Files:**
- Scaffold `apps/web` with `create-next-app`; add `next-intl`.
- Create: `apps/web/src/i18n.ts`, `apps/web/src/middleware.ts`, `apps/web/src/app/[locale]/layout.tsx`, login page, companies list/create, groups list/create, a thin API client `apps/web/src/lib/api.ts`.

- [ ] **Step 1: Scaffold**

Run: `pnpm dlx create-next-app@latest apps/web --ts --app --eslint --no-tailwind --src-dir --import-alias "@/*" --use-pnpm`
Set name to `@erp/web`. Add: `pnpm --filter @erp/web add next-intl @erp/i18n`.

- [ ] **Step 2: Configure `next-intl`** with `defaultLocale='vi'`, locales `['vi','en']`, messages from `@erp/i18n`. Middleware routes `/` → `/vi`.

- [ ] **Step 3: API client** `lib/api.ts` — `fetch` wrapper to `process.env.NEXT_PUBLIC_API_URL` with `credentials: 'include'` (cookies). **No business logic** — only calls endpoints.

- [ ] **Step 4: Screens** (server components + minimal client forms; all labels via `useTranslations`):
  - `/[locale]/login` — email/password → `POST /auth/login`.
  - `/[locale]/companies` — list (`GET /companies`) + create form (`POST /companies`, admin only; hide form when not admin).
  - `/[locale]/groups` — list + create (type STATUTORY/MANAGEMENT).
  - Show the portfolio (MANAGEMENT) group prominently with its member companies — this is the headline feature; render members from `GET /groups`.

- [ ] **Step 5: Verify it builds** → Run: `pnpm --filter @erp/web build` → Expected: build succeeds.

- [ ] **Step 6: Playwright smoke** `apps/web/e2e/smoke.spec.ts` — load `/vi/login`, assert the Vietnamese title renders. (Full e2e against the API runs in CI Task 13.)

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): Vietnamese-first Next.js shell — login, companies, groups, portfolio view"
```

---

## Task 12: Packaging — Docker Compose, env example, README quickstart

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `packages/db/docker/init.sql`
- Modify: `README.md` (quickstart)

- [ ] **Step 1: `packages/db/docker/init.sql`** — create the non-superuser app role (no BYPASSRLS) and the database (compose runs this on first boot). Also create `erp_test` DB for CI/local tests.

```sql
-- runs as the postgres superuser on container init
CREATE ROLE erp LOGIN PASSWORD 'erp' NOSUPERUSER NOCREATEDB NOBYPASSRLS;
CREATE DATABASE erp OWNER erp;
CREATE DATABASE erp_test OWNER erp;
```

- [ ] **Step 2: `docker-compose.yml`** — services: `db` (postgres:16, mounts `init.sql` into `/docker-entrypoint-initdb.d`, volume for data), `api` (builds `apps/api`, depends_on db, env from `.env`), `web` (builds `apps/web`). API container runs `pnpm db:migrate && node dist/main.js` on start.

- [ ] **Step 3: `.env.example`**

```bash
DATABASE_URL=postgres://erp:erp@db:5432/erp
SESSION_COOKIE_SECURE=true
FIELD_ENCRYPTION_KEY=<64 hex chars — generate with: openssl rand -hex 32>
NEXT_PUBLIC_API_URL=http://localhost:3001
DEFAULT_LOCALE=vi
```

- [ ] **Step 4: Dockerfiles** — multi-stage: install with pnpm, build the workspace, run. (Standard pnpm monorepo Dockerfile; copy `pnpm-lock.yaml`, fetch, build target app.)

- [ ] **Step 5: README quickstart**

````markdown
## Self-host quickstart
```bash
cp .env.example .env && openssl rand -hex 32   # paste into FIELD_ENCRYPTION_KEY
docker compose up -d
# first run: bootstrap the admin (Owner)
curl -X POST localhost:3001/auth/bootstrap -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"...","displayName":"Admin","ownerName":"My Business"}'
```
**Data residency is the deployer's responsibility (e.g. Vietnam's Decree 53/2022).**
````

- [ ] **Step 6: Verify end-to-end locally**

Run: `docker compose up -d --build` then the bootstrap curl, then login.
Expected: containers healthy; bootstrap returns 201; login sets `sid` cookie.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example apps/*/Dockerfile packages/db/docker README.md
git commit -m "chore: docker-compose self-host packaging, non-BYPASSRLS app role, quickstart"
```

---

## Task 13: CI — GitHub Actions (lint, typecheck, migrate, test incl. isolation + e2e)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: CI
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  build-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: erp, POSTGRES_PASSWORD: erp, POSTGRES_DB: erp_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U erp" --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgres://erp:erp@localhost:5432/erp_test
      TEST_DATABASE_URL: postgres://erp:erp@localhost:5432/erp_test
      FIELD_ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm --filter @erp/db migrate
      - run: pnpm test
```
> The app role created in `init.sql` doesn't exist in the CI service container; CI connects as the `erp` superuser-equivalent service user. **Important:** to actually exercise RLS in CI, the migrate/test step must connect as a NOBYPASSRLS role. Add a CI step that runs `CREATE ROLE erp_app LOGIN PASSWORD 'erp' NOBYPASSRLS; GRANT ...` and point `TEST_DATABASE_URL` for the API tests at `erp_app`. (The default `postgres`/service user bypasses RLS as table owner — RLS does not apply to the owner unless `FORCE ROW LEVEL SECURITY` is set.)

- [ ] **Step 2: Harden RLS for the owner role** — in `rls.sql`, add `ALTER TABLE <each rls table> FORCE ROW LEVEL SECURITY;` so policies apply even to the table owner. Re-run the isolation test locally to confirm it still passes as the owner connection.

- [ ] **Step 3: Push branch, open PR, confirm CI green.**

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml packages/db/src/rls.sql
git commit -m "ci: GitHub Actions pipeline; FORCE RLS so policies apply to table owner"
```

---

## Task 14: Top-level docs — CLAUDE.md, ARCHITECTURE.md, MODULE_ROADMAP.md, compliance-map.md

**Files:**
- Create: `CLAUDE.md`, `ARCHITECTURE.md`, `MODULE_ROADMAP.md`, `compliance-map.md`

- [ ] **Step 1: `CLAUDE.md`** — conventions for future contributors/agents:
  - Money is `bigint` minor units; never `number`/float. Use `@erp/domain` helpers.
  - All GL writes go through the single posting engine (Phase 1); UI/modules never write the GL directly.
  - Journals are append-only; corrections are reversals.
  - Every tax/accounting rule cites its source regulation in a comment AND in `compliance-map.md`; ambiguities go to `docs/open-questions.md` — never guess.
  - RLS contract: requests run inside the tx middleware; queries use `currentTx().db`; never connect with a BYPASSRLS role.
  - No business logic in the web app.

- [ ] **Step 2: `ARCHITECTURE.md`** — distilled from the spec: monorepo layout, single-tenant model, the tx-middleware/RLS GUC pattern (with the `set_config(...,true)` explanation), entity hierarchy diagram, posting-engine principle (forward-looking).

- [ ] **Step 3: `MODULE_ROADMAP.md`** — phases: Phase 0 (this), Phase 1 (accounting core vertical slice), Phase 2+ (AR/AP, SD, MM+inventory, Cash/Bank, Fixed Assets per Circular 45/2013, E-invoicing per Decree 123/70 + Circular 78, Tax engine VAT/CIT/PIT, Payroll + BHXH, full VAS statements incl. Cash Flow + Notes, **Consolidation engine — statutory (VAS 25/Circular 202) + management/portfolio**, eTax/iHTKK XML export, BI, POS cash-register e-invoices, multi-currency, DMS).

- [ ] **Step 4: `compliance-map.md`** — table: Feature/Rule | Source regulation | Where implemented | Status. Seed rows for everything touched in Phase 0 (VAT 8% reduced → Resolution 204/2025/QH15; non-cash ≥5M → Law 48/2024/QH15; household tiers → Resolution 198/2025/QH15; ownershipPct basis-points convention; RLS data-residency note → Decree 53/2022 deployer responsibility).

- [ ] **Step 5: Final self-host + test pass**

Run: `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm --filter @erp/db migrate && pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md ARCHITECTURE.md MODULE_ROADMAP.md compliance-map.md
git commit -m "docs: CLAUDE.md, ARCHITECTURE.md, MODULE_ROADMAP.md, compliance-map.md"
```

---

## Definition of Done (Phase 0)

- `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test` all pass.
- `docker compose up` brings up a working instance; admin bootstrap + login work.
- Domain: money + effective-dated rule lookup fully unit-tested.
- DB: full entity hierarchy migrated; company-scoped RLS with FORCE enabled.
- Access isolation **proven**: an accountant granted only the SME cannot read the household company (zero rows / 404); unauthenticated fails closed.
- Seed produces the demo Owner + SME(C133) + household(C88) + MANAGEMENT portfolio group + restricted accountant.
- AGPL-3.0 license; no telemetry; docs (CLAUDE/ARCHITECTURE/ROADMAP/compliance-map/regulations/glossary/open-questions) present.
- Compliance citations present in code and `compliance-map.md`; open items logged in `docs/open-questions.md`.

**STOP after Phase 0 and present for review before Phase 1 (accounting core).**
