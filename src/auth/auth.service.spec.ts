import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRecord } from '../users/user.types';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  const passwordHash = bcrypt.hashSync('correct-password', 4);

  const approvedUser: UserRecord = {
    id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    passwordHash,
    role: 'user',
    status: 'approved',
    credits: 5,
    creditLimit: 10,
    createdAt: '2026-07-01T00:00:00.000Z',
  };

  beforeEach(() => {
    usersService = {
      register: jest.fn(),
      findByEmail: jest.fn(),
      createGuest: jest.fn(),
      getBalance: jest
        .fn()
        .mockReturnValue({ credits: 5, creditLimit: 10, unlimited: false }),
    } as unknown as jest.Mocked<UsersService>;

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
    } as unknown as jest.Mocked<JwtService>;

    service = new AuthService(usersService, jwtService);
  });

  describe('register', () => {
    it('should hash the password before storing the user', async () => {
      usersService.register.mockImplementation((email, name, hash) => ({
        id: 'new-user',
        email,
        name,
        role: 'user',
        status: 'pending',
        credits: 0,
        creditLimit: 0,
        createdAt: new Date().toISOString(),
      }));

      await service.register('ada@example.com', 'Ada', 'plain-password');

      const storedHash = usersService.register.mock.calls[0][2];
      expect(storedHash).not.toBe('plain-password');
      expect(bcrypt.compareSync('plain-password', storedHash)).toBe(true);
    });
  });

  describe('login', () => {
    it('should return a session for an approved user with valid credentials', async () => {
      usersService.findByEmail.mockReturnValue(approvedUser);

      const session = await service.login('ada@example.com', 'correct-password');

      expect(session.token).toBe('signed-token');
      expect(session.user).toMatchObject({
        id: 'user-1',
        role: 'user',
        credits: 5,
        creditLimit: 10,
        unlimited: false,
      });
    });

    it('should reject an unknown email', async () => {
      usersService.findByEmail.mockReturnValue(undefined);

      await expect(service.login('ghost@example.com', 'x')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject a wrong password', async () => {
      usersService.findByEmail.mockReturnValue(approvedUser);

      await expect(
        service.login('ada@example.com', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should block accounts still awaiting admin approval', async () => {
      usersService.findByEmail.mockReturnValue({
        ...approvedUser,
        status: 'pending',
      });

      await expect(
        service.login('ada@example.com', 'correct-password'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should block rejected accounts', async () => {
      usersService.findByEmail.mockReturnValue({
        ...approvedUser,
        status: 'rejected',
      });

      await expect(
        service.login('ada@example.com', 'correct-password'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('loginAsGuest', () => {
    it('should create a guest session with the configured allowance', async () => {
      usersService.createGuest.mockReturnValue({
        id: 'guest-1',
        credits: 3,
        creditLimit: 3,
        createdAt: new Date().toISOString(),
      });
      usersService.getBalance.mockReturnValue({
        credits: 3,
        creditLimit: 3,
        unlimited: false,
      });

      const session = await service.loginAsGuest();

      expect(session.token).toBe('signed-token');
      expect(session.user).toMatchObject({
        id: 'guest-1',
        role: 'guest',
        credits: 3,
        creditLimit: 3,
      });
    });
  });

  describe('me', () => {
    it('should report admins as unlimited', () => {
      usersService.getBalance.mockReturnValue({
        credits: null,
        creditLimit: null,
        unlimited: true,
      });

      const profile = service.me({
        sub: 'admin-1',
        role: 'admin',
        name: 'Administrator',
      });

      expect(profile.unlimited).toBe(true);
      expect(profile.credits).toBeNull();
    });
  });
});
