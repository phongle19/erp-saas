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
import { AuthGuard, AdminGuard } from '../access/rbac.guard.js';
import { CompaniesService } from './companies.service.js';

const CreateCompanySchema = z.object({
  name: z.string().min(1),
  mst: z.string().min(1).optional(),
  regime: z.enum(['circular_133', 'circular_88', 'circular_132', 'circular_200']),
  functionalCurrency: z.string().min(1),
  householdTier: z.enum(['lt_200m', '200m_1b', 'gt_1b', 'gt_3b']).optional(),
});

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @UseGuards(AuthGuard)
  list() {
    return this.companies.list();
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  get(@Param('id') id: string) {
    return this.companies.get(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  create(@Body() body: unknown) {
    const result = CreateCompanySchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.companies.create(result.data);
  }
}
