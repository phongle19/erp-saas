import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { describe, it, expect, beforeAll } from 'vitest';
import { runInTenantTx } from '../src/db/tenant-tx.js';
import { currentTx } from '../src/db/tx-context.js';
import { makeApp, closeApp, type TestApp } from './helpers/make-app.js';

const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

const ADMIN = { userId: null, isAdmin: true, accessibleCompanies: [] as string[] };

async function companyCount(): Promise<number> {
  return runInTenantTx(ADMIN, async () => {
    const rows = await currentTx().db.execute(
      sql`SELECT count(*)::int AS n FROM companies`,
    );
    return (rows as unknown as Array<{ n: number }>)[0]!.n;
  });
}

async function ownerId(): Promise<string> {
  return runInTenantTx(ADMIN, async () => {
    const rows = await currentTx().db.select().from(schema.owner).limit(1);
    return rows[0]!.id;
  });
}

maybe('tenant tx — rollback on throw (the mechanism the middleware relies on)', () => {
  let app: TestApp;

  beforeAll(async () => {
    // makeApp truncates + bootstraps a clean DB; we then need a single owner row.
    app = await makeApp();
    await runInTenantTx(ADMIN, async () => {
      await currentTx()
        .db.insert(schema.owner)
        .values({ name: 'Rollback Test Owner', defaultLocale: 'vi' });
    });
  });

  it('insert + throw inside one tx leaves no committed company row', async () => {
    const oid = await ownerId();
    const before = await companyCount();

    const marker = `rollback-${randomUUID()}`;
    await expect(
      runInTenantTx(ADMIN, async () => {
        await currentTx()
          .db.insert(schema.companies)
          .values({
            ownerId: oid,
            name: marker,
            regime: 'circular_133',
            functionalCurrency: 'VND',
          });
        throw new Error('boom — force rollback');
      }),
    ).rejects.toThrow('boom — force rollback');

    const after = await companyCount();
    expect(after).toBe(before);
  });

  it('cleanup: closes the app connection', async () => {
    await closeApp(app);
  });
});
