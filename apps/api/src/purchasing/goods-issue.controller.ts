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
  GoodsIssueService,
  type GoodsIssueWithLines,
} from './goods-issue.service.js';

/**
 * Serialize a goods issue + lines for the wire: bigint minor amounts → strings
 * (JSON has no bigint), everything else passes through.
 */
function serialize(issue: GoodsIssueWithLines) {
  return {
    ...issue,
    totalCostMinor: issue.totalCostMinor.toString(),
    lines: issue.lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
      costMinor: l.costMinor.toString(),
    })),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INT_STRING = /^\d+$/;

const CreateGoodsIssueSchema = z.object({
  issueDate: z.string().regex(ISO_DATE, "issueDate must be 'YYYY-MM-DD'"),
  periodId: z.string().uuid(),
  reason: z.enum(['sale', 'consumption', 'adjustment']).optional(),
  description: z.string().trim().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().uuid(),
        quantity: z
          .string()
          .regex(INT_STRING, 'quantity must be a positive integer string')
          .refine((v) => BigInt(v) > 0n, 'quantity must be > 0'),
      }),
    )
    .min(1),
});

@Controller()
export class GoodsIssueController {
  constructor(private readonly issues: GoodsIssueService) {}

  /** Create and post a goods issue (COGS at weighted-average cost) — Phase 2b. */
  @Post('companies/:id/goods-issues')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async create(@Param('id') companyId: string, @Body() body: unknown) {
    const result = CreateGoodsIssueSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return serialize(await this.issues.createAndPost(companyId, result.data));
  }

  /** Get a single goods issue by id — 404 if not found / RLS-hidden. */
  @Get('goods-issues/:id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    return serialize(await this.issues.get(id));
  }

  /** Cancel a posted goods issue: reverses the GL entry + restores inventory. */
  @Post('goods-issues/:id/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return serialize(await this.issues.cancel(id));
  }
}
