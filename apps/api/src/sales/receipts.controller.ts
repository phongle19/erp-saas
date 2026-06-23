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
import { ReceiptsService } from './receipts.service.js';
import type { schema } from '@erp/db';

type Receipt = typeof schema.customerReceipts.$inferSelect;

/**
 * Serialize a customer receipt for the wire: bigint amountMinor becomes a
 * string (JSON has no bigint). Mirrors the sales-invoice controller convention.
 *
 * The global audit interceptor persists the controller's return value into a
 * jsonb column — bigint cannot be JSON-stringified so we must convert here.
 */
function serialize(receipt: Receipt) {
  return {
    ...receipt,
    amountMinor: receipt.amountMinor.toString(),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POS_INT_STRING = /^[1-9]\d*$/;

const CreateReceiptSchema = z.object({
  partnerId: z.string().uuid(),
  receiptDate: z.string().regex(ISO_DATE, "receiptDate must be 'YYYY-MM-DD'"),
  periodId: z.string().uuid(),
  amountMinor: z
    .string()
    .regex(POS_INT_STRING, 'amountMinor must be a positive integer string'),
  settlementAccountCode: z.enum(['111', '112']),
  description: z.string().trim().optional(),
});

@Controller()
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  /** Create and post a customer receipt for a company (Phase 2a A6 — posts immediately). */
  @Post('companies/:id/customer-receipts')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async create(@Param('id') companyId: string, @Body() body: unknown) {
    const result = CreateReceiptSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return serialize(await this.receipts.createAndPost(companyId, result.data));
  }

  /** Get a single customer receipt by id — 404 if not found / RLS-hidden. */
  @Get('customer-receipts/:id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return serialize(await this.receipts.get(id));
  }

  /** Cancel a posted receipt: reverses the journal entry, nets AR back up. */
  @Post('customer-receipts/:id/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return serialize(await this.receipts.cancel(id));
  }
}
