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
import { StatementsService } from './statements.service.js';

@Controller()
export class ReportsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly statements: StatementsService,
  ) {}

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

  /**
   * GET /companies/:id/statements/balance-sheet?fiscalYear=<int>&through=<int>
   *
   * Circular 133 Balance Sheet (B01-DNN). Default `through` = 12.
   * 404 if the company's regime has no B01-DNN template.
   */
  @Get('companies/:id/statements/balance-sheet')
  @UseGuards(AuthGuard)
  async balanceSheet(
    @Param('id') companyId: string,
    @Query('fiscalYear') fiscalYearStr: string,
    @Query('through') throughStr?: string,
  ) {
    const { fiscalYear, throughPeriodNo } = this.parseStatementQuery(fiscalYearStr, throughStr);
    return this.statements.statement(companyId, fiscalYear, throughPeriodNo, 'B01-DNN');
  }

  /**
   * GET /companies/:id/statements/income-statement?fiscalYear=<int>&through=<int>
   *
   * Circular 133 Income Statement (B02-DNN). Default `through` = 12.
   * 404 if the company's regime has no B02-DNN template.
   */
  @Get('companies/:id/statements/income-statement')
  @UseGuards(AuthGuard)
  async incomeStatement(
    @Param('id') companyId: string,
    @Query('fiscalYear') fiscalYearStr: string,
    @Query('through') throughStr?: string,
  ) {
    const { fiscalYear, throughPeriodNo } = this.parseStatementQuery(fiscalYearStr, throughStr);
    return this.statements.statement(companyId, fiscalYear, throughPeriodNo, 'B02-DNN');
  }

  private parseStatementQuery(fiscalYearStr: string, throughStr?: string) {
    const fiscalYear = parseInt(fiscalYearStr, 10);
    if (!Number.isFinite(fiscalYear) || !Number.isInteger(fiscalYear)) {
      throw new BadRequestException('fiscalYear query param must be an integer');
    }
    const throughPeriodNo = throughStr !== undefined ? parseInt(throughStr, 10) : 12;
    if (!Number.isFinite(throughPeriodNo) || !Number.isInteger(throughPeriodNo)) {
      throw new BadRequestException('through query param must be an integer');
    }
    return { fiscalYear, throughPeriodNo };
  }
}
