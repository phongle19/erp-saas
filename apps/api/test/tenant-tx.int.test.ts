import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { runInTenantTx } from '../src/db/tenant-tx.js';
import { currentTx } from '../src/db/tx-context.js';

// Gate on a real Postgres connection. test/setup-env.ts mirrors
// TEST_DATABASE_URL -> DATABASE_URL *before* this module (and thus makeDb()) is
// imported. We skip the whole suite when neither var is set so it's a no-op in
// environments without a DB.
const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

maybe('runInTenantTx — GUC propagation against real Postgres', () => {
  const fakeUserId = randomUUID();
  let companyAId: string;
  let companyBId: string;

  beforeAll(async () => {
    // Seed in an admin context so FORCE RLS WITH CHECK passes for companies.
    await runInTenantTx(
      { userId: null, isAdmin: true, accessibleCompanies: [] },
      async () => {
        const { db } = currentTx();

        await db
          .insert(schema.currencies)
          .values({ code: 'VND', name: 'Vietnamese Dong', minorUnitScale: 0 })
          .onConflictDoNothing();

        const ownerRows = await db
          .insert(schema.owner)
          .values({ name: 'Test Owner', defaultLocale: 'vi' })
          .returning();
        const ownerId = ownerRows[0]!.id;

        const aRows = await db
          .insert(schema.companies)
          .values({
            ownerId,
            name: 'Company A',
            regime: 'circular_133',
            functionalCurrency: 'VND',
          })
          .returning();
        companyAId = aRows[0]!.id;

        const bRows = await db
          .insert(schema.companies)
          .values({
            ownerId,
            name: 'Company B',
            regime: 'circular_133',
            functionalCurrency: 'VND',
          })
          .returning();
        companyBId = bRows[0]!.id;
      },
    );

    expect(companyAId).toBeTruthy();
    expect(companyBId).toBeTruthy();
    expect(companyAId).not.toEqual(companyBId);
  });

  it('Test A — admin: GUC is set and all companies are visible', async () => {
    await runInTenantTx(
      { userId: fakeUserId, isAdmin: true, accessibleCompanies: [] },
      async () => {
        const { db } = currentTx();

        const guc = await db.execute(
          sql`SELECT current_setting('app.is_admin', true) AS v`,
        );
        expect((guc as unknown as Array<{ v: string }>)[0]!.v).toBe('true');

        const count = await db.execute(
          sql`SELECT count(*)::int AS n FROM companies`,
        );
        expect((count as unknown as Array<{ n: number }>)[0]!.n).toBe(2);
      },
    );
  });

  it('Test B — anonymous: fail-closed, zero companies visible', async () => {
    await runInTenantTx(
      { userId: null, isAdmin: false, accessibleCompanies: [] },
      async () => {
        const { db } = currentTx();
        const count = await db.execute(
          sql`SELECT count(*)::int AS n FROM companies`,
        );
        expect((count as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
      },
    );
  });

  it('Test C — scoped: only the granted company is visible', async () => {
    await runInTenantTx(
      { userId: fakeUserId, isAdmin: false, accessibleCompanies: [companyAId] },
      async () => {
        const { db } = currentTx();

        const count = await db.execute(
          sql`SELECT count(*)::int AS n FROM companies`,
        );
        expect((count as unknown as Array<{ n: number }>)[0]!.n).toBe(1);

        const rows = await db.execute(sql`SELECT id FROM companies`);
        expect((rows as unknown as Array<{ id: string }>)[0]!.id).toBe(companyAId);
      },
    );
  });
});
