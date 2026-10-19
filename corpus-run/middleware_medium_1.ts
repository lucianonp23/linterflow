import { Injectable, NestMiddleware, BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export interface FareEstimationRequest extends Request {
  surgeMultiplier?: number;
  isPeakHour?: boolean;
}

const VALID_REGIONS = ['NORTH_AMERICA', 'EUROPE', 'ASIA_PACIFIC'];
const VALID_TIERS = ['ECONOMY', 'COMFORT', 'LUXURY', 'VAN'];

function validateRegionCode(req: Request): void {
  const regionCode = req.headers['x-region-code'] as string;
  if (!regionCode || !VALID_REGIONS.includes(regionCode)) {
    throw new BadRequestException('Invalid or missing x-region-code header.');
  }
}

function validatePassengerCount(req: Request): void {
  const passengerCountHeader = req.headers['x-passenger-count'] as string;
  const passengerCount = parseInt(passengerCountHeader, 10);
  if (isNaN(passengerCount) || passengerCount < 1 || passengerCount > 8) {
    throw new BadRequestException('Passenger count must be between 1 and 8.');
  }
}

function validateDistance(req: Request): void {
  const distanceKmHeader = req.headers['x-distance-km'] as string;
  const distanceKm = parseFloat(distanceKmHeader);
  if (isNaN(distanceKm) || distanceKm < 0.1 || distanceKm > 1000) {
    throw new BadRequestException('Distance must be between 0.1 km and 1000 km.');
  }
}

function validateAccountStatus(req: Request): void {
  const accountStatus = req.headers['x-account-status'] as string;
  if (accountStatus === 'SUSPENDED' || accountStatus === 'BLOCKED') {
    throw new ForbiddenException('Account is not in a valid state to request fare estimates.');
  }
}

function validateRequestTimestamp(req: Request): number {
  const requestTimestampHeader = req.headers['x-request-timestamp'] as string;
  const requestTime = requestTimestampHeader ? new Date(requestTimestampHeader).getTime() : Date.now();
  if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > 300000) {
    throw new BadRequestException('Request timestamp drift exceeds allowed 5-minute threshold.');
  }
  return requestTime;
}

function validateRideTier(req: Request): void {
  const requestedTier = req.headers['x-ride-tier'] as string;
  if (!requestedTier || !VALID_TIERS.includes(requestedTier)) {
    throw new UnprocessableEntityException('Unsupported or missing ride tier specification.');
  }
}

function calculateSurgeInfo(requestTime: number): { surgeMultiplier: number; isPeakHour: boolean } {
  const reqDate = new Date(requestTime);
  const hour = reqDate.getUTCHours();
  const isMorningSurge = hour >= 7 && hour < 9;
  const isEveningSurge = hour >= 17 && hour < 19;
  const isPeakHour = isMorningSurge || isEveningSurge;
  const surgeMultiplier = isPeakHour ? 1.5 : 1.0;

  return { surgeMultiplier, isPeakHour };
}

@Injectable()
export class FareEstimationSurgeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    validateRegionCode(req);
    validatePassengerCount(req);
    validateDistance(req);
    validateAccountStatus(req);
    const requestTime = validateRequestTimestamp(req);
    validateRideTier(req);

    const { surgeMultiplier, isPeakHour } = calculateSurgeInfo(requestTime);

    const customReq = req as FareEstimationRequest;
    customReq.surgeMultiplier = surgeMultiplier;
    customReq.isPeakHour = isPeakHour;

    next();
  }
}