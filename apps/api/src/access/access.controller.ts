import {
  Controller,
  Post,
  Body,
  HttpCode,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from './rbac.guard.js';
import { AccessService } from './access.service.js';

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
});

const CreateGrantSchema = z.object({
  userId: z.string().uuid(),
  companyId: z.string().uuid(),
  role: z.string().min(1),
});

@Controller()
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Post('users')
  @UseGuards(AdminGuard)
  @HttpCode(201)
  createUser(@Body() body: unknown) {
    const result = CreateUserSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.access.createUser(result.data);
  }

  @Post('company-access')
  @UseGuards(AdminGuard)
  @HttpCode(201)
  grant(@Body() body: unknown) {
    const result = CreateGrantSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return this.access.grant(result.data);
  }
}
