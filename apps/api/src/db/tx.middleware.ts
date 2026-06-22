import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runInTenantTx } from './tenant-tx.js';
import { resolveSession } from '../auth/session.util.js';

/**
 * Wraps the entire request lifecycle in ONE Postgres transaction whose `app.*`
 * RLS GUCs are derived from the resolved session. The transaction is held open
 * for the duration of the request.
 *
 * COMMIT vs ROLLBACK is decided by the final HTTP status:
 *  - response finishes with status < 400  -> resolve -> COMMIT
 *  - response finishes with status >= 400  -> reject  -> ROLLBACK (a handler threw;
 *    Nest's exception filter already wrote the error response, so we must NOT commit
 *    whatever partial writes it made, and must NOT call next() again).
 *  - socket 'error' -> reject -> ROLLBACK.
 *
 * Because `next()` is called inside the AsyncLocalStorage context, every downstream
 * handler sees the same pinned-connection tx via `currentTx()`.
 */
class TxRollback extends Error {
  constructor(readonly statusCode: number) {
    super(`transaction rolled back due to error response (status ${statusCode})`);
  }
}

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
            const settle = () =>
              res.statusCode >= 400 ? reject(new TxRollback(res.statusCode)) : resolve();
            res.on('finish', settle);
            res.on('close', settle);
            res.on('error', reject);
            next();
          }),
      );
    } catch (err) {
      // TxRollback means the response was already sent (handler error) — the tx has
      // rolled back; do nothing further. Any other error happened before the response
      // was sent, so forward it to Nest's error handling (guarded against double-send).
      if (err instanceof TxRollback) return;
      if (!res.headersSent) next(err as Error);
    }
  }
}
