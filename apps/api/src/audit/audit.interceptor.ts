import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

/**
 * Appends an `audit_log` row for every SUCCESSFUL mutating request (POST/PATCH/
 * DELETE), inside the request's tenant transaction. Because it runs in the same
 * tx, a rolled-back request (error response) logs nothing — correct.
 *
 * It logs the handler RESULT, not the request body, so password fields (which
 * only ever appear in request bodies, never in responses) are never persisted.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{
      method: string;
      path: string;
      route?: { path?: string };
    }>();
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next.handle();
    // mergeMap (not tap): the audit INSERT must be awaited so it commits inside
    // the SAME request tx before the response is sent. With a fire-and-forget
    // `void insert(...)` the middleware can COMMIT on res 'finish' before the
    // insert reaches Postgres, silently dropping the audit row.
    return next.handle().pipe(
      mergeMap(async (result) => {
        const tx = currentTx();
        const entityId =
          (result as { id?: string })?.id ??
          (result as Array<{ id?: string }>)?.[0]?.id ??
          null;
        await tx.db.insert(schema.auditLog).values({
          actorUserId: tx.userId,
          action: `${req.method} ${req.route?.path ?? req.path}`,
          entityType: req.route?.path ?? 'unknown',
          entityId,
          after: (result as unknown) ?? null,
        });
        return result;
      }),
    );
  }
}
