import { Injectable, NestMiddleware, BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export interface FareEstimationRequest extends Request {
  surgeMultiplier?: number;
  isPeakHour?: boolean;
}

const VALID_REGIONS = new Set(['NORTH_AMERICA', 'EUROPE', 'ASIA_PACIFIC']);
const VALID_TIERS = new Set(['ECONOMY', 'COMFORT', 'LUXURY', 'VAN']);
const FORBIDDEN_ACCOUNT_STATUSES = new Set(['SUSPENDED', 'BLOCKED']);

const MAX_TIMESTAMP_DRIFT_MS = 300_000;
const MIN_PASSENGERS = 1;
const MAX_PASSENGERS = 8;
const MIN_DISTANCE_KM = 0.1;
const MAX_DISTANCE_KM = 1000;

const SURGE_MULTIPLIER_PEAK = 1.5;
const SURGE_MULTIPLIER_NORMAL = 1.0;

@Injectable()
export class FareEstimationSurgeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headers = req.headers;

    this.validateRegion(headers['x-region-code'] as string);
    this.validatePassengerCount(headers['x-passenger-count'] as string);
    this.validateDistance(headers['x-distance-km'] as string);
    this.validateAccountStatus(headers['x-account-status'] as string);

    const requestTime = this.parseRequestTimestamp(headers['x-request-timestamp'] as string);
    this.validateTimestampDrift(requestTime);

    this.validateRideTier(headers['x-ride-tier'] as string);

    const isPeakHour = this.checkIsPeakHour(requestTime);
    const surgeMultiplier = isPeakHour ? SURGE_MULTIPLIER_PEAK : SURGE_MULTIPLIER_NORMAL;

    const customReq = req as FareEstimationRequest;
    customReq.surgeMultiplier = surgeMultiplier;
    customReq.isPeakHour = isPeakHour;

    next();
  }

  private validateRegion(regionCode?: string): void {
    if (!regionCode || !VALID_REGIONS.has(regionCode)) {
      throw new BadRequestException('Invalid or missing x-region-code header.');
    }
  }

  private validatePassengerCount(header?: string): void {
    const count = parseInt(header ?? '', 10);
    if (isNaN(count) || count < MIN_PASSENGERS || count > MAX_PASSENGERS) {
      throw new BadRequestException('Passenger count must be between 1 and 8.');
    }
  }

  private validateDistance(header?: string): void {
    const distance = parseFloat(header ?? '');
    if (isNaN(distance) || distance < MIN_DISTANCE_KM || distance > MAX_DISTANCE_KM) {
      throw new BadRequestException('Distance must be between 0.1 km and 1000 km.');
    }
  }

  private validateAccountStatus(status?: string): void {
    if (status && FORBIDDEN_ACCOUNT_STATUSES.has(status)) {
      throw new ForbiddenException('Account is not in a valid state to request fare estimates.');
    }
  }

  private parseRequestTimestamp(header?: string): number {
    return header ? new Date(header).getTime() : Date.now();
  }

  private validateTimestampDrift(requestTime: number): void {
    if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > MAX_TIMESTAMP_DRIFT_MS) {
      throw new BadRequestException('Request timestamp drift exceeds allowed 5-minute threshold.');
    }
  }

  private validateRideTier(tier?: string): void {
    if (!tier || !VALID_TIERS.has(tier)) {
      throw new UnprocessableEntityException('Unsupported or missing ride tier specification.');
    }
  }

  private checkIsPeakHour(requestTime: number): boolean {
    const hour = new Date(requestTime).getUTCHours();
    const isMorningSurge = hour >= 7 && hour < 9;
    const isEveningSurge = hour >= 17 && hour < 19;
    return isMorningSurge || isEveningSurge;
  }
}