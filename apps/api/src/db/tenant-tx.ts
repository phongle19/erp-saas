import { sql } from 'drizzle-orm';
import { makeDb, type Db } from '@erp/db';
import { txStorage, type TxContext } from './tx-context.js';

// Single shared connection pool / drizzle instance for the process.
const db: Db = makeDb();

export interface TenantContextInput {
  userId: string | null;
  isAdmin: boolean;
  accessibleCompanies: string[];
}

/**
 * Opens ONE Postgres transaction on a single pinned connection, sets the `app.*`
 * RLS GUCs (transaction-local via `set_config(..., true)`), runs `fn` inside the
 * AsyncLocalStorage tenant context, and returns fn's result.
 *
 * Commits when `fn` resolves; rolls back when it throws. The drizzle transaction
 * handle (`tx`) is stored as the request's db handle so any query made inside `fn`
 * runs on the same connection and is therefore subject to the GUC-driven RLS.
 *
 * NOTE: we intentionally use drizzle's own `db.transaction(...)` API. Wrapping a
 * raw postgres.js transaction handle with `drizzle(pgTx, { schema })` throws,
 * because a postgres.js transaction handle lacks `.options.parsers`.
 */
export async function runInTenantTx<T>(
  ctx: TenantContextInput,
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`);
    await tx.execute(sql`SELECT set_config('app.is_admin', ${ctx.isAdmin ? 'true' : 'false'}, true)`);
    await tx.execute(
      sql`SELECT set_config('app.accessible_companies', ${ctx.accessibleCompanies.join(',')}, true)`,
    );
    const store: TxContext = {
      db: tx,
      userId: ctx.userId,
      isAdmin: ctx.isAdmin,
      accessibleCompanies: ctx.accessibleCompanies,
    };
    return txStorage.run(store, fn);
  });
}
