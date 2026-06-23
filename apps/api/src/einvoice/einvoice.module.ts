import { Module } from '@nestjs/common';
import { ViettelStubProvider } from './providers/viettel.stub.js';
import { VnptStubProvider } from './providers/vnpt.stub.js';
import { MisaStubProvider } from './providers/misa.stub.js';
import { EInvoiceProviderRegistry } from './provider.registry.js';
import { EInvoiceService } from './einvoice.service.js';
import { EInvoiceController } from './einvoice.controller.js';

/**
 * E-invoice module.
 *
 * Registers the three provider stubs (Viettel / VNPT / MISA), the provider
 * registry, the service, and the controller. Wire into AppModule.imports[].
 *
 * No imports from DocumentsModule: e-invoice issuance is NOT a GL event.
 * The GL effect was recorded when the sales invoice was posted (Phase 2a A5).
 */
@Module({
  controllers: [EInvoiceController],
  providers: [
    ViettelStubProvider,
    VnptStubProvider,
    MisaStubProvider,
    EInvoiceProviderRegistry,
    EInvoiceService,
  ],
  exports: [EInvoiceService],
})
export class EInvoiceModule {}
