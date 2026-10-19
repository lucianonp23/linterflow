import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthPrincipal } from '../../users/user.types';

/**
 * Validates the `Authorization: Bearer <jwt>` header and attaches the decoded
 * payload to `request.user`. Accepts every role (admin, user and guest) —
 * role-specific restrictions are layered on top via AdminGuard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthPrincipal }>();

    const authHeader = request.headers.authorization ?? '';
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing authentication token.');
    }

    try {
      request.user = await this.jwtService.verifyAsync<AuthPrincipal>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired authentication token.');
    }
    return true;
  }
}
