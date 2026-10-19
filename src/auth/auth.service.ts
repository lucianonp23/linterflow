import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { AuthPrincipal, PublicUser } from '../users/user.types';

export interface AuthSession {
  token: string;
  user: {
    id: string;
    role: AuthPrincipal['role'];
    name: string;
    email?: string;
    credits: number | null;
    creditLimit: number | null;
    unlimited: boolean;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /** Creates a pending account. The user can only log in after admin approval. */
  public async register(
    email: string,
    name: string,
    password: string,
  ): Promise<PublicUser> {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.usersService.register(email, name, passwordHash);
  }

  public async login(email: string, password: string): Promise<AuthSession> {
    const user = this.usersService.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (user.status === 'pending') {
      throw new ForbiddenException(
        'Your account is awaiting administrator approval.',
      );
    }
    if (user.status === 'rejected') {
      throw new ForbiddenException('Your registration was rejected.');
    }

    return this.buildSession({
      sub: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    });
  }

  /** Anonymous try-on session, limited by the admin-configured guest credits. */
  public async loginAsGuest(): Promise<AuthSession> {
    const guest = this.usersService.createGuest();
    return this.buildSession({ sub: guest.id, role: 'guest', name: 'Guest' });
  }

  /** Fresh profile + balance for the authenticated principal. */
  public me(principal: AuthPrincipal): AuthSession['user'] {
    const balance = this.usersService.getBalance(principal);
    return {
      id: principal.sub,
      role: principal.role,
      name: principal.name ?? 'Guest',
      email: principal.email,
      ...balance,
    };
  }

  private async buildSession(principal: AuthPrincipal): Promise<AuthSession> {
    const token = await this.jwtService.signAsync(principal);
    return { token, user: this.me(principal) };
  }
}
