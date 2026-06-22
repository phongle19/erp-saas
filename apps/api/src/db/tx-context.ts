import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from '@erp/db';

/**
 * The request's database handle is a drizzle *transaction* handle, obtained from
 * `db.transaction(async (tx) => ...)`. Drizzle's transaction type is the first
 * parameter of that callback; we derive it from `Db['transaction']` so the type
 * stays precise without hand-coupling to drizzle internals.
 */
export type TxHandle = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface TxContext {
  db: TxHandle;
  userId: string | null;
  isAdmin: boolean;
  accessibleCompanies: string[];
}

export const txStorage = new AsyncLocalStorage<TxContext>();

export function currentTx(): TxContext {
  const ctx = txStorage.getStore();
  if (!ctx) throw new Error('no transaction context — request not wrapped by tenant tx');
  return ctx;
}
