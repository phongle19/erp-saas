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
  PurchaseInvoiceService,
  type PurchaseInvoiceWithLines,
} from './purchase-invoice.service.js';

/**
 * Serialize a purchase invoice + lines for the wire: bigint minor amounts become
 * strings (JSON has no bigint), everything else passes through.
 */
function serialize(inv: PurchaseInvoiceWithLines) {
  return {
    ...inv,
    subtotalMinor: inv.subtotalMinor.toString(),
    vatMinor: inv.vatMinor.toString(),
    totalMinor: inv.totalMinor.toString(),
    lines: inv.lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
      unitCostMinor: l.unitCostMinor.toString(),
      lineCostMinor: l.lineCostMinor.toString(),
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

const CreatePurchaseInvoiceSchema = z.object({
  partnerId: z.string().uuid(),
  invoiceDate: z.string().regex(ISO_DATE, "invoiceDate must be 'YYYY-MM-DD'"),
  periodId: z.string().uuid(),
  vendorInvoiceNo: z.string().trim().min(1).optional(),
  nonCashPayment: z.boolean().optional(),
  description: z.string().trim().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        quantity: z
          .string()
          .regex(INT_STRING, 'quantity must be an integer string'),
        unitCostMinor: z
          .string()
          .regex(INT_STRING, 'unitCostMinor must be an integer string'),
        vatRuleType: z.enum(VAT_RULE_TYPES),
      }),
    )
    .min(1),
});

@Controller()
export class PurchaseInvoiceController {
  constructor(private readonly invoices: PurchaseInvoiceService) {}

  /** Create and post a purchase invoice for a company (Phase 2b posts immediately). */
  @Post('companies/:id/purchase-invoices')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async create(@Param('id') companyId: string, @Body() body: unknown) {
    const result = CreatePurchaseInvoiceSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return serialize(await this.invoices.createAndPost(companyId, result.data));
  }

  /** Get a single purchase invoice by id — 404 if not found / RLS-hidden. */
  @Get('purchase-invoices/:id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return serialize(await this.invoices.get(id));
  }

  /** Cancel a posted purchase invoice: reverses the journal entry + inventory. */
  @Post('purchase-invoices/:id/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return serialize(await this.invoices.cancel(id));
  }
}
