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

interface TierConfig {
  minAmount: number;
  maxAmount: number;
  baseSpread: number;
}

const VOLUME_DISCOUNT_THRESHOLD = 50000;
const VOLUME_DISCOUNT_FACTOR = 0.8;
const SPREAD_DECIMAL_PLACES = 6;

@Injectable()
export class TieredSpreadExchangeMiddleware implements NestMiddleware {
  private readonly supportedCurrencies: ReadonlySet<string> = new Set([
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'CAD',
    'AUD',
    'CHF',
  ]);

  private readonly validTiers: ReadonlySet<string> = new Set(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);

  private readonly tierLimits: Readonly<Record<string, TierConfig>> = {
    BRONZE: { minAmount: 10, maxAmount: 5000, baseSpread: 0.02 },
    SILVER: { minAmount: 10, maxAmount: 25000, baseSpread: 0.012 },
    GOLD: { minAmount: 5, maxAmount: 100000, baseSpread: 0.006 },
    PLATINUM: { minAmount: 1, maxAmount: 1000000, baseSpread: 0.002 },
  };

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.shouldProcessRequest(req)) {
      return next();
    }

    this.validateMarketStatus(req);
    this.validateAccountStatus(req);

    const userTier = this.extractAndValidateUserTier(req);
    this.validateCurrencies(req);

    const amount = this.extractAndValidateAmount(req);
    const tierConfig = this.tierLimits[userTier];
    this.validateAmountAgainstTierLimits(amount, userTier, tierConfig);

    const { appliedSpread, discountedSpread } = this.calculateSpread(amount, tierConfig.baseSpread);

    this.attachTradeContext(req as TieredExchangeRequest, userTier, appliedSpread, discountedSpread);

    next();
  }

  private shouldProcessRequest(req: Request): boolean {
    return req.method === 'POST' && req.path.includes('/exchange/trade');
  }

  private validateMarketStatus(req: Request): void {
    const marketStatus = (req.headers['x-market-status'] as string)?.toUpperCase();
    if (marketStatus === 'CLOSED') {
      throw new ServiceUnavailableException('Exchange market is currently closed.');
    }
  }

  private validateAccountStatus(req: Request): void {
    const accountStatus = (req.headers['x-account-status'] as string)?.toUpperCase();
    if (!accountStatus || accountStatus !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active or verified for trading.');
    }
  }

  private extractAndValidateUserTier(req: Request): string {
    const userTier = ((req.headers['x-user-tier'] as string) || '').toUpperCase();
    if (!userTier || !this.validTiers.has(userTier)) {
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

  private extractAndValidateAmount(req: Request): number {
    const amount = Number(req.body?.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Exchange amount must be a positive number.');
    }
    return amount;
  }

  private validateAmountAgainstTierLimits(amount: number, userTier: string, tierConfig: TierConfig): void {
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
  }

  private calculateSpread(amount: number, baseSpread: number): { appliedSpread: number; discountedSpread: boolean } {
    let calculatedSpread = baseSpread;
    let hasVolumeDiscount = false;

    if (amount >= VOLUME_DISCOUNT_THRESHOLD) {
      calculatedSpread *= VOLUME_DISCOUNT_FACTOR;
      hasVolumeDiscount = true;
    }

    return {
      appliedSpread: Number(calculatedSpread.toFixed(SPREAD_DECIMAL_PLACES)),
      discountedSpread: hasVolumeDiscount,
    };
  }

  private attachTradeContext(
    req: TieredExchangeRequest,
    userTier: string,
    appliedSpread: number,
    discountedSpread: boolean,
  ): void {
    req.userTier = userTier;
    req.appliedSpread = appliedSpread;
    req.discountedSpread = discountedSpread;
  }
}