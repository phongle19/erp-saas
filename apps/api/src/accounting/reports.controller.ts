import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '../access/rbac.guard.js';
import { LedgerService } from './ledger.service.js';

@Controller()
export class ReportsController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * GET /companies/:id/trial-balance?fiscalYear=<int>&through=<int>
   *
   * Returns the cumulative trial balance through the given period number.
   * Default `through` = 12 (excludes special adjustment/closing periods ≥ 13).
   * Authenticate required; RLS scopes the result to accessible companies.
   */
  @Get('companies/:id/trial-balance')
  @UseGuards(AuthGuard)
  async trialBalance(
    @Param('id') companyId: string,
    @Query('fiscalYear') fiscalYearStr: string,
    @Query('through') throughStr?: string,
  ) {
    const fiscalYear = parseInt(fiscalYearStr, 10);
    if (!Number.isFinite(fiscalYear) || !Number.isInteger(fiscalYear)) {
      throw new BadRequestException('fiscalYear query param must be an integer');
    }

    const throughPeriodNo = throughStr !== undefined
      ? parseInt(throughStr, 10)
      : 12;
    if (!Number.isFinite(throughPeriodNo) || !Number.isInteger(throughPeriodNo)) {
      throw new BadRequestException('through query param must be an integer');
    }

    return this.ledger.trialBalance(companyId, fiscalYear, throughPeriodNo);
  }

  /**
   * GET /companies/:id/ledger?account=<code>&fiscalYear=<int>&through=<int>
   *
   * Returns the general ledger for a single account with running balance.
   * Default `through` = 12.
   * Returns 404 if the account code is unknown for the company.
   */
  @Get('companies/:id/ledger')
  @UseGuards(AuthGuard)
  async generalLedger(
    @Param('id') companyId: string,
    @Query('account') accountCode: string,
    @Query('fiscalYear') fiscalYearStr: string,
    @Query('through') throughStr?: string,
  ) {
    if (!accountCode || accountCode.trim() === '') {
      throw new BadRequestException('account query param is required');
    }

    const fiscalYear = parseInt(fiscalYearStr, 10);
    if (!Number.isFinite(fiscalYear) || !Number.isInteger(fiscalYear)) {
      throw new BadRequestException('fiscalYear query param must be an integer');
    }

    const throughPeriodNo = throughStr !== undefined
      ? parseInt(throughStr, 10)
      : 12;
    if (!Number.isFinite(throughPeriodNo) || !Number.isInteger(throughPeriodNo)) {
      throw new BadRequestException('through query param must be an integer');
    }

    return this.ledger.generalLedger(companyId, accountCode, fiscalYear, throughPeriodNo);
  }
}
