import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
  CLOSED = 'CLOSED',
}

export enum LoyaltyTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
}

export interface LoyaltyAccount {
  id: string;
  customerId: string;
  balance: number;
  lifetimePoints: number;
  status: AccountStatus;
  tier: LoyaltyTier;
  dailyRedeemedAmount: number;
  dailyRedemptionLimit: number;
  lastRedemptionDate: Date | null;
  lastActivityDate: Date;
  createdAt: Date;
}

export interface CreateAccountDto {
  customerId: string;
  dailyRedemptionLimit?: number;
}

export interface TransactionResult {
  accountId: string;
  transactedPoints: number;
  newBalance: number;
  tier: LoyaltyTier;
  status: AccountStatus;
}

const MIN_INITIAL_DAILY_REDEMPTION_LIMIT = 500;
const DEFAULT_DAILY_REDEMPTION_LIMIT = 5000;
const MAX_ACCOUNT_BALANCE = 1_000_000;
const MIN_REDEMPTION_POINTS = 100;
const MAX_INACTIVITY_DAYS = 180;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const TIER_THRESHOLDS = [
  { threshold: 100_000, tier: LoyaltyTier.PLATINUM },
  { threshold: 50_000, tier: LoyaltyTier.GOLD },
  { threshold: 10_000, tier: LoyaltyTier.SILVER },
] as const;

@Injectable()
export class LoyaltyRepository {
  private readonly accounts: Map<string, LoyaltyAccount> = new Map();

  async create(dto: CreateAccountDto): Promise<LoyaltyAccount> {
    this.validateCustomerForCreation(dto.customerId);
    this.validateDailyRedemptionLimit(dto.dailyRedemptionLimit);

    const now = new Date();
    const newAccount: LoyaltyAccount = {
      id: randomUUID(),
      customerId: dto.customerId,
      balance: 0,
      lifetimePoints: 0,
      status: AccountStatus.ACTIVE,
      tier: LoyaltyTier.BRONZE,
      dailyRedeemedAmount: 0,
      dailyRedemptionLimit: dto.dailyRedemptionLimit ?? DEFAULT_DAILY_REDEMPTION_LIMIT,
      lastRedemptionDate: null,
      lastActivityDate: now,
      createdAt: now,
    };

    this.accounts.set(newAccount.id, newAccount);
    return { ...newAccount };
  }

  async findById(id: string): Promise<LoyaltyAccount> {
    const account = this.getAccountOrThrow(id);
    return { ...account };
  }

  async findByCustomerId(customerId: string): Promise<LoyaltyAccount> {
    const account = this.findAccountByCustomerId(customerId);
    if (!account) {
      throw new NotFoundException(`Loyalty account for customer ${customerId} not found.`);
    }
    return { ...account };
  }

  async accruePoints(id: string, points: number): Promise<TransactionResult> {
    const account = this.getAccountOrThrow(id);

    if (account.status === AccountStatus.CLOSED || account.status === AccountStatus.EXPIRED) {
      throw new BadRequestException(`Cannot accrue points. Account status is ${account.status}.`);
    }

    if (points <= 0) {
      throw new BadRequestException('Accrual amount must be greater than zero.');
    }

    if (account.balance + points > MAX_ACCOUNT_BALANCE) {
      throw new BadRequestException('Accrual exceeds maximum allowable account balance of 1,000,000 points.');
    }

    account.balance += points;
    account.lifetimePoints += points;
    account.lastActivityDate = new Date();
    account.tier = this.calculateTier(account.lifetimePoints);

    this.accounts.set(account.id, account);

    return this.toTransactionResult(account, points);
  }

  async redeemPoints(id: string, points: number): Promise<TransactionResult> {
    const account = this.getAccountOrThrow(id);

    if (account.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException(`Account is not active. Current status: ${account.status}.`);
    }

    if (points <= 0) {
      throw new BadRequestException('Redemption points must be greater than zero.');
    }

    if (points < MIN_REDEMPTION_POINTS) {
      throw new BadRequestException('Minimum redemption threshold is 100 points.');
    }

    if (account.balance < points) {
      throw new BadRequestException(`Insufficient balance. Required: ${points}, Available: ${account.balance}.`);
    }

    const currentDailyTotal = this.calculateCurrentDailyTotal(account);

    if (currentDailyTotal + points > account.dailyRedemptionLimit) {
      throw new BadRequestException(`Daily redemption limit of ${account.dailyRedemptionLimit} points exceeded.`);
    }

    if (this.getDaysInactive(account.lastActivityDate) > MAX_INACTIVITY_DAYS) {
      throw new BadRequestException('Account inactive for over 180 days. Redemption locked.');
    }

    const now = new Date();
    account.balance -= points;
    account.dailyRedeemedAmount = currentDailyTotal + points;
    account.lastRedemptionDate = now;
    account.lastActivityDate = now;

    this.accounts.set(account.id, account);

    return this.toTransactionResult(account, points);
  }

  async updateStatus(id: string, status: AccountStatus): Promise<LoyaltyAccount> {
    const account = this.getAccountOrThrow(id);

    if (account.status === status) {
      throw new BadRequestException(`Account is already in status ${status}.`);
    }

    account.status = status;
    account.lastActivityDate = new Date();
    this.accounts.set(account.id, account);

    return { ...account };
  }

  async delete(id: string): Promise<void> {
    const account = this.getAccountOrThrow(id);

    if (account.balance > 0) {
      throw new BadRequestException('Cannot delete account with an active point balance.');
    }

    if (account.status !== AccountStatus.CLOSED) {
      throw new BadRequestException('Account must be closed before deletion.');
    }

    this.accounts.delete(id);
  }

  private getAccountOrThrow(id: string): LoyaltyAccount {
    const account = this.accounts.get(id);
    if (!account) {
      throw new NotFoundException(`Loyalty account ${id} not found.`);
    }
    return account;
  }

  private findAccountByCustomerId(customerId: string): LoyaltyAccount | undefined {
    return Array.from(this.accounts.values()).find((acc) => acc.customerId === customerId);
  }

  private validateCustomerForCreation(customerId: string): void {
    if (!customerId || customerId.trim().length === 0) {
      throw new BadRequestException('Customer ID must be provided.');
    }

    if (this.findAccountByCustomerId(customerId)) {
      throw new ConflictException(`Account already exists for customer: ${customerId}`);
    }
  }

  private validateDailyRedemptionLimit(limit?: number): void {
    if (limit !== undefined && limit < MIN_INITIAL_DAILY_REDEMPTION_LIMIT) {
      throw new BadRequestException('Initial daily redemption limit must be at least 500 points.');
    }
  }

  private calculateCurrentDailyTotal(account: LoyaltyAccount): number {
    const todayStr = this.formatDate(new Date());
    const lastRedeemStr = account.lastRedemptionDate ? this.formatDate(account.lastRedemptionDate) : null;
    return todayStr === lastRedeemStr ? account.dailyRedeemedAmount : 0;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private getDaysInactive(lastActivityDate: Date): number {
    return (Date.now() - lastActivityDate.getTime()) / MS_PER_DAY;
  }

  private calculateTier(lifetimePoints: number): LoyaltyTier {
    for (const { threshold, tier } of TIER_THRESHOLDS) {
      if (lifetimePoints >= threshold) {
        return tier;
      }
    }
    return LoyaltyTier.BRONZE;
  }

  private toTransactionResult(account: LoyaltyAccount, points: number): TransactionResult {
    return {
      accountId: account.id,
      transactedPoints: points,
      newBalance: account.balance,
      tier: account.tier,
      status: account.status,
    };
  }
}