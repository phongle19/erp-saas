import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '../access/rbac.guard.js';
import { ApService } from './ap.service.js';

@Controller()
export class ApController {
  constructor(private readonly ap: ApService) {}

  /**
   * GET /companies/:id/ap?fiscalYear=<int>&through=<int>
   *
   * Returns the AP sub-ledger grouped by vendor for account 331 (Phải trả người bán),
   * cumulative through the given period. Default through=12.
   *
   * AP is credit-normal: each vendor's `balance` = credit − debit (open payable,
   * positive = owed to vendor). The response `total` reconciles to the trial-balance
   * 331 balance.
   *
   * Amounts are bigint strings (exact, no float).
   *
   * Mirrors GET /companies/:id/ar (A7) for the AP control account.
   */
  @Get('companies/:id/ap')
  @UseGuards(AuthGuard)
  async apByVendor(
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

    return this.ap.apByVendor(companyId, fiscalYear, throughPeriodNo);
  }

  /**
   * GET /companies/:id/ap/:partnerId?fiscalYear=<int>&through=<int>
   *
   * Returns the AP movement ledger for a single vendor (partner) on account 331,
   * with a credit-positive running balance. Default through=12.
   *
   * Returns 404 if the partner is not found or is inaccessible to the caller.
   *
   * Mirrors GET /companies/:id/ar/:partnerId (A7) for the AP control account.
   */
  @Get('companies/:id/ap/:partnerId')
  @UseGuards(AuthGuard)
  async apForVendor(
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

    return this.ap.apForVendor(companyId, partnerId, fiscalYear, throughPeriodNo);
  }
}
