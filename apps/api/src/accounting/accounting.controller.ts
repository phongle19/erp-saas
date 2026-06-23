import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, AdminGuard } from '../access/rbac.guard.js';
import { CoaService } from './coa.service.js';
import { PeriodsService } from './periods.service.js';

const SpecialPeriodSchema = z.object({
  periodNo: z.number().int().min(13),
  purpose: z.string().min(1),
  nameVi: z.string().min(1),
});

const GenerateFiscalYearSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  specialPeriods: z.array(SpecialPeriodSchema).optional(),
});

@Controller()
export class AccountingController {
  constructor(
    private readonly coa: CoaService,
    private readonly periods: PeriodsService,
  ) {}

  /** POST /companies/:id/coa/provision — provision CoA from regime (admin only). */
  @Post('companies/:id/coa/provision')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  provision(@Param('id') id: string) {
    return this.coa.provision(id);
  }

  /** GET /companies/:id/accounts — list accounts (auth required, RLS-scoped). */
  @Get('companies/:id/accounts')
  @UseGuards(AuthGuard)
  listAccounts(@Param('id') id: string) {
    return this.coa.list(id);
  }

  /**
   * POST /companies/:id/fiscal-years — generate periods for a fiscal year.
   * Body: { fiscalYear: number, specialPeriods?: [...] }
   */
  @Post('companies/:id/fiscal-years')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  generateFiscalYear(@Param('id') id: string, @Body() body: unknown) {
    const result = GenerateFiscalYearSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    const opts = result.data.specialPeriods !== undefined
      ? { specialPeriods: result.data.specialPeriods }
      : undefined;
    return this.periods.generateFiscalYear(id, result.data.fiscalYear, opts);
  }

  /**
   * GET /companies/:id/periods?fiscalYear= — list periods (auth required, RLS-scoped).
   */
  @Get('companies/:id/periods')
  @UseGuards(AuthGuard)
  listPeriods(
    @Param('id') id: string,
    @Query('fiscalYear') fiscalYearStr: string,
  ) {
    const fiscalYear = parseInt(fiscalYearStr, 10);
    if (!Number.isFinite(fiscalYear)) {
      throw new BadRequestException('fiscalYear query param must be a number');
    }
    return this.periods.list(id, fiscalYear);
  }

  /** POST /periods/:id/close — transition to closed (admin only). */
  @Post('periods/:id/close')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  close(@Param('id') id: string) {
    return this.periods.close(id);
  }

  /** POST /periods/:id/reopen — transition back to open (admin only). */
  @Post('periods/:id/reopen')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  reopen(@Param('id') id: string) {
    return this.periods.reopen(id);
  }

  /** POST /periods/:id/lock — terminal lock (admin only). */
  @Post('periods/:id/lock')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  lock(@Param('id') id: string) {
    return this.periods.lock(id);
  }
}
