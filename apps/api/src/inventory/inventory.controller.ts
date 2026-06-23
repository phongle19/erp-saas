import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../access/rbac.guard.js';
import { InventoryService } from './inventory.service.js';

@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /**
   * GET /companies/:id/inventory
   * Returns the weighted-average valuation report for all materials of a company.
   * Used to reconcile the GL 156/152 balance in B7.
   * bigint values are already serialised to strings in the service.
   */
  @Get('companies/:id/inventory')
  @UseGuards(AuthGuard)
  valuationReport(@Param('id') companyId: string) {
    return this.inventory.valuationReport(companyId);
  }

  /**
   * GET /companies/:id/inventory/:materialId/movements
   * Returns the full movement ledger for a specific material (ordered).
   * bigint values are serialised to strings in the service.
   */
  @Get('companies/:id/inventory/:materialId/movements')
  @UseGuards(AuthGuard)
  movements(@Param('id') companyId: string, @Param('materialId') materialId: string) {
    return this.inventory.movements(companyId, materialId);
  }
}
