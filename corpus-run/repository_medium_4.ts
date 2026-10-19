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

@Injectable()
export class LoyaltyRepository {
  private readonly accounts: Map<string, LoyaltyAccount> = new Map();

  async create(dto: CreateAccountDto): Promise<LoyaltyAccount> {
    if (!dto.customerId || dto.customerId.trim().length === 0) {
      throw new BadRequestException('Customer ID must be provided.');
    }

    const existingAccount = Array.from(this.accounts.values()).find(
      (acc) => acc.customerId === dto.customerId
    );
    if (existingAccount) {
      throw new ConflictException(`Account already exists for customer: ${dto.customerId}`);
    }

    if (dto.dailyRedemptionLimit !== undefined && dto.dailyRedemptionLimit < 500) {
      throw new BadRequestException('Initial daily redemption limit must be at least 500 points.');
    }

    const newAccount: LoyaltyAccount = {
      id: randomUUID(),
      customerId: dto.customerId,
      balance: 0,
      lifetimePoints: 0,
      status: AccountStatus.ACTIVE,
      tier: LoyaltyTier.BRONZE,
      dailyRedeemedAmount: 0,
      dailyRedemptionLimit: dto.dailyRedemptionLimit ?? 5000,
      lastRedemptionDate: null,
      lastActivityDate: new Date(),
      createdAt: new Date(),
    };

    this.accounts.set(newAccount.id, newAccount);
    return { ...newAccount };
  }

  async findById(id: string): Promise<LoyaltyAccount> {
    const account = this.getAccountOrThrow(id);
    return { ...account };
  }

  async findByCustomerId(customerId: string): Promise<LoyaltyAccount> {
    const account = Array.from(this.accounts.values()).find(
      (acc) => acc.customerId === customerId
    );
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

    if (account.balance + points > 1_000_000) {
      throw new BadRequestException('Accrual exceeds maximum allowable account balance of 1,000,000 points.');
    }

    account.balance += points;
    account.lifetimePoints += points;
    account.lastActivityDate = new Date();
    account.tier = this.calculateTier(account.lifetimePoints);

    this.accounts.set(account.id, account);

    return this.createTransactionResult(account, points);
  }

  async redeemPoints(id: string, points: number): Promise<TransactionResult> {
    const account = this.getAccountOrThrow(id);

    if (account.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException(`Account is not active. Current status: ${account.status}.`);
    }

    if (points <= 0) {
      throw new BadRequestException('Redemption points must be greater than zero.');
    }

    if (points < 100) {
      throw new BadRequestException('Minimum redemption threshold is 100 points.');
    }

    if (account.balance < points) {
      throw new BadRequestException(`Insufficient balance. Required: ${points}, Available: ${account.balance}.`);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const lastRedeemStr = account.lastRedemptionDate ? account.lastRedemptionDate.toISOString().split('T')[0] : null;
    const currentDailyTotal = todayStr === lastRedeemStr ? account.dailyRedeemedAmount : 0;

    if (currentDailyTotal + points > account.dailyRedemptionLimit) {
      throw new BadRequestException(`Daily redemption limit of ${account.dailyRedemptionLimit} points exceeded.`);
    }

    const daysInactive = (Date.now() - account.lastActivityDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysInactive > 180) {
      throw new BadRequestException('Account inactive for over 180 days. Redemption locked.');
    }

    account.balance -= points;
    account.dailyRedeemedAmount = currentDailyTotal + points;
    account.lastRedemptionDate = new Date();
    account.lastActivityDate = new Date();

    this.accounts.set(account.id, account);

    return this.createTransactionResult(account, points);
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

  private createTransactionResult(account: LoyaltyAccount, points: number): TransactionResult {
    return {
      accountId: account.id,
      transactedPoints: points,
      newBalance: account.balance,
      tier: account.tier,
      status: account.status,
    };
  }

  private calculateTier(lifetimePoints: number): LoyaltyTier {
    if (lifetimePoints >= 100_000) {
      return LoyaltyTier.PLATINUM;
    }
    if (lifetimePoints >= 50_000) {
      return LoyaltyTier.GOLD;
    }
    if (lifetimePoints >= 10_000) {
      return LoyaltyTier.SILVER;
    }
    return LoyaltyTier.BRONZE;
  }
}