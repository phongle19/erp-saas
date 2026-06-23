import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { PartnersService } from './partners.service.js';
import { PartnersController } from './partners.controller.js';
import { SalesInvoiceService } from './sales-invoice.service.js';
import { SalesInvoiceController } from './sales-invoice.controller.js';

@Module({
  imports: [DocumentsModule],
  controllers: [PartnersController, SalesInvoiceController],
  providers: [PartnersService, SalesInvoiceService],
  exports: [PartnersService, SalesInvoiceService],
})
export class SalesModule {}
