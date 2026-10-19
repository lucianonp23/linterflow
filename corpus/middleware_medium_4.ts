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
    if (req.method !== 'POST' || !req.path.includes('/exchange/trade')) {
      return next();
    }

    const marketStatus = req.headers['x-market-status'] as string;
    if (marketStatus && marketStatus.toUpperCase() === 'CLOSED') {
      throw new ServiceUnavailableException('Exchange market is currently closed.');
    }

    const accountStatus = req.headers['x-account-status'] as string;
    if (!accountStatus || accountStatus.toUpperCase() !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active or verified for trading.');
    }

    const userTier = ((req.headers['x-user-tier'] as string) || '').toUpperCase();
    if (!userTier || !this.validTiers.has(userTier)) {
      throw new BadRequestException('Invalid or missing account membership tier.');
    }

    const sourceCurrency = req.body?.sourceCurrency?.toUpperCase();
    const targetCurrency = req.body?.targetCurrency?.toUpperCase();
    if (!sourceCurrency || !targetCurrency || sourceCurrency === targetCurrency) {
      throw new BadRequestException('Source and target currencies must be distinct ISO codes.');
    }

    if (!this.supportedCurrencies.has(sourceCurrency) || !this.supportedCurrencies.has(targetCurrency)) {
      throw new BadRequestException('One or both specified currency pairs are not supported.');
    }

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

    let calculatedSpread = tierConfig.baseSpread;
    let hasVolumeDiscount = false;

    if (amount >= 50000) {
      calculatedSpread *= 0.8;
      hasVolumeDiscount = true;
    }

    const exchangeReq = req as TieredExchangeRequest;
    exchangeReq.userTier = userTier;
    exchangeReq.appliedSpread = Number(calculatedSpread.toFixed(6));
    exchangeReq.discountedSpread = hasVolumeDiscount;

    next();
  }
}
