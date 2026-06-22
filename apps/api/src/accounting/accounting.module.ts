import { Module } from '@nestjs/common';
import { CoaService } from './coa.service.js';
import { PeriodsService } from './periods.service.js';
import { PostingEngineService } from './posting-engine.service.js';
import { LedgerService } from './ledger.service.js';
import { StatementsService } from './statements.service.js';
import { AccountingController } from './accounting.controller.js';
import { JournalsController } from './journals.controller.js';
import { ReportsController } from './reports.controller.js';

@Module({
  controllers: [AccountingController, JournalsController, ReportsController],
  providers: [CoaService, PeriodsService, PostingEngineService, LedgerService, StatementsService],
  exports: [PeriodsService, PostingEngineService, LedgerService, StatementsService],
})
export class AccountingModule {}
