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
import { PartnersService } from './partners.service.js';

const CreatePartnerSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1),
  taxCode: z.string().trim().max(20).optional(),
  partnerType: z.enum(['customer', 'vendor', 'both']).optional(),
  address: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(30).optional(),
});

@Controller()
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  /**
   * Create a business partner scoped to a company.
   * RLS WITH CHECK ensures the authenticated user has access to :id; the service
   * adds a friendly 403 app-layer check before the DB write.
   */
  @Post('companies/:id/partners')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  create(@Param('id') companyId: string, @Body() body: unknown) {
    const result = CreatePartnerSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.partners.create(companyId, result.data);
  }

  /** List all partners for a company — RLS-filtered to accessible companies. */
  @Get('companies/:id/partners')
  @UseGuards(AuthGuard)
  list(@Param('id') companyId: string) {
    return this.partners.list(companyId);
  }

  /** Get a single partner by its own id — 404 if not found or RLS-hidden. */
  @Get('partners/:id')
  @UseGuards(AuthGuard)
  get(@Param('id') id: string) {
    return this.partners.get(id);
  }
}
