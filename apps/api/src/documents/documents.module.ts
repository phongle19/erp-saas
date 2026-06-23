import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { DocumentPostingService } from './document-posting.js';

/**
 * Groups document-layer helpers: DocumentPostingService wraps PostingEngineService
 * so A5 (sales invoices) and A6 (customer receipts) can inject a single,
 * tested post+reverse surface rather than reaching the engine directly.
 */
@Module({
  imports: [AccountingModule],
  providers: [DocumentPostingService],
  exports: [DocumentPostingService],
})
export class DocumentsModule {}
