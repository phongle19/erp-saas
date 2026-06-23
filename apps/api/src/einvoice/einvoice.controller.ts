import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../access/rbac.guard.js';
import { EInvoiceService } from './einvoice.service.js';
import type { schema } from '@erp/db';

type EInvoiceRow = typeof schema.einvoices.$inferSelect;

/**
 * Serialize an e-invoice row for the wire: bigint minor amounts → string.
 *
 * The global audit interceptor persists controller return values to jsonb;
 * bigint cannot be JSON-stringified, so we convert here. Mirrors the pattern
 * in sales-invoice.controller.ts and receipts.controller.ts.
 */
function serialize(row: EInvoiceRow) {
  return {
    ...row,
    subtotalMinor: row.subtotalMinor.toString(),
    vatMinor: row.vatMinor.toString(),
    totalMinor: row.totalMinor.toString(),
  };
}

/**
 * E-invoice endpoints.
 *
 * Statutory basis:
 *   - Decree 123/2020/ND-CP: e-invoice issuance framework
 *   - Decree 70/2025/ND-CP: amendments
 *   - Circular 78/2021/TT-BTC: technical implementation
 *
 * All routes require authentication (AuthGuard). The service enforces
 * company-level access via currentTx().accessibleCompanies (RLS + app-layer guard).
 */
@Controller()
export class EInvoiceController {
  constructor(private readonly einvoices: EInvoiceService) {}

  /**
   * Issue an e-invoice for a posted sales invoice.
   *
   * POST /sales-invoices/:id/einvoice
   *
   * Returns 201 with the e-invoice row on success.
   * 409 if an issued e-invoice already exists (idempotency).
   * 422 if the sales invoice is not in 'posted' status.
   */
  @Post('sales-invoices/:id/einvoice')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async issue(@Param('id') salesInvoiceId: string) {
    return serialize(await this.einvoices.issueForInvoice(salesInvoiceId));
  }

  /**
   * Get an e-invoice by id.
   *
   * GET /einvoices/:id
   *
   * 404 if not found or RLS-hidden.
   */
  @Get('einvoices/:id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return serialize(await this.einvoices.get(id));
  }

  /**
   * Cancel an issued e-invoice.
   *
   * POST /einvoices/:id/cancel
   *
   * 422 if the e-invoice is not in 'issued' status.
   * Decree 123/2020/ND-CP Art. 19: cancellation must be reported to GDT.
   */
  @Post('einvoices/:id/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return serialize(await this.einvoices.cancel(id));
  }
}
