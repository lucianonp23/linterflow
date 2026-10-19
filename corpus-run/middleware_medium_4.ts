import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export interface TieredExchangeRequest extends Request {
  userTier?: string;
  appliedSpread?: number;
  discountedSpread?: boolean;
}

@Injectable()
export class TieredSpreadExchangeMiddleware implements NestMiddleware {
  private readonly supportedCurrencies = new Set([
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'CAD',
    'AUD',
    'CHF',
  ]);

  private readonly validTiers = new Set(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);

  private readonly tierLimits: Record<
    string,
    { minAmount: number; maxAmount: number; baseSpread: number }
  > = {
    BRONZE: { minAmount: 10, maxAmount: 5000, baseSpread: 0.02 },
    SILVER: { minAmount: 10, maxAmount: 25000, baseSpread: 0.012 },
    GOLD: { minAmount: 5, maxAmount: 100000, baseSpread: 0.006 },
    PLATINUM: { minAmount: 1, maxAmount: 1000000, baseSpread: 0.002 },
  };

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.isApplicableRequest(req)) {
      return next();
    }

    this.validateMarketStatus(req);
    this.validateAccountStatus(req);

    const userTier = this.getUserTier(req);
    this.validateCurrencies(req);

    const amount = this.validateAmount(req, userTier);
    this.applySpread(req, userTier, amount);

    next();
  }

  private isApplicableRequest(req: Request): boolean {
    return req.method === 'POST' && req.path.includes('/exchange/trade');
  }

  private validateMarketStatus(req: Request): void {
    const marketStatus = String(req.headers['x-market-status'] || '').toUpperCase();
    if (marketStatus === 'CLOSED') {
      throw new ServiceUnavailableException('Exchange market is currently closed.');
    }
  }

  private validateAccountStatus(req: Request): void {
    const accountStatus = String(req.headers['x-account-status'] || '').toUpperCase();
    if (accountStatus !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active or verified for trading.');
    }
  }

  private getUserTier(req: Request): string {
    const userTier = String(req.headers['x-user-tier'] || '').toUpperCase();
    if (!this.validTiers.has(userTier)) {
      throw new BadRequestException('Invalid or missing account membership tier.');
    }
    return userTier;
  }

  private validateCurrencies(req: Request): void {
    const sourceCurrency = req.body?.sourceCurrency?.toUpperCase();
    const targetCurrency = req.body?.targetCurrency?.toUpperCase();

    if (!sourceCurrency || !targetCurrency || sourceCurrency === targetCurrency) {
      throw new BadRequestException('Source and target currencies must be distinct ISO codes.');
    }

    if (!this.supportedCurrencies.has(sourceCurrency) || !this.supportedCurrencies.has(targetCurrency)) {
      throw new BadRequestException('One or both specified currency pairs are not supported.');
    }
  }

  private validateAmount(req: Request, userTier: string): number {
    const amount = Number(req.body?.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Exchange amount must be a positive number.');
    }

    const tierConfig = this.tierLimits[userTier];
    if (amount < tierConfig.minAmount) {
      throw new BadRequestException(
        `Trade amount ${amount} is below the minimum limit of ${tierConfig.minAmount} for ${userTier} tier.`,
      );
    }

    if (amount > tierConfig.maxAmount) {
      throw new PayloadTooLargeException(
        `Trade amount ${amount} exceeds the maximum limit of ${tierConfig.maxAmount} for ${userTier} tier.`,
      );
    }

    return amount;
  }

  private applySpread(req: Request, userTier: string, amount: number): void {
    const tierConfig = this.tierLimits[userTier];
    const hasVolumeDiscount = amount >= 50000;
    const calculatedSpread = hasVolumeDiscount
      ? tierConfig.baseSpread * 0.8
      : tierConfig.baseSpread;

    const exchangeReq = req as TieredExchangeRequest;
    exchangeReq.userTier = userTier;
    exchangeReq.appliedSpread = Number(calculatedSpread.toFixed(6));
    exchangeReq.discountedSpread = hasVolumeDiscount;
  }
}