import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
import { MaterialsService } from './materials.service.js';
import { MaterialsController } from './materials.controller.js';

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
 * B5–B8 services/controllers will be added here as they are implemented.
 */
@Module({
  controllers: [InventoryController, MaterialsController],
  providers: [InventoryService, MaterialsService],
  exports: [InventoryService, MaterialsService],
})
export class MmModule {}
