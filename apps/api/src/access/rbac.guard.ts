import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { currentTx } from '../db/tx-context.js';

/**
 * Authentication guard. Runs AFTER TxMiddleware (Nest order: middleware → guards),
 * so `currentTx()` is populated from the resolved session. Fails closed: any
 * request without a userId is rejected 401.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(): boolean {
    if (!currentTx().userId) throw new UnauthorizedException();
    return true;
  }
}

/**
 * Authorization guard for admin-only routes. 401 if unauthenticated, 403 if
 * authenticated but not an admin.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(): boolean {
    const tx = currentTx();
    if (!tx.userId) throw new UnauthorizedException();
    if (!tx.isAdmin) throw new ForbiddenException('admin only');
    return true;
  }
}
