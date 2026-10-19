import { Injectable, NestMiddleware, BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export interface FareEstimationRequest extends Request {
  surgeMultiplier?: number;
  isPeakHour?: boolean;
}

@Injectable()
export class FareEstimationSurgeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const regionCode = req.headers['x-region-code'] as string;
    const passengerCountHeader = req.headers['x-passenger-count'] as string;
    const distanceKmHeader = req.headers['x-distance-km'] as string;
    const accountStatus = req.headers['x-account-status'] as string;
    const requestTimestampHeader = req.headers['x-request-timestamp'] as string;
    const requestedTier = req.headers['x-ride-tier'] as string;

    if (!regionCode || !['NORTH_AMERICA', 'EUROPE', 'ASIA_PACIFIC'].includes(regionCode)) {
      throw new BadRequestException('Invalid or missing x-region-code header.');
    }

    const passengerCount = parseInt(passengerCountHeader, 10);
    if (isNaN(passengerCount) || passengerCount < 1 || passengerCount > 8) {
      throw new BadRequestException('Passenger count must be between 1 and 8.');
    }

    const distanceKm = parseFloat(distanceKmHeader);
    if (isNaN(distanceKm) || distanceKm < 0.1 || distanceKm > 1000) {
      throw new BadRequestException('Distance must be between 0.1 km and 1000 km.');
    }

    if (accountStatus === 'SUSPENDED' || accountStatus === 'BLOCKED') {
      throw new ForbiddenException('Account is not in a valid state to request fare estimates.');
    }

    const requestTime = requestTimestampHeader ? new Date(requestTimestampHeader).getTime() : Date.now();
    if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > 300000) {
      throw new BadRequestException('Request timestamp drift exceeds allowed 5-minute threshold.');
    }

    const validTiers = ['ECONOMY', 'COMFORT', 'LUXURY', 'VAN'];
    if (!requestedTier || !validTiers.includes(requestedTier)) {
      throw new UnprocessableEntityException('Unsupported or missing ride tier specification.');
    }

    const reqDate = new Date(requestTime);
    const hour = reqDate.getUTCHours();
    const isMorningSurge = hour >= 7 && hour < 9;
    const isEveningSurge = hour >= 17 && hour < 19;
    const isPeakHour = isMorningSurge || isEveningSurge;

    let surgeMultiplier = 1.0;
    if (isPeakHour) {
      surgeMultiplier = 1.5;
    }

    const customReq = req as FareEstimationRequest;
    customReq.surgeMultiplier = surgeMultiplier;
    customReq.isPeakHour = isPeakHour;

    next();
  }
}
