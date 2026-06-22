import { Module } from '@nestjs/common';
import { CoaService } from './coa.service.js';
import { PeriodsService } from './periods.service.js';
import { AccountingController } from './accounting.controller.js';

@Module({
  controllers: [AccountingController],
  providers: [CoaService, PeriodsService],
  exports: [PeriodsService],
})
export class AccountingModule {}
