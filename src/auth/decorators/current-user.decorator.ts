import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthPrincipal } from '../../users/user.types';

/** Injects the JWT payload attached by JwtAuthGuard into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest();
    return request.user as AuthPrincipal;
  },
);
