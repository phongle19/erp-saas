import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health/health.controller.js';
import { TxMiddleware } from './db/tx.middleware.js';

/**
 * Tenant-tx wiring decision (Phase 0):
 * We do NOT introduce a request-scoped DB provider. Services obtain the
 * request's transaction handle by calling `currentTx().db` (backed by
 * AsyncLocalStorage). This keeps DI simple and avoids NestJS REQUEST-scoped
 * provider propagation complexity. A `@Global()` DbModule is therefore not
 * needed and intentionally omitted.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TxMiddleware)
      // Liveness must not require the DB / a tenant transaction.
      .exclude({ path: 'health', method: RequestMethod.GET })
      .forRoutes('*');
  }
}
