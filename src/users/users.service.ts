import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { readJsonSafe, writeJsonAtomic } from '../core/json-store';
import {
  AppSettings,
  AuthPrincipal,
  GuestRecord,
  PublicUser,
  UserRecord,
  toPublicUser,
} from './user.types';

/** Thrown by charge() and surfaced as 402 Payment Required by controllers. */
export class InsufficientCreditsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient credits: this run costs ${required} credit(s) but only ${available} remain.`,
    );
  }
}

const DEFAULT_GUEST_CREDIT_LIMIT = 3;

/**
 * File-backed account store (data/users.json, data/guests.json,
 * data/settings.json). Single-instance app → synchronous fs calls keep every
 * read-modify-write atomic within the Node event loop (no interleaving).
 */
@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  private readonly dataDir = path.join(process.cwd(), 'data');

  /**
   * Kill switch for the whole credit system (CREDITS_ENABLED=false). When off,
   * charge() is a no-op and every principal reports an unlimited balance, so
   * the UI drops the credit bar. Accounts, roles and the run history are
   * unaffected — runs are still recorded, with creditsCharged: 0.
   *
   * Defaults to enabled: only the exact string "false" turns billing off, so a
   * missing or misspelled variable never silently makes the pipeline free.
   */
  private readonly creditsEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.creditsEnabled =
      this.configService.get<string>('CREDITS_ENABLED') !== 'false';
  }

  onModuleInit(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.seedAdmin();
    if (!this.creditsEnabled) {
      this.logger.warn(
        'CREDITS_ENABLED=false — credit billing is disabled. Runs are free and every account reports an unlimited balance.',
      );
    }
  }

  /* ------------------------------ persistence ----------------------------- */

  private readJson<T>(fileName: string, fallback: T): T {
    return readJsonSafe<T>(path.join(this.dataDir, fileName), fallback);
  }

  // Atomic: these files hold account state and credit balances, so a crash
  // mid-write must never truncate them. See src/core/json-store.ts.
  private writeJson(fileName: string, value: unknown): void {
    writeJsonAtomic(path.join(this.dataDir, fileName), value);
  }

  private loadUsers(): UserRecord[] {
    return this.readJson<UserRecord[]>('users.json', []);
  }

  private saveUsers(users: UserRecord[]): void {
    this.writeJson('users.json', users);
  }

  private loadGuests(): GuestRecord[] {
    return this.readJson<GuestRecord[]>('guests.json', []);
  }

  private saveGuests(guests: GuestRecord[]): void {
    this.writeJson('guests.json', guests);
  }

  /* ------------------------------- bootstrap ------------------------------ */

  /**
   * Guarantees an admin account exists. Credentials come from ADMIN_EMAIL /
   * ADMIN_PASSWORD; safe defaults are logged so a fresh clone is usable.
   */
  private seedAdmin(): void {
    const users = this.loadUsers();
    if (users.some((u) => u.role === 'admin')) return;

    const email =
      this.configService.get<string>('ADMIN_EMAIL') || 'admin@linterflow.local';
    const password =
      this.configService.get<string>('ADMIN_PASSWORD') || 'admin-change-me';

    users.push({
      id: randomUUID(),
      email,
      name: 'Administrator',
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin',
      status: 'approved',
      credits: 0,
      creditLimit: 0,
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
    });
    this.saveUsers(users);
    this.logger.warn(
      `Seeded admin account "${email}". Set ADMIN_EMAIL / ADMIN_PASSWORD in .env to override the defaults.`,
    );
  }

  /* --------------------------------- users -------------------------------- */

  public findByEmail(email: string): UserRecord | undefined {
    return this.loadUsers().find(
      (u) => u.email.toLowerCase() === email.toLowerCase(),
    );
  }

  public findById(id: string): UserRecord | undefined {
    return this.loadUsers().find((u) => u.id === id);
  }

  /** Creates a new account in "pending" state, awaiting admin approval. */
  public register(email: string, name: string, passwordHash: string): PublicUser {
    if (this.findByEmail(email)) {
      throw new ConflictException('An account with this email already exists.');
    }
    const users = this.loadUsers();
    const user: UserRecord = {
      id: randomUUID(),
      email,
      name,
      passwordHash,
      role: 'user',
      status: 'pending',
      credits: 0,
      creditLimit: 0,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    this.saveUsers(users);
    return toPublicUser(user);
  }

  public listUsers(): PublicUser[] {
    return this.loadUsers().map(toPublicUser);
  }

  /** Approves a pending user and grants their initial credit allowance. */
  public approve(id: string, credits: number): PublicUser {
    return this.updateUser(id, (user) => {
      user.status = 'approved';
      user.credits = credits;
      user.creditLimit = credits;
      user.approvedAt = new Date().toISOString();
    });
  }

  public reject(id: string): PublicUser {
    return this.updateUser(id, (user) => {
      user.status = 'rejected';
    });
  }

  /** Sets the remaining balance (and raises the limit if needed for the UI). */
  public setCredits(id: string, credits: number): PublicUser {
    return this.updateUser(id, (user) => {
      user.credits = credits;
      user.creditLimit = Math.max(user.creditLimit, credits);
    });
  }

  private updateUser(
    id: string,
    mutate: (user: UserRecord) => void,
  ): PublicUser {
    const users = this.loadUsers();
    const user = users.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found.`);
    mutate(user);
    this.saveUsers(users);
    return toPublicUser(user);
  }

  /* -------------------------------- guests -------------------------------- */

  /** Starts an anonymous try-on session with the configured credit limit. */
  public createGuest(): GuestRecord {
    const limit = this.getSettings().guestCreditLimit;
    const guest: GuestRecord = {
      id: randomUUID(),
      credits: limit,
      creditLimit: limit,
      createdAt: new Date().toISOString(),
    };
    const guests = this.loadGuests();
    guests.push(guest);
    this.saveGuests(guests);
    return guest;
  }

  public findGuest(id: string): GuestRecord | undefined {
    return this.loadGuests().find((g) => g.id === id);
  }

  /* ------------------------------- settings ------------------------------- */

  public getSettings(): AppSettings {
    return this.readJson<AppSettings>('settings.json', {
      guestCreditLimit: DEFAULT_GUEST_CREDIT_LIMIT,
    });
  }

  public updateSettings(patch: Partial<AppSettings>): AppSettings {
    const settings = { ...this.getSettings(), ...patch };
    this.writeJson('settings.json', settings);
    return settings;
  }

  /* ------------------------------- billing -------------------------------- */

  /**
   * Returns the balance for any principal. Admins — and everyone, when
   * billing is disabled — are unlimited and report `credits: null` so the UI
   * can render "∞".
   */
  public getBalance(principal: AuthPrincipal): {
    credits: number | null;
    creditLimit: number | null;
    unlimited: boolean;
  } {
    if (!this.creditsEnabled || principal.role === 'admin') {
      return { credits: null, creditLimit: null, unlimited: true };
    }
    if (principal.role === 'guest') {
      const guest = this.findGuest(principal.sub);
      if (!guest) throw new NotFoundException('Guest session not found.');
      return {
        credits: guest.credits,
        creditLimit: guest.creditLimit,
        unlimited: false,
      };
    }
    const user = this.findById(principal.sub);
    if (!user) throw new NotFoundException('User not found.');
    return { credits: user.credits, creditLimit: user.creditLimit, unlimited: false };
  }

  /**
   * Deducts `amount` credits from the principal's balance (upfront charging).
   * Admins are never charged, and nobody is charged while CREDITS_ENABLED is
   * false. Throws InsufficientCreditsError when the balance does not cover
   * the cost.
   */
  public charge(
    principal: AuthPrincipal,
    amount: number,
  ): { charged: number; remaining: number | null } {
    if (!this.creditsEnabled || principal.role === 'admin') {
      return { charged: 0, remaining: null };
    }

    if (principal.role === 'guest') {
      const guests = this.loadGuests();
      const guest = guests.find((g) => g.id === principal.sub);
      if (!guest) throw new NotFoundException('Guest session not found.');
      if (guest.credits < amount) {
        throw new InsufficientCreditsError(amount, guest.credits);
      }
      guest.credits -= amount;
      this.saveGuests(guests);
      return { charged: amount, remaining: guest.credits };
    }

    const users = this.loadUsers();
    const user = users.find((u) => u.id === principal.sub);
    if (!user) throw new NotFoundException('User not found.');
    if (user.credits < amount) {
      throw new InsufficientCreditsError(amount, user.credits);
    }
    user.credits -= amount;
    this.saveUsers(users);
    return { charged: amount, remaining: user.credits };
  }
}
