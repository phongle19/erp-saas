import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
import { MaterialsService } from './materials.service.js';
import { MaterialsController } from './materials.controller.js';
import { PurchaseInvoiceService } from '../purchasing/purchase-invoice.service.js';
import { PurchaseInvoiceController } from '../purchasing/purchase-invoice.controller.js';

/**
 * MmModule (Materials Management) — Phase 2b.
 *
 * B3: InventoryService — weighted-average inventory valuation engine.
 *   Exported so B5 (purchase-invoice) and B6 (goods-issue) services can inject
 *   it and call applyReceipt / applyIssue inside their own request transactions
 *   (movement + journal post commit atomically).
 *
 * B4: MaterialsService/MaterialsController — material (inventory item) master CRUD.
 *   Vendor master is NOT a separate endpoint: POST /companies/:id/partners with
 *   partnerType: 'vendor' (from SalesModule / PartnersService, A4) already covers it.
 *
 * B5: PurchaseInvoiceService/Controller — purchase invoice (goods receipt +
 *   input VAT + AP). Imports DocumentsModule for the PostingEngine; injects
 *   InventoryService for the weighted-average receipt inside the same request tx.
 *
 * B6–B8 services/controllers will be added here as they are implemented.
 */
@Module({
  imports: [DocumentsModule],
  controllers: [
    InventoryController,
    MaterialsController,
    PurchaseInvoiceController,
  ],
  providers: [InventoryService, MaterialsService, PurchaseInvoiceService],
  exports: [InventoryService, MaterialsService, PurchaseInvoiceService],
})
export class MmModule {}
