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
import { VendorPaymentService } from './vendor-payment.service.js';
import type { schema } from '@erp/db';

type VendorPayment = typeof schema.vendorPayments.$inferSelect;

/**
 * Serialize a vendor payment for the wire: bigint amountMinor becomes a
 * string (JSON has no bigint). Mirrors the receipts controller convention.
 *
 * The global audit interceptor persists the controller's return value into a
 * jsonb column — bigint cannot be JSON-stringified so we must convert here.
 */
function serialize(payment: VendorPayment) {
  return {
    ...payment,
    amountMinor: payment.amountMinor.toString(),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POS_INT_STRING = /^[1-9]\d*$/;

const CreateVendorPaymentSchema = z.object({
  partnerId: z.string().uuid(),
  paymentDate: z.string().regex(ISO_DATE, "paymentDate must be 'YYYY-MM-DD'"),
  periodId: z.string().uuid(),
  amountMinor: z
    .string()
    .regex(POS_INT_STRING, 'amountMinor must be a positive integer string'),
  settlementAccountCode: z.enum(['111', '112']),
  description: z.string().trim().optional(),
});

@Controller()
export class VendorPaymentController {
  constructor(private readonly vendorPayments: VendorPaymentService) {}

  /** Create and post a vendor payment for a company (Phase 2b B8 — posts immediately). */
  @Post('companies/:id/vendor-payments')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async create(@Param('id') companyId: string, @Body() body: unknown) {
    const result = CreateVendorPaymentSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return serialize(await this.vendorPayments.createAndPost(companyId, result.data));
  }

  /** Get a single vendor payment by id — 404 if not found / RLS-hidden. */
  @Get('vendor-payments/:id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return serialize(await this.vendorPayments.get(id));
  }

  /** Cancel a posted vendor payment: reverses the journal entry, nets AP back up. */
  @Post('vendor-payments/:id/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return serialize(await this.vendorPayments.cancel(id));
  }
}
