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
import { MaterialsService } from './materials.service.js';

const CreateMaterialSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1).max(50).optional(),
  inventoryAccountCode: z.string().trim().min(1).max(20).optional(),
});

@Controller()
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  /**
   * Create a material (inventory item) scoped to a company.
   * RLS WITH CHECK ensures the authenticated user has access to :id; the service
   * adds a friendly 403 app-layer check before the DB write.
   */
  @Post('companies/:id/materials')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  create(@Param('id') companyId: string, @Body() body: unknown) {
    const result = CreateMaterialSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.materials.create(companyId, result.data);
  }

  /** List all materials for a company — RLS-filtered to accessible companies. */
  @Get('companies/:id/materials')
  @UseGuards(AuthGuard)
  list(@Param('id') companyId: string) {
    return this.materials.list(companyId);
  }

  /** Get a single material by its own id — 404 if not found or RLS-hidden. */
  @Get('materials/:id')
  @UseGuards(AuthGuard)
  get(@Param('id') id: string) {
    return this.materials.get(id);
  }
}
