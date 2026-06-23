import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
import { MaterialsService } from './materials.service.js';
import { MaterialsController } from './materials.controller.js';
import { PurchaseInvoiceService } from '../purchasing/purchase-invoice.service.js';
import { PurchaseInvoiceController } from '../purchasing/purchase-invoice.controller.js';
import { GoodsIssueService } from '../purchasing/goods-issue.service.js';
import { GoodsIssueController } from '../purchasing/goods-issue.controller.js';
import { ApService } from '../purchasing/ap.service.js';
import { ApController } from '../purchasing/ap.controller.js';

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
 * B6: GoodsIssueService/Controller — goods issue (COGS at weighted-average cost).
 *   Dr 632 / Cr 156/152; over-issue rejected (422) with atomic rollback.
 *
 * B7: ApService/ApController — AP sub-ledger grouped by vendor (account 331).
 *   Read-only; reconciles to the trial-balance 331 balance. Mirrors A7 ArService.
 *   Also verifies inventory-valuation reconciliation to TB 156 in integration tests.
 *
 * B8 (vendor payments settling AP) will be added here when implemented.
 */
@Module({
  imports: [DocumentsModule],
  controllers: [
    InventoryController,
    MaterialsController,
    PurchaseInvoiceController,
    GoodsIssueController,
    ApController,
  ],
  providers: [InventoryService, MaterialsService, PurchaseInvoiceService, GoodsIssueService, ApService],
  exports: [InventoryService, MaterialsService, PurchaseInvoiceService, GoodsIssueService, ApService],
})
export class MmModule {}
