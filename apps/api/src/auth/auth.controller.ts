import {
  Controller,
  Post,
  Req,
  Res,
  Body,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service.js';

const BootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  ownerName: z.string().min(1),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('bootstrap')
  @HttpCode(201)
  async bootstrap(@Body() body: unknown): Promise<{ ok: true }> {
    const result = BootstrapSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    const { email, password, displayName, ownerName } = result.data;
    await this.authService.bootstrap(email, password, displayName, ownerName);
    return { ok: true };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const result = LoginSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    const { email, password } = result.data;
    const token = await this.authService.login(email, password);
    res.cookie('sid', token, {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE !== 'false',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (req as any).cookies?.['sid'] as string | undefined;
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie('sid');
    return { ok: true };
  }
}
