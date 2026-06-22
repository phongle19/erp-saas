import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, AdminGuard } from '../access/rbac.guard.js';
import { GroupsService } from './groups.service.js';

const CreateGroupSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['STATUTORY', 'MANAGEMENT']),
  reportingCurrency: z.string().min(1),
});

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @UseGuards(AuthGuard)
  list() {
    return this.groups.list();
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  create(@Body() body: unknown) {
    const result = CreateGroupSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.groups.create(result.data);
  }
}
