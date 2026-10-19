import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InsufficientCreditsError, UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let tmpDir: string;

  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  beforeEach(() => {
    // Point the file-backed store at an isolated temp directory per test.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linterflow-users-'));
    jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    service = new UsersService(configService);
    service.onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should seed a default admin account on init', () => {
    const users = service.listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ role: 'admin', status: 'approved' });
  });

  describe('registration and approval flow', () => {
    it('should create new accounts as pending with zero credits', () => {
      const user = service.register('ada@example.com', 'Ada', 'hash');
      expect(user).toMatchObject({
        role: 'user',
        status: 'pending',
        credits: 0,
      });
    });

    it('should reject duplicate emails (case-insensitive)', () => {
      service.register('ada@example.com', 'Ada', 'hash');
      expect(() => service.register('ADA@example.com', 'Ada 2', 'hash')).toThrow(
        ConflictException,
      );
    });

    it('should grant the credit allowance on approval', () => {
      const pending = service.register('ada@example.com', 'Ada', 'hash');
      const approved = service.approve(pending.id, 10);
      expect(approved).toMatchObject({
        status: 'approved',
        credits: 10,
        creditLimit: 10,
      });
    });
  });

  describe('charging', () => {
    it('should deduct credits from an approved user', () => {
      const user = service.register('ada@example.com', 'Ada', 'hash');
      service.approve(user.id, 10);

      const result = service.charge({ sub: user.id, role: 'user' }, 3);

      expect(result).toEqual({ charged: 3, remaining: 7 });
      expect(service.findById(user.id)?.credits).toBe(7);
    });

    it('should refuse a charge that exceeds the balance', () => {
      const user = service.register('ada@example.com', 'Ada', 'hash');
      service.approve(user.id, 2);

      expect(() => service.charge({ sub: user.id, role: 'user' }, 3)).toThrow(
        InsufficientCreditsError,
      );
      // Balance must stay untouched after a refused charge.
      expect(service.findById(user.id)?.credits).toBe(2);
    });

    it('should never charge admins', () => {
      const admin = service.listUsers()[0];
      const result = service.charge({ sub: admin.id, role: 'admin' }, 99);
      expect(result).toEqual({ charged: 0, remaining: null });
    });
  });

  describe('CREDITS_ENABLED kill switch', () => {
    /** Builds a service whose ConfigService returns `value` for CREDITS_ENABLED. */
    function serviceWithFlag(value: string | undefined): UsersService {
      const config = {
        get: jest.fn((key: string) =>
          key === 'CREDITS_ENABLED' ? value : undefined,
        ),
      } as unknown as ConfigService;
      const instance = new UsersService(config);
      instance.onModuleInit();
      return instance;
    }

    it('should skip charging entirely when disabled', () => {
      const disabled = serviceWithFlag('false');
      const user = disabled.register('ada@example.com', 'Ada', 'hash');
      disabled.approve(user.id, 2);

      // A charge well past the balance must succeed and deduct nothing.
      const result = disabled.charge({ sub: user.id, role: 'user' }, 99);

      expect(result).toEqual({ charged: 0, remaining: null });
      expect(disabled.findById(user.id)?.credits).toBe(2);
    });

    it('should report every principal as unlimited when disabled', () => {
      const disabled = serviceWithFlag('false');
      const user = disabled.register('ada@example.com', 'Ada', 'hash');
      disabled.approve(user.id, 10);

      expect(disabled.getBalance({ sub: user.id, role: 'user' })).toEqual({
        credits: null,
        creditLimit: null,
        unlimited: true,
      });
    });

    it('should keep billing on when the flag is absent or not exactly "false"', () => {
      for (const value of [undefined, 'true', 'FALSE', '0']) {
        const enabled = serviceWithFlag(value);
        // Every iteration shares the temp store, so emails must differ.
        const user = enabled.register(
          `ada-${value}@example.com`,
          'Ada',
          'hash',
        );
        enabled.approve(user.id, 2);

        expect(() => enabled.charge({ sub: user.id, role: 'user' }, 3)).toThrow(
          InsufficientCreditsError,
        );
      }
    });
  });

  describe('guest sessions', () => {
    it('should grant the configured guest credit limit', () => {
      service.updateSettings({ guestCreditLimit: 5 });
      const guest = service.createGuest();
      expect(guest.credits).toBe(5);
      expect(guest.creditLimit).toBe(5);
    });

    it('should charge guests independently of users', () => {
      const guest = service.createGuest();
      const result = service.charge({ sub: guest.id, role: 'guest' }, 1);
      expect(result.remaining).toBe(guest.creditLimit - 1);
    });

    it('should apply an updated limit only to new guest sessions', () => {
      const before = service.createGuest();
      service.updateSettings({ guestCreditLimit: 9 });
      const after = service.createGuest();

      expect(service.findGuest(before.id)?.creditLimit).toBe(before.creditLimit);
      expect(after.creditLimit).toBe(9);
    });
  });
});
