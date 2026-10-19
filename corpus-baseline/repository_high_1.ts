import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

export type CallType =
  | 'VOICE_LOCAL'
  | 'VOICE_NATIONAL'
  | 'VOICE_INTL'
  | 'VOICE_PREMIUM'
  | 'VOICE_TOLLFREE'
  | 'SMS'
  | 'MMS'
  | 'DATA';

export type BillingPulse = '1_1' | '60_60' | '30_60' | '10_10' | '1024_1024';

export type TierType = 'GRADUATED' | 'FLAT_VOLUME';

export type TaxType = 'VAT' | 'STATE' | 'FEDERAL' | 'USF' | 'E911';

export type CdrStatus = 'NEW' | 'RATED' | 'FAILED' | 'REJECTED';

export interface RatingTier {
  minUnits: number;
  maxUnits: number;
  ratePerUnit: number;
  fixedFee: number;
}

export interface RatingRule {
  id: string;
  callType: CallType;
  destinationPrefixes: string[];
  peakStartTime: string; // HH:mm
  peakEndTime: string; // HH:mm
  peakRateMultiplier: number;
  offPeakRateMultiplier: number;
  weekendMultiplier: number;
  holidayDates: string[]; // YYYY-MM-DD
  holidayMultiplier: number;
  pulse: BillingPulse;
  tierType: TierType;
  tiers: RatingTier[];
  priority: number;
  effectiveFrom: Date;
  effectiveTo: Date;
}

export interface RatingPlan {
  id: string;
  code: string;
  name: string;
  defaultCurrency: string;
  rules: RatingRule[];
  active: boolean;
}

export interface RoamingMatrix {
  id: string;
  homeMccMnc: string;
  visitedMccMnc: string;
  zoneName: string;
  voiceSurchargePerMin: number;
  dataSurchargePerMb: number;
  smsSurcharge: number;
  mmsSurcharge: number;
  penaltyMultiplier: number;
  active: boolean;
}

export interface TaxRate {
  id: string;
  code: string;
  taxType: TaxType;
  percentage: number;
  isCompound: boolean;
  appliesToCallTypes: CallType[];
  exemptAccountTypes: string[];
  effectiveFrom: Date;
  effectiveTo: Date;
  active: boolean;
}

export interface AccountBucket {
  bucketId: string;
  callType: CallType;
  remainingUnits: number;
  totalUnits: number;
  expiresAt: Date;
}

export interface CustomerAccount {
  id: string;
  accountNumber: string;
  ratingPlanId: string;
  homeMccMnc: string;
  accountType: string;
  currency: string;
  creditLimit: number;
  currentBalance: number;
  buckets: AccountBucket[];
  isTaxExempt: boolean;
  exemptTaxCodes: string[];
  active: boolean;
}

export interface CallDetailRecord {
  id: string;
  accountId: string;
  callType: CallType;
  originatingNumber: string;
  destinationNumber: string;
  originMccMnc: string;
  visitedMccMnc: string;
  startTime: Date;
  durationSeconds: number;
  dataVolumeBytes: number;
  status: CdrStatus;
  failureReason?: string;
}

export interface TaxDetail {
  taxCode: string;
  taxType: TaxType;
  ratePercentage: number;
  taxableAmount: number;
  calculatedTax: number;
}

export interface TimeSliceBreakdown {
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  isPeak: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  applicableMultiplier: number;
}

export interface RatedUsageRecord {
  id: string;
  cdrId: string;
  accountId: string;
  ratedAt: Date;
  rawUnits: number;
  billedUnits: number;
  baseCost: number;
  roamingSurcharge: number;
  timeBasedSurcharge: number;
  bucketUnitsDeducted: number;
  taxDetails: TaxDetail[];
  totalTax: number;
  totalAmount: number;
  currency: string;
  timeSlices: TimeSliceBreakdown[];
}

@Injectable()
export class TelecomBillingRepository {
  private readonly ratingPlans = new Map<string, RatingPlan>();
  private readonly roamingMatrices = new Map<string, RoamingMatrix>();
  private readonly taxRates = new Map<string, TaxRate>();
  private readonly customerAccounts = new Map<string, CustomerAccount>();
  private readonly callDetailRecords = new Map<string, CallDetailRecord>();
  private readonly ratedUsageRecords = new Map<string, RatedUsageRecord>();

  // --- Rating Plan CRUD & Validation ---

  public createRatingPlan(plan: RatingPlan): RatingPlan {
    if (this.ratingPlans.has(plan.id)) {
      throw new ConflictException(`Rating Plan with ID ${plan.id} already exists`);
    }
    this.validateRatingPlan(plan);
    this.ratingPlans.set(plan.id, plan);
    return plan;
  }

  public getRatingPlan(id: string): RatingPlan {
    const plan = this.ratingPlans.get(id);
    if (!plan) {
      throw new NotFoundException(`Rating Plan ${id} not found`);
    }
    return plan;
  }

  public updateRatingPlan(id: string, updated: Partial<RatingPlan>): RatingPlan {
    const existing = this.getRatingPlan(id);
    const merged: RatingPlan = { ...existing, ...updated, id };
    this.validateRatingPlan(merged);
    this.ratingPlans.set(id, merged);
    return merged;
  }

  public deleteRatingPlan(id: string): boolean {
    this.getRatingPlan(id);
    for (const acc of this.customerAccounts.values()) {
      if (acc.ratingPlanId === id) {
        throw new BadRequestException(`Cannot delete Rating Plan ${id} assigned to active account ${acc.id}`);
      }
    }
    return this.ratingPlans.delete(id);
  }

  private validateRatingPlan(plan: RatingPlan): void {
    if (!plan.code || plan.code.trim().length === 0) {
      throw new BadRequestException('Rating Plan code is required');
    }
    if (!plan.rules || !Array.isArray(plan.rules)) {
      throw new BadRequestException('Rating Plan rules array is required');
    }
    for (let i = 0; i < plan.rules.length; i++) {
      const rule = plan.rules[i];
      if (rule.effectiveFrom >= rule.effectiveTo) {
        throw new BadRequestException(`Rule ${rule.id} has effectiveFrom date after or equal to effectiveTo`);
      }
      if (
        rule.peakRateMultiplier < 0 ||
        rule.offPeakRateMultiplier < 0 ||
        rule.weekendMultiplier < 0 ||
        rule.holidayMultiplier < 0
      ) {
        throw new BadRequestException(`Rule ${rule.id} contains negative multipliers`);
      }
      this.validateTiers(rule.tiers, rule.tierType);
      for (let j = i + 1; j < plan.rules.length; j++) {
        const other = plan.rules[j];
        if (rule.priority === other.priority && rule.callType === other.callType) {
          throw new BadRequestException(`Priority collision (${rule.priority}) for call type ${rule.callType}`);
        }
      }
    }
  }

  private validateTiers(tiers: RatingTier[], type: TierType): void {
    if (!tiers || tiers.length === 0) {
      throw new BadRequestException('At least one rating tier must be defined');
    }
    const sorted = [...tiers].sort((a, b) => a.minUnits - b.minUnits);
    if (sorted[0].minUnits !== 0) {
      throw new BadRequestException('Initial rating tier must start at 0 minUnits');
    }
    for (let i = 0; i < sorted.length; i++) {
      const tier = sorted[i];
      if (tier.minUnits < 0 || tier.maxUnits <= tier.minUnits) {
        throw new BadRequestException(`Invalid tier bounds: [${tier.minUnits}, ${tier.maxUnits}]`);
      }
      if (tier.ratePerUnit < 0 || tier.fixedFee < 0) {
        throw new BadRequestException('Tier ratePerUnit and fixedFee must be non-negative');
      }
      if (i > 0) {
        const prev = sorted[i - 1];
        if (tier.minUnits !== prev.maxUnits && prev.maxUnits !== Infinity) {
          throw new BadRequestException(`Gap or overlap between tiers at ${prev.maxUnits} and ${tier.minUnits}`);
        }
      }
    }
  }

  // --- Roaming Matrix CRUD ---

  public createRoamingMatrix(matrix: RoamingMatrix): RoamingMatrix {
    if (this.roamingMatrices.has(matrix.id)) {
      throw new ConflictException(`Roaming Matrix with ID ${matrix.id} already exists`);
    }
    this.validateRoamingMatrix(matrix);
    this.roamingMatrices.set(matrix.id, matrix);
    return matrix;
  }

  public getRoamingMatrix(id: string): RoamingMatrix {
    const matrix = this.roamingMatrices.get(id);
    if (!matrix) {
      throw new NotFoundException(`Roaming Matrix ${id} not found`);
    }
    return matrix;
  }

  private validateRoamingMatrix(matrix: RoamingMatrix): void {
    const mccMncRegex = /^\d{5,6}$/;
    if (!mccMncRegex.test(matrix.homeMccMnc) || !mccMncRegex.test(matrix.visitedMccMnc)) {
      throw new BadRequestException('MCC/MNC must be 5 or 6 numeric digits');
    }
    if (
      matrix.voiceSurchargePerMin < 0 ||
      matrix.dataSurchargePerMb < 0 ||
      matrix.smsSurcharge < 0 ||
      matrix.mmsSurcharge < 0
    ) {
      throw new BadRequestException('Roaming surcharges cannot be negative');
    }
    if (matrix.penaltyMultiplier < 1) {
      throw new BadRequestException('Penalty multiplier must be at least 1.0');
    }
  }

  // --- Tax Rates CRUD ---

  public createTaxRate(taxRate: TaxRate): TaxRate {
    if (this.taxRates.has(taxRate.id)) {
      throw new ConflictException(`Tax Rate ${taxRate.id} already exists`);
    }
    this.validateTaxRate(taxRate);
    this.taxRates.set(taxRate.id, taxRate);
    return taxRate;
  }

  public getTaxRate(id: string): TaxRate {
    const tax = this.taxRates.get(id);
    if (!tax) {
      throw new NotFoundException(`Tax Rate ${id} not found`);
    }
    return tax;
  }

  private validateTaxRate(tax: TaxRate): void {
    if (tax.percentage < 0 || tax.percentage > 100) {
      throw new BadRequestException('Tax percentage must be between 0 and 100');
    }
    if (tax.effectiveFrom >= tax.effectiveTo) {
      throw new BadRequestException('Tax effectiveFrom must precede effectiveTo');
    }
  }

  // --- Account CRUD ---

  public createAccount(account: CustomerAccount): CustomerAccount {
    if (this.customerAccounts.has(account.id)) {
      throw new ConflictException(`Account ${account.id} already exists`);
    }
    this.getRatingPlan(account.ratingPlanId);
    this.customerAccounts.set(account.id, account);
    return account;
  }

  public getAccount(id: string): CustomerAccount {
    const acc = this.customerAccounts.get(id);
    if (!acc) {
      throw new NotFoundException(`Customer Account ${id} not found`);
    }
    return acc;
  }

  public addAccountBucket(accountId: string, bucket: AccountBucket): CustomerAccount {
    const acc = this.getAccount(accountId);
    acc.buckets.push(bucket);
    this.customerAccounts.set(accountId, acc);
    return acc;
  }

  // --- CDR Management ---

  public createCdr(cdr: CallDetailRecord): CallDetailRecord {
    if (this.callDetailRecords.has(cdr.id)) {
      throw new ConflictException(`CDR ${cdr.id} already exists`);
    }
    this.getAccount(cdr.accountId);
    if (cdr.durationSeconds < 0 || cdr.dataVolumeBytes < 0) {
      throw new BadRequestException('Usage volume or duration cannot be negative');
    }
    cdr.status = 'NEW';
    this.callDetailRecords.set(cdr.id, cdr);
    return cdr;
  }

  public getCdr(id: string): CallDetailRecord {
    const cdr = this.callDetailRecords.get(id);
    if (!cdr) {
      throw new NotFoundException(`CDR ${id} not found`);
    }
    return cdr;
  }

  // --- Core Billing Engine Logic ---

  public async rateCallDetailRecord(cdrId: string): Promise<RatedUsageRecord> {
    const cdr = this.getCdr(cdrId);
    if (cdr.status === 'RATED') {
      throw new BadRequestException(`CDR ${cdrId} is already rated`);
    }

    const account = this.getAccount(cdr.accountId);
    if (!account.active) {
      this.rejectCdr(cdr, 'ACCOUNT_INACTIVE', 'Cannot rate CDR for inactive account');
    }

    const plan = this.getRatingPlan(account.ratingPlanId);
    if (!plan.active) {
      this.failCdr(cdr, 'RATING_PLAN_INACTIVE', 'Rating plan is inactive');
    }

    const rule = this.selectRatingRule(plan, cdr);
    if (!rule) {
      this.failCdr(cdr, 'NO_MATCHING_RATING_RULE', 'No matching rating rule found');
    }

    const rawUnits = cdr.callType === 'DATA' ? cdr.dataVolumeBytes : cdr.durationSeconds;
    const billedUnits = this.calculatePulseUnits(rawUnits, rule.pulse, cdr.callType);

    const roamingSurcharge = this.calculateRoamingSurcharge(cdr, account.homeMccMnc, billedUnits);

    const timeSlices = this.calculateTimeSlices(cdr.startTime, cdr.durationSeconds, rule);
    const aggregatedMultiplier = this.calculateAggregatedMultiplier(timeSlices, cdr.durationSeconds);

    const unitsAfterBuckets = this.consumeAccountBuckets(account, cdr.callType, billedUnits);
    const bucketUnitsDeducted = billedUnits - unitsAfterBuckets;

    const baseCost = this.computeTieredCost(unitsAfterBuckets, rule.tiers, rule.tierType);
    const timeBasedSurcharge = baseCost * (aggregatedMultiplier - 1.0);
    const subtotal = Math.max(0, baseCost + timeBasedSurcharge + roamingSurcharge);

    const taxDetails = this.computeTaxes(account, cdr.callType, cdr.startTime, subtotal);
    const totalTax = taxDetails.reduce((acc, curr) => acc + curr.calculatedTax, 0);
    const totalAmount = subtotal + totalTax;

    if (account.currentBalance + totalAmount > account.creditLimit) {
      this.rejectCdr(cdr, 'CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded for account');
    }

    account.currentBalance += totalAmount;
    this.customerAccounts.set(account.id, account);

    cdr.status = 'RATED';
    this.callDetailRecords.set(cdr.id, cdr);

    const ratedRecord: RatedUsageRecord = {
      id: `RATED_${cdr.id}_${Date.now()}`,
      cdrId: cdr.id,
      accountId: account.id,
      ratedAt: new Date(),
      rawUnits,
      billedUnits,
      baseCost,
      roamingSurcharge,
      timeBasedSurcharge,
      bucketUnitsDeducted,
      taxDetails,
      totalTax,
      totalAmount,
      currency: plan.defaultCurrency,
      timeSlices,
    };

    this.ratedUsageRecords.set(ratedRecord.id, ratedRecord);
    return ratedRecord;
  }

  // --- Engine Internal Helpers ---

  private rejectCdr(cdr: CallDetailRecord, reason: string, message: string): never {
    cdr.status = 'REJECTED';
    cdr.failureReason = reason;
    this.callDetailRecords.set(cdr.id, cdr);
    throw new UnprocessableEntityException(message);
  }

  private failCdr(cdr: CallDetailRecord, reason: string, message: string): never {
    cdr.status = 'FAILED';
    cdr.failureReason = reason;
    this.callDetailRecords.set(cdr.id, cdr);
    throw new UnprocessableEntityException(message);
  }

  private calculateRoamingSurcharge(
    cdr: CallDetailRecord,
    homeMccMnc: string,
    billedUnits: number,
  ): number {
    const isRoaming = cdr.originMccMnc !== homeMccMnc || cdr.visitedMccMnc !== homeMccMnc;
    if (!isRoaming) return 0;

    const roamingMatrix = Array.from(this.roamingMatrices.values()).find(
      (rm) => rm.active && rm.homeMccMnc === homeMccMnc && rm.visitedMccMnc === cdr.visitedMccMnc,
    );

    if (roamingMatrix) {
      switch (cdr.callType) {
        case 'VOICE_LOCAL':
        case 'VOICE_NATIONAL':
        case 'VOICE_INTL':
        case 'VOICE_PREMIUM':
        case 'VOICE_TOLLFREE':
          return (billedUnits / 60) * roamingMatrix.voiceSurchargePerMin;
        case 'DATA':
          return (billedUnits / (1024 * 1024)) * roamingMatrix.dataSurchargePerMb;
        case 'SMS':
          return roamingMatrix.smsSurcharge;
        case 'MMS':
          return roamingMatrix.mmsSurcharge;
      }
    }

    const defaultPenalty = 5.0;
    switch (cdr.callType) {
      case 'DATA':
        return (billedUnits / (1024 * 1024)) * 2.0 * defaultPenalty;
      case 'SMS':
      case 'MMS':
        return 1.0 * defaultPenalty;
      default:
        return (billedUnits / 60) * 1.5 * defaultPenalty;
    }
  }

  private calculateAggregatedMultiplier(timeSlices: TimeSliceBreakdown[], totalSeconds: number): number {
    if (timeSlices.length === 0) return 1.0;

    let totalWeighted = 0;
    for (const slice of timeSlices) {
      totalWeighted += slice.applicableMultiplier * slice.durationSeconds;
    }
    return totalWeighted / totalSeconds;
  }

  private selectRatingRule(plan: RatingPlan, cdr: CallDetailRecord): RatingRule | null {
    const candidateRules = plan.rules.filter((rule) => {
      if (rule.callType !== cdr.callType) return false;
      if (cdr.startTime < rule.effectiveFrom || cdr.startTime > rule.effectiveTo) return false;
      if (rule.destinationPrefixes.length > 0) {
        const matched = rule.destinationPrefixes.some((prefix) => cdr.destinationNumber.startsWith(prefix));
        if (!matched) return false;
      }
      return true;
    });

    if (candidateRules.length === 0) return null;

    candidateRules.sort((a, b) => {
      const aPrefixMax = Math.max(...a.destinationPrefixes.map((p) => p.length), 0);
      const bPrefixMax = Math.max(...b.destinationPrefixes.map((p) => p.length), 0);
      if (aPrefixMax !== bPrefixMax) {
        return bPrefixMax - aPrefixMax;
      }
      return b.priority - a.priority;
    });

    return candidateRules[0];
  }

  private calculatePulseUnits(rawUnits: number, pulse: BillingPulse, callType: CallType): number {
    if (callType === 'SMS' || callType === 'MMS') {
      return Math.ceil(rawUnits);
    }

    switch (pulse) {
      case '1_1':
        return Math.ceil(rawUnits);
      case '60_60': {
        if (rawUnits <= 0) return 0;
        return Math.ceil(rawUnits / 60) * 60;
      }
      case '30_60': {
        if (rawUnits <= 0) return 0;
        if (rawUnits <= 30) return 30;
        return 30 + Math.ceil((rawUnits - 30) / 60) * 60;
      }
      case '10_10': {
        if (rawUnits <= 0) return 0;
        return Math.ceil(rawUnits / 10) * 10;
      }
      case '1024_1024': {
        if (rawUnits <= 0) return 0;
        return Math.ceil(rawUnits / 1024) * 1024;
      }
      default:
        return Math.ceil(rawUnits);
    }
  }

  private calculateTimeSlices(startTime: Date, totalSeconds: number, rule: RatingRule): TimeSliceBreakdown[] {
    if (totalSeconds <= 0) return [];
    const slices: TimeSliceBreakdown[] = [];
    let remainingSeconds = totalSeconds;
    let currentStart = new Date(startTime.getTime());

    while (remainingSeconds > 0) {
      const currentEnd = new Date(currentStart.getTime());
      currentEnd.setHours(23, 59, 59, 999);
      const secondsTillMidnight = Math.floor((currentEnd.getTime() - currentStart.getTime()) / 1000) + 1;
      const sliceDuration = Math.min(remainingSeconds, secondsTillMidnight);
      const sliceEnd = new Date(currentStart.getTime() + sliceDuration * 1000);

      const dayOfWeek = currentStart.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      const dateStr = currentStart.toISOString().split('T')[0];
      const isHoliday = rule.holidayDates.includes(dateStr);

      const timeStr = currentStart.toTimeString().split(' ')[0].substring(0, 5);
      const isPeak = timeStr >= rule.peakStartTime && timeStr <= rule.peakEndTime;

      let applicableMultiplier = 1.0;
      if (isHoliday) {
        applicableMultiplier *= rule.holidayMultiplier;
      }
      if (isWeekend) {
        applicableMultiplier *= rule.weekendMultiplier;
      }
      if (isPeak) {
        applicableMultiplier *= rule.peakRateMultiplier;
      } else if (!isHoliday && !isWeekend) {
        applicableMultiplier *= rule.offPeakRateMultiplier;
      }

      slices.push({
        startTime: new Date(currentStart),
        endTime: sliceEnd,
        durationSeconds: sliceDuration,
        isPeak,
        isWeekend,
        isHoliday,
        applicableMultiplier,
      });

      remainingSeconds -= sliceDuration;
      currentStart = sliceEnd;
    }

    return slices;
  }

  private consumeAccountBuckets(account: CustomerAccount, callType: CallType, unitsNeeded: number): number {
    let remainingToCover = unitsNeeded;
    const now = new Date();

    for (const bucket of account.buckets) {
      if (bucket.callType === callType && bucket.remainingUnits > 0 && bucket.expiresAt > now) {
        if (bucket.remainingUnits >= remainingToCover) {
          bucket.remainingUnits -= remainingToCover;
          remainingToCover = 0;
          break;
        } else {
          remainingToCover -= bucket.remainingUnits;
          bucket.remainingUnits = 0;
        }
      }
    }

    return remainingToCover;
  }

  private computeTieredCost(units: number, tiers: RatingTier[], type: TierType): number {
    if (units <= 0) return 0;
    const sortedTiers = [...tiers].sort((a, b) => a.minUnits - b.minUnits);

    if (type === 'FLAT_VOLUME') {
      for (const tier of sortedTiers) {
        if (units >= tier.minUnits && units <= tier.maxUnits) {
          return units * tier.ratePerUnit + tier.fixedFee;
        }
      }
      const highest = sortedTiers[sortedTiers.length - 1];
      return units * highest.ratePerUnit + highest.fixedFee;
    } else {
      let totalCost = 0;
      let unitsLeft = units;

      for (const tier of sortedTiers) {
        if (unitsLeft <= 0) break;
        const tierCapacity = tier.maxUnits - tier.minUnits;
        const unitsInTier = Math.min(unitsLeft, tierCapacity);

        if (unitsInTier > 0) {
          totalCost += unitsInTier * tier.ratePerUnit + tier.fixedFee;
          unitsLeft -= unitsInTier;
        }
      }
      return totalCost;
    }
  }

  private computeTaxes(
    account: CustomerAccount,
    callType: CallType,
    ratingDate: Date,
    taxableSubtotal: number,
  ): TaxDetail[] {
    if (account.isTaxExempt) return [];

    const applicableTaxes = Array.from(this.taxRates.values()).filter((tax) => {
      if (!tax.active) return false;
      if (ratingDate < tax.effectiveFrom || ratingDate > tax.effectiveTo) return false;
      if (tax.appliesToCallTypes.length > 0 && !tax.appliesToCallTypes.includes(callType)) return false;
      if (account.exemptTaxCodes.includes(tax.code)) return false;
      if (tax.exemptAccountTypes.includes(account.accountType)) return false;
      return true;
    });

    const simpleTaxes = applicableTaxes.filter((t) => !t.isCompound);
    const compoundTaxes = applicableTaxes.filter((t) => t.isCompound);

    const details: TaxDetail[] = [];
    let runningTaxableTotal = taxableSubtotal;
    let simpleTaxSum = 0;

    for (const tax of simpleTaxes) {
      const taxAmount = taxableSubtotal * (tax.percentage / 100);
      simpleTaxSum += taxAmount;
      details.push({
        taxCode: tax.code,
        taxType: tax.taxType,
        ratePercentage: tax.percentage,
        taxableAmount: taxableSubtotal,
        calculatedTax: taxAmount,
      });
    }

    runningTaxableTotal += simpleTaxSum;

    for (const tax of compoundTaxes) {
      const taxAmount = runningTaxableTotal * (tax.percentage / 100);
      details.push({
        taxCode: tax.code,
        taxType: tax.taxType,
        ratePercentage: tax.percentage,
        taxableAmount: runningTaxableTotal,
        calculatedTax: taxAmount,
      });
    }

    return details;
  }

  // --- Batch Processing & Analytics ---

  public async rateAllPendingCdrs(): Promise<{ rated: number; failed: number }> {
    const pendingCdrs = Array.from(this.callDetailRecords.values()).filter((c) => c.status === 'NEW');
    let rated = 0;
    let failed = 0;

    for (const cdr of pendingCdrs) {
      try {
        await this.rateCallDetailRecord(cdr.id);
        rated++;
      } catch (err) {
        failed++;
      }
    }

    return { rated, failed };
  }

  public getRatedRecordsForAccount(accountId: string): RatedUsageRecord[] {
    return Array.from(this.ratedUsageRecords.values()).filter((r) => r.accountId === accountId);
  }

  public getAccountRevenueSummary(accountId: string): { baseCostSum: number; taxSum: number; totalSum: number } {
    const records = this.getRatedRecordsForAccount(accountId);
    return records.reduce(
      (acc, r) => ({
        baseCostSum: acc.baseCostSum + r.baseCost,
        taxSum: acc.taxSum + r.totalTax,
        totalSum: acc.totalSum + r.totalAmount,
      }),
      { baseCostSum: 0, taxSum: 0, totalSum: 0 },
    );
  }
}