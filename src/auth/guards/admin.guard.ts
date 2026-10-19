import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthPrincipal } from '../../users/user.types';

/**
 * Restricts a route to admin accounts. Must run after JwtAuthGuard, which is
 * responsible for populating `request.user`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthPrincipal }>();

    if (request.user?.role !== 'admin') {
      throw new ForbiddenException('Administrator access required.');
    }
    return true;
  }
}
