import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { PartnersService } from './partners.service.js';
import { PartnersController } from './partners.controller.js';
import { SalesInvoiceService } from './sales-invoice.service.js';
import { SalesInvoiceController } from './sales-invoice.controller.js';
import { ReceiptsService } from './receipts.service.js';
import { ReceiptsController } from './receipts.controller.js';
import { ArService } from './ar.service.js';
import { ArController } from './ar.controller.js';

@Module({
  imports: [DocumentsModule],
  controllers: [PartnersController, SalesInvoiceController, ReceiptsController, ArController],
  providers: [PartnersService, SalesInvoiceService, ReceiptsService, ArService],
  exports: [PartnersService, SalesInvoiceService, ReceiptsService, ArService],
})
export class SalesModule {}
