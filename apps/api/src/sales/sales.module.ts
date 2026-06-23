import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { PartnersService } from './partners.service.js';
import { PartnersController } from './partners.controller.js';
import { SalesInvoiceService } from './sales-invoice.service.js';
import { SalesInvoiceController } from './sales-invoice.controller.js';
import { ReceiptsService } from './receipts.service.js';
import { ReceiptsController } from './receipts.controller.js';

@Module({
  imports: [DocumentsModule],
  controllers: [PartnersController, SalesInvoiceController, ReceiptsController],
  providers: [PartnersService, SalesInvoiceService, ReceiptsService],
  exports: [PartnersService, SalesInvoiceService, ReceiptsService],
})
export class SalesModule {}
