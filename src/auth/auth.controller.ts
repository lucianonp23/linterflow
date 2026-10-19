import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthPrincipal } from '../users/user.types';

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/register
   * Creates a pending account; an admin must approve it (and set its credit
   * allowance) before the user can log in.
   */
  @Post('register')
  @ApiOperation({ summary: 'Register a new account (pending admin approval)' })
  public async register(@Body() dto: RegisterDto) {
    const user = await this.authService.register(dto.email, dto.name, dto.password);
    return {
      status: 'PENDING_APPROVAL',
      message:
        'Registration received. An administrator must approve your account before you can log in.',
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  /** POST /api/auth/login — email + password of an approved account. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with an approved account' })
  public login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * POST /api/auth/guest
   * Starts an anonymous try-on session limited to the guest credit allowance
   * configured in the admin panel.
   */
  @Post('guest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a limited guest (try-on) session' })
  public loginAsGuest() {
    return this.authService.loginAsGuest();
  }

  /** GET /api/auth/me — fresh profile and credit balance for the token. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current profile and credit balance' })
  public me(@CurrentUser() principal: AuthPrincipal) {
    return this.authService.me(principal);
  }
}
