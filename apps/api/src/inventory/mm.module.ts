import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';

/**
 * MmModule (Materials Management) — Phase 2b.
 *
 * B3: InventoryService — weighted-average inventory valuation engine.
 *   Exported so B5 (purchase-invoice) and B6 (goods-issue) services can inject
 *   it and call applyReceipt / applyIssue inside their own request transactions
 *   (movement + journal post commit atomically).
 *
 * B4–B8 services/controllers will be added here as they are implemented.
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class MmModule {}
