import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../access/rbac.guard.js';
import {
  SalesInvoiceService,
  type InvoiceWithLines,
} from './sales-invoice.service.js';

/**
 * Serialize an invoice + lines for the wire: bigint minor amounts become
 * strings (JSON has no bigint), everything else passes through. Mirrors the
 * journals controller convention.
 */
function serialize(inv: InvoiceWithLines) {
  return {
    ...inv,
    subtotalMinor: inv.subtotalMinor.toString(),
    vatMinor: inv.vatMinor.toString(),
    totalMinor: inv.totalMinor.toString(),
    lines: inv.lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
      unitPriceMinor: l.unitPriceMinor.toString(),
      lineNetMinor: l.lineNetMinor.toString(),
      vatMinor: l.vatMinor.toString(),
    })),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INT_STRING = /^\d+$/;
const VAT_RULE_TYPES = [
  'vat_rate',
  'vat_rate_reduced',
  'vat_rate_5',
  'vat_zero',
  'vat_exempt',
] as const;

const CreateSalesInvoiceSchema = z.object({
  partnerId: z.string().uuid(),
  invoiceDate: z.string().regex(ISO_DATE, "invoiceDate must be 'YYYY-MM-DD'"),
  periodId: z.string().uuid(),
  description: z.string().trim().optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        quantity: z.string().regex(INT_STRING, 'quantity must be an integer string'),
        unitPriceMinor: z
          .string()
          .regex(INT_STRING, 'unitPriceMinor must be an integer string'),
        vatRuleType: z.enum(VAT_RULE_TYPES),
        revenueAccountCode: z.string().trim().min(1).optional(),
      }),
    )
    .min(1),
});

@Controller()
export class SalesInvoiceController {
  constructor(private readonly invoices: SalesInvoiceService) {}

  /** Create and post a sales invoice for a company (Phase 2a posts immediately). */
  @Post('companies/:id/sales-invoices')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async create(@Param('id') companyId: string, @Body() body: unknown) {
    const result = CreateSalesInvoiceSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return serialize(await this.invoices.createAndPost(companyId, result.data));
  }

  /** Get a single invoice by id — 404 if not found / RLS-hidden. */
  @Get('sales-invoices/:id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return serialize(await this.invoices.get(id));
  }

  /** Cancel a posted invoice: reverses the journal entry, nets AR back. */
  @Post('sales-invoices/:id/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return serialize(await this.invoices.cancel(id));
  }
}
