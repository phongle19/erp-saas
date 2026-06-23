import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health/health.controller.js';
import { TxMiddleware } from './db/tx.middleware.js';
import { AuthModule } from './auth/auth.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { AccessModule } from './access/access.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';

/**
 * Tenant-tx wiring decision (Phase 0):
 * We do NOT introduce a request-scoped DB provider. Services obtain the
 * request's transaction handle by calling `currentTx().db` (backed by
 * AsyncLocalStorage). This keeps DI simple and avoids NestJS REQUEST-scoped
 * provider propagation complexity. A `@Global()` DbModule is therefore not
 * needed and intentionally omitted.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    CompaniesModule,
    GroupsModule,
    AccessModule,
    AccountingModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
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
