import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '../access/rbac.guard.js';
import { ArService } from './ar.service.js';

@Controller()
export class ArController {
  constructor(private readonly ar: ArService) {}

  /**
   * GET /companies/:id/ar?fiscalYear=<int>&through=<int>
   *
   * Returns the AR sub-ledger grouped by customer for account 131,
   * cumulative through the given period. Default through=12.
   *
   * The response `total` reconciles to the trial-balance 131 balance.
   * Amounts are bigint strings (exact, no float).
   */
  @Get('companies/:id/ar')
  @UseGuards(AuthGuard)
  async arByCustomer(
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

    return this.ar.arByCustomer(companyId, fiscalYear, throughPeriodNo);
  }

  /**
   * GET /companies/:id/ar/:partnerId?fiscalYear=<int>&through=<int>
   *
   * Returns the AR movement ledger for a single customer (partner) on account 131,
   * with a running balance. Default through=12.
   *
   * Returns 404 if the partner is not found or is inaccessible to the caller.
   */
  @Get('companies/:id/ar/:partnerId')
  @UseGuards(AuthGuard)
  async arForCustomer(
    @Param('id') companyId: string,
    @Param('partnerId') partnerId: string,
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

    return this.ar.arForCustomer(companyId, partnerId, fiscalYear, throughPeriodNo);
  }
}
