import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe. Intentionally does NOT touch the database and is EXCLUDED
 * from the tenant transaction middleware, so it stays green even if the DB is
 * unreachable.
 */
@Controller('health')
export class HealthController {
  @Get()
  live(): { status: string } {
    return { status: 'ok' };
  }
}
