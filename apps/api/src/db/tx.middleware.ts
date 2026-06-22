import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runInTenantTx } from './tenant-tx.js';
import { resolveSession } from '../auth/session.util.js';

/**
 * Wraps the entire request lifecycle in ONE Postgres transaction whose `app.*`
 * RLS GUCs are derived from the resolved session. The transaction is held open
 * for the duration of the request: it commits when the response finishes and
 * rolls back if the response stream errors.
 *
 * The inner promise passed to `runInTenantTx` is what keeps the transaction
 * open — it resolves on `finish`/`close` (commit) and rejects on `error`
 * (rollback). Because `next()` is called inside the AsyncLocalStorage context,
 * every downstream handler sees the same pinned-connection tx via `currentTx()`.
 */
@Injectable()
export class TxMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const session = await resolveSession(req);
    const ctx = {
      userId: session?.userId ?? null,
      isAdmin: session?.isAdmin ?? false,
      accessibleCompanies: session?.accessibleCompanies ?? [],
    };

    try {
      await runInTenantTx(
        ctx,
        () =>
          new Promise<void>((resolve, reject) => {
            res.on('finish', resolve);
            res.on('close', resolve);
            res.on('error', reject);
            next();
          }),
      );
    } catch (err) {
      next(err as Error);
    }
  }
}
