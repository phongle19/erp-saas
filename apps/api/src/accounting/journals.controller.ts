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
  PostingEngineService,
  type EntryWithLines,
} from './posting-engine.service.js';

/** Minor-unit amount: a non-negative integer string (we keep bigints as strings on the wire). */
const minorStr = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer string');

const PostLineSchema = z.object({
  accountCode: z.string().min(1),
  debitMinor: minorStr,
  creditMinor: minorStr,
  memo: z.string().optional(),
});

const PostInputSchema = z.object({
  companyId: z.string().uuid(),
  periodId: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'entryDate must be YYYY-MM-DD'),
  description: z.string().min(1),
  lines: z.array(PostLineSchema).min(1),
});

const ReverseSchema = z
  .object({
    periodId: z.string().uuid().optional(),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .optional();

/**
 * Serialize an entry+lines for the wire: bigint minor amounts become strings
 * (JSON has no bigint), everything else passes through.
 */
function serialize(e: EntryWithLines) {
  return {
    ...e,
    lines: e.lines.map((l) => ({
      ...l,
      debitMinor: l.debitMinor.toString(),
      creditMinor: l.creditMinor.toString(),
    })),
  };
}

@Controller('journal-entries')
export class JournalsController {
  constructor(private readonly engine: PostingEngineService) {}

  /** POST /journal-entries — post a balanced entry (draft->posted). */
  @Post()
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async post(@Body() body: unknown) {
    const parsed = PostInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const entry = await this.engine.post(parsed.data);
    return serialize(entry);
  }

  /** POST /journal-entries/:id/reverse — create the reversing entry. */
  @Post(':id/reverse')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async reverse(@Param('id') id: string, @Body() body: unknown) {
    const parsed = ReverseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const entry = await this.engine.reverse(id, parsed.data);
    return serialize(entry);
  }

  /** GET /journal-entries/:id — entry + lines (RLS-scoped). */
  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@Param('id') id: string) {
    const entry = await this.engine.get(id);
    return serialize(entry);
  }
}
