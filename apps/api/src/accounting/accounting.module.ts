import { Module } from '@nestjs/common';
import { CoaService } from './coa.service.js';
import { PeriodsService } from './periods.service.js';
import { PostingEngineService } from './posting-engine.service.js';
import { AccountingController } from './accounting.controller.js';
import { JournalsController } from './journals.controller.js';

@Module({
  controllers: [AccountingController, JournalsController],
  providers: [CoaService, PeriodsService, PostingEngineService],
  exports: [PeriodsService, PostingEngineService],
})
export class AccountingModule {}
