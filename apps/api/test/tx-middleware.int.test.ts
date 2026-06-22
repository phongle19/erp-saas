import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { describe, expect, it } from 'vitest';
import { TxMiddleware } from '../src/db/tx.middleware.js';
import { runInTenantTx } from '../src/db/tenant-tx.js';
import { currentTx } from '../src/db/tx-context.js';

// Same DB gate as tenant-tx.int.test.ts: no-op without a real Postgres.
const DB_URL = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const maybe = DB_URL ? describe : describe.skip;

/**
 * Drives TxMiddleware through one simulated request. `handler` runs inside the
 * tenant transaction (as a real downstream handler would); afterwards the
 * response is "finished" with `statusCode`. We emit BOTH 'finish' and 'close'
 * because Express fires both in real life — this also exercises the once-guard
 * that must keep the tx from being settled twice.
 */
async function runRequest(statusCode: number, handler: () => Promise<void>): Promise<void> {
  const mw = new TxMiddleware();
  const req = {} as never;
  const res = new EventEmitter() as EventEmitter & { statusCode: number; headersSent: boolean };
  res.statusCode = 200;
  res.headersSent = false;

  const next = (): void => {
    void (async () => {
      try {
        await handler();
      } finally {
        res.statusCode = statusCode;
        res.headersSent = true;
        res.emit('finish');
        res.emit('close');
      }
    })();
  };

  await mw.use(req as never, res as never, next);
}

/** Counts owner rows with the given marker name, in a fresh committed tx. */
async function ownerExists(name: string): Promise<boolean> {
  return runInTenantTx(
    { userId: null, isAdmin: true, accessibleCompanies: [] },
    async () => {
      const { db } = currentTx();
      const rows = await db.execute(
        sql`SELECT count(*)::int AS n FROM owner WHERE name = ${name}`,
      );
      return (rows as unknown as Array<{ n: number }>)[0]!.n > 0;
    },
  );
}

const insertOwner = (name: string) => async (): Promise<void> => {
  const { db } = currentTx();
  await db.insert(schema.owner).values({ name, defaultLocale: 'vi' });
};

maybe('TxMiddleware — commit/rollback driven by response status', () => {
  it('rolls back the request transaction when the handler errors (status >= 400)', async () => {
    const marker = `rollback-${randomUUID()}`;

    // Handler writes a row, then the response finishes 500 (Nest's exception
    // filter wrote the error response). The partial write MUST NOT be committed.
    await runRequest(500, insertOwner(marker));

    expect(await ownerExists(marker)).toBe(false);
  });

  it('commits the request transaction when the response succeeds (status < 400)', async () => {
    const marker = `commit-${randomUUID()}`;

    await runRequest(200, insertOwner(marker));

    expect(await ownerExists(marker)).toBe(true);
  });
});
