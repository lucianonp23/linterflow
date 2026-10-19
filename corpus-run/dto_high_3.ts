import {
  IsEnum,
  IsNumber,
  IsString,
  IsBoolean,
  IsOptional,
  IsDate,
  IsArray,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
  RegisterDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum CustomerTier {
  STANDARD = 'STANDARD',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  VIP = 'VIP',
  CORPORATE = 'CORPORATE',
}

export enum CancellationReason {
  CHANGE_OF_PLANS = 'CHANGE_OF_PLANS',
  MEDICAL_EMERGENCY = 'MEDICAL_EMERGENCY',
  FLIGHT_DELAY_CANCELLED = 'FLIGHT_DELAY_CANCELLED',
  WEATHER_EVENT = 'WEATHER_EVENT',
  SERVICE_DISSATISFACTION = 'SERVICE_DISSATISFACTION',
  FORCE_MAJEURE = 'FORCE_MAJEURE',
  FRAUD_OR_SYSTEM_ERROR = 'FRAUD_OR_SYSTEM_ERROR',
  MERCHANT_CANCELLED = 'MERCHANT_CANCELLED',
}

export enum LineItemType {
  CORE_BOOKING = 'CORE_BOOKING',
  ADD_ON = 'ADD_ON',
  INSURANCE = 'INSURANCE',
  DEPOSIT = 'DEPOSIT',
  SERVICE_FEE = 'SERVICE_FEE',
}

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
  JPY = 'JPY',
}

export enum DocumentType {
  MEDICAL_CERTIFICATE = 'MEDICAL_CERTIFICATE',
  FLIGHT_CANCEL_NOTICE = 'FLIGHT_CANCEL_NOTICE',
  WEATHER_ALERT = 'WEATHER_ALERT',
  POLICE_REPORT = 'POLICE_REPORT',
  OFFICIAL_DECREE = 'OFFICIAL_DECREE',
}

const REQUIRED_PROOF_DOC_TYPES: Partial<Record<CancellationReason, DocumentType[]>> = {
  [CancellationReason.MEDICAL_EMERGENCY]: [DocumentType.MEDICAL_CERTIFICATE],
  [CancellationReason.FLIGHT_DELAY_CANCELLED]: [DocumentType.FLIGHT_CANCEL_NOTICE],
  [CancellationReason.WEATHER_EVENT]: [DocumentType.WEATHER_ALERT],
  [CancellationReason.FORCE_MAJEURE]: [DocumentType.OFFICIAL_DECREE, DocumentType.POLICE_REPORT],
};

const TIER_DISCOUNT_RULES: Record<CustomerTier, (hours: number) => number> = {
  [CustomerTier.VIP]: () => 100,
  [CustomerTier.PLATINUM]: (h) => (h >= 12 ? 100 : 50),
  [CustomerTier.GOLD]: (h) => (h >= 24 ? 50 : 25),
  [CustomerTier.SILVER]: (h) => (h >= 48 ? 25 : 10),
  [CustomerTier.CORPORATE]: (h) => (h >= 24 ? 80 : 40),
  [CustomerTier.STANDARD]: () => 0,
};

const REASON_WAIVER_HANDLERS: Partial<Record<CancellationReason, (proof: DocumentProofDto | undefined, hours: number) => number>> = {
  [CancellationReason.MEDICAL_EMERGENCY]: (proof) => (proof?.verifiedByAdmin ? 100 : proof ? 80 : 0),
  [CancellationReason.FORCE_MAJEURE]: (proof) => (proof ? 100 : 50),
  [CancellationReason.FLIGHT_DELAY_CANCELLED]: (proof) => (proof ? 75 : 25),
  [CancellationReason.WEATHER_EVENT]: (proof) => (proof ? 75 : 30),
  [CancellationReason.SERVICE_DISSATISFACTION]: (_, hours) => (hours < 0 && Math.abs(hours) <= 24 ? 50 : 0),
};

const MERCHANT_OR_SYSTEM_FAULT_REASONS = new Set<CancellationReason>([
  CancellationReason.MERCHANT_CANCELLED,
  CancellationReason.FRAUD_OR_SYSTEM_ERROR,
]);

const HIGH_TIERS = new Set<CustomerTier>([
  CustomerTier.VIP,
  CustomerTier.PLATINUM,
]);

interface LineItemContext {
  item: BookingLineItemDto;
  breakdown: LineItemRefundBreakdownDto;
  reason: CancellationReason;
  hoursBeforeStart: number;
  tier: CustomerTier;
  roundFn: (num: number) => number;
}

type LineItemProcessor = (ctx: LineItemContext) => void;

function setZeroRefund(breakdown: LineItemRefundBreakdownDto, percentage: number, reason: string): void {
  breakdown.appliedPenaltyPercentage = percentage;
  breakdown.penaltyAmount = breakdown.originalAmount;
  breakdown.netRefundAmount = 0;
  breakdown.taxRefundAmount = 0;
  breakdown.rejectionReason = reason;
}

function setFullRefund(breakdown: LineItemRefundBreakdownDto, item: BookingLineItemDto): void {
  breakdown.appliedPenaltyPercentage = 0;
  breakdown.penaltyAmount = 0;
  breakdown.netRefundAmount = item.amount;
  breakdown.taxRefundAmount = item.taxAmount;
}

function applyPercentageRefund(
  breakdown: LineItemRefundBreakdownDto,
  item: BookingLineItemDto,
  roundFn: (num: number) => number
): void {
  breakdown.penaltyAmount = roundFn(item.amount * (breakdown.appliedPenaltyPercentage / 100));
  breakdown.netRefundAmount = roundFn(item.amount - breakdown.penaltyAmount);
  const refundRatio = item.amount > 0 ? breakdown.netRefundAmount / item.amount : 0;
  breakdown.taxRefundAmount = roundFn(item.taxAmount * refundRatio);
}

function applyCoreBookingRefund(
  breakdown: LineItemRefundBreakdownDto,
  item: BookingLineItemDto,
  roundFn: (num: number) => number
): void {
  let calculatedPenalty = item.amount * (breakdown.appliedPenaltyPercentage / 100);
  if (item.customNonRefundableFee && item.customNonRefundableFee > 0) {
    calculatedPenalty = Math.max(calculatedPenalty, item.customNonRefundableFee);
    if (calculatedPenalty > item.amount) {
      calculatedPenalty = item.amount;
    }
    breakdown.rejectionReason = 'CUSTOM_MINIMUM_NON_REFUNDABLE_FEE_APPLIED';
  }
  breakdown.penaltyAmount = roundFn(calculatedPenalty);
  breakdown.netRefundAmount = roundFn(item.amount - breakdown.penaltyAmount);
  const ratio = item.amount > 0 ? breakdown.netRefundAmount / item.amount : 0;
  breakdown.taxRefundAmount = roundFn(item.taxAmount * ratio);
}

const LINE_ITEM_PROCESSORS: Record<LineItemType, LineItemProcessor> = {
  [LineItemType.INSURANCE]: ({ breakdown }) => {
    setZeroRefund(breakdown, 100, 'INSURANCE_PREMIUM_NON_REFUNDABLE');
  },
  [LineItemType.DEPOSIT]: ({ breakdown, item, reason, tier }) => {
    const isFullRefund =
      reason === CancellationReason.MEDICAL_EMERGENCY ||
      reason === CancellationReason.FORCE_MAJEURE ||
      tier === CustomerTier.VIP;
    if (isFullRefund) {
      setFullRefund(breakdown, item);
    } else {
      setZeroRefund(breakdown, 100, 'DEPOSIT_FORFEITED');
    }
  },
  [LineItemType.SERVICE_FEE]: ({ breakdown, item, hoursBeforeStart }) => {
    if (hoursBeforeStart >= 72) {
      setFullRefund(breakdown, item);
    } else {
      setZeroRefund(breakdown, 100, 'SERVICE_FEE_NON_REFUNDABLE_WITHIN_72H');
    }
  },
  [LineItemType.ADD_ON]: ({ breakdown, item, hoursBeforeStart, tier, roundFn }) => {
    const isNonRefundable = hoursBeforeStart < 24 && tier !== CustomerTier.VIP && tier !== CustomerTier.PLATINUM;
    if (isNonRefundable) {
      setZeroRefund(breakdown, 100, 'ADD_ON_NON_REFUNDABLE_WITHIN_24H');
    } else {
      applyPercentageRefund(breakdown, item, roundFn);
    }
  },
  [LineItemType.CORE_BOOKING]: ({ breakdown, item, roundFn }) => {
    applyCoreBookingRefund(breakdown, item, roundFn);
  },
};

function applyPeakSeasonSurge(
  basePercent: number,
  isPeak: boolean
): { penalty: number; condition?: string } {
  if (isPeak && basePercent > 0 && basePercent < 100) {
    return {
      penalty: Math.min(100, basePercent * 1.25),
      condition: 'PEAK_SEASON_SURGE_PENALTY_APPLIED (+25% to base penalty)',
    };
  }
  return { penalty: basePercent };
}

function calculatePriorRefundDeduction(
  priorRefundAmount: number,
  netCashRefund: number,
  currency: Currency
): { deduction: number; condition?: string } {
  if (priorRefundAmount > 0) {
    const deduction = Math.min(netCashRefund, priorRefundAmount);
    return {
      deduction,
      condition: `PRIOR_REFUND_DEDUCTED (${deduction} ${currency})`,
    };
  }
  return { deduction: 0 };
}

function calculateStoreCreditBonus(
  requested: boolean,
  netCash: number,
  tier: CustomerTier,
  roundFn: (n: number) => number
): { bonus: number; condition?: string } {
  if (requested && netCash > 0) {
    const rate = HIGH_TIERS.has(tier) ? 0.15 : 0.10;
    return {
      bonus: roundFn(netCash * rate),
      condition: `STORE_CREDIT_INCENTIVE_BONUS (+${rate * 100}% extra value as store credit)`,
    };
  }
  return { bonus: 0 };
}

@ValidatorConstraint({ name: 'IsAfterDateConstraint', async: false })
export class IsAfterDateConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: any, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as any)[relatedPropertyName];
    if (!(propertyValue instanceof Date) || !(relatedValue instanceof Date)) {
      return false;
    }
    return propertyValue.getTime() > relatedValue.getTime();
  }

  defaultMessage(args: ValidationArguments): string {
    const [relatedPropertyName] = args.constraints;
    return `${args.property} must be after ${relatedPropertyName}`;
  }
}

export function IsAfterDate(property: string, validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    RegisterDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsAfterDateConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'IsValidProofForReasonConstraint', async: false })
export class IsValidProofForReasonConstraint implements ValidatorConstraintInterface {
  validate(proofDocument: any, args: ValidationArguments): boolean {
    const dto = args.object as any;
    const reason = dto.cancellationReason as CancellationReason;
    const allowedTypes = REQUIRED_PROOF_DOC_TYPES[reason];

    if (!allowedTypes) {
      return true;
    }

    if (!proofDocument || !proofDocument.documentId || !proofDocument.documentType || !proofDocument.issuedAt) {
      return false;
    }

    return allowedTypes.includes(proofDocument.documentType);
  }

  defaultMessage(args: ValidationArguments): string {
    return `Provided proof document is missing or incompatible with cancellation reason '${(args.object as any).cancellationReason}'`;
  }
}

export function IsValidProofForReason(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    RegisterDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsValidProofForReasonConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'IsLineItemSumValidConstraint', async: false })
export class IsLineItemSumValidConstraint implements ValidatorConstraintInterface {
  validate(lineItems: any[], args: ValidationArguments): boolean {
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return false;
    }
    const dto = args.object as any;
    const priorRefundAmount = dto.priorRefundAmount || 0;
    
    let totalLineItemsAmount = 0;
    let coreBookingCount = 0;

    for (const item of lineItems) {
      if (typeof item.amount !== 'number' || item.amount < 0) {
        return false;
      }
      totalLineItemsAmount += item.amount;
      if (item.itemType === LineItemType.CORE_BOOKING) {
        coreBookingCount++;
      }
    }

    if (coreBookingCount === 0) {
      return false;
    }

    if (priorRefundAmount >= totalLineItemsAmount) {
      return false;
    }

    return true;
  }

  defaultMessage(): string {
    return 'Line items must contain at least one CORE_BOOKING item, have valid amounts, and sum to greater than priorRefundAmount';
  }
}

export function IsLineItemSumValid(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    RegisterDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsLineItemSumValidConstraint,
    });
  };
}

export class DocumentProofDto {
  @IsString()
  documentId!: string;

  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @Type(() => Date)
  @IsDate()
  issuedAt!: Date;

  @IsString()
  fileUrl!: string;

  @IsBoolean()
  verifiedByAdmin!: boolean;
}

export class BookingLineItemDto {
  @IsString()
  itemId!: string;

  @IsEnum(LineItemType)
  itemType!: LineItemType;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsNumber()
  @Min(0)
  taxAmount!: number;

  @IsBoolean()
  isNonRefundableOverride!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  customNonRefundableFee?: number;
}

export class CancellationRequestDto {
  @IsString()
  bookingId!: string;

  @IsString()
  customerId!: string;

  @IsEnum(CustomerTier)
  customerTier!: CustomerTier;

  @IsEnum(CancellationReason)
  cancellationReason!: CancellationReason;

  @IsEnum(Currency)
  currency!: Currency;

  @Type(() => Date)
  @IsDate()
  bookingTimestamp!: Date;

  @Type(() => Date)
  @IsDate()
  @IsAfterDate('bookingTimestamp')
  serviceStartTimestamp!: Date;

  @Type(() => Date)
  @IsDate()
  @IsAfterDate('bookingTimestamp')
  cancellationTimestamp!: Date;

  @IsBoolean()
  isPeakSeason!: boolean;

  @IsBoolean()
  requestedStoreCredit!: boolean;

  @IsNumber()
  @Min(0)
  priorRefundAmount!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingLineItemDto)
  @ArrayMinSize(1)
  @IsLineItemSumValid()
  lineItems!: BookingLineItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentProofDto)
  @IsValidProofForReason()
  proofDocument?: DocumentProofDto;
}

export class LineItemRefundBreakdownDto {
  itemId!: string;
  itemType!: LineItemType;
  originalAmount!: number;
  originalTaxAmount!: number;
  grossRefundableAmount!: number;
  penaltyAmount!: number;
  netRefundAmount!: number;
  taxRefundAmount!: number;
  appliedPenaltyPercentage!: number;
  rejectionReason?: string;
}

export class CancellationPenaltySummaryDto {
  bookingId!: string;
  customerId!: string;
  currency!: Currency;
  customerTier!: CustomerTier;
  cancellationReason!: CancellationReason;
  hoursBeforeStart!: number;
  isNoShow!: boolean;
  basePenaltyPercentage!: number;
  tierPenaltyDiscountPercentage!: number;
  reasonWaiverPercentage!: number;
  effectivePenaltyPercentage!: number;
  totalOriginalAmount!: number;
  totalOriginalTax!: number;
  totalGrossRefundable!: number;
  totalPenaltyAmount!: number;
  totalTaxRefundAmount!: number;
  priorRefundDeducted!: number;
  netCashRefundAmount!: number;
  storeCreditBonusAmount!: number;
  finalRefundValueTotal!: number;
  lineItemBreakdowns!: LineItemRefundBreakdownDto[];
  specialConditionsApplied!: string[];
}

export class CancellationPenaltyEngine {
  public calculateCancellation(request: CancellationRequestDto): CancellationPenaltySummaryDto {
    const {
      bookingId,
      customerId,
      customerTier,
      cancellationReason,
      currency,
      serviceStartTimestamp,
      cancellationTimestamp,
      isPeakSeason,
      requestedStoreCredit,
      priorRefundAmount,
      lineItems,
      proofDocument,
    } = request;

    const diffMs = serviceStartTimestamp.getTime() - cancellationTimestamp.getTime();
    const hoursBeforeStart = diffMs / (1000 * 60 * 60);
    const isNoShow = hoursBeforeStart <= 0;

    const specialConditions: string[] = [];

    const { penalty: basePenaltyPercent, condition: peakCondition } = applyPeakSeasonSurge(
      this.determineBasePenaltyPercentage(hoursBeforeStart, isNoShow),
      isPeakSeason
    );
    if (peakCondition) specialConditions.push(peakCondition);

    const tierDiscountPercent = this.determineTierDiscount(customerTier, hoursBeforeStart);
    if (tierDiscountPercent > 0) {
      specialConditions.push(`CUSTOMER_TIER_DISCOUNT_${customerTier} (${tierDiscountPercent}% discount on penalty)`);
    }

    const reasonWaiverPercent = this.determineReasonWaiver(cancellationReason, proofDocument, hoursBeforeStart, cancellationTimestamp, serviceStartTimestamp);
    if (reasonWaiverPercent > 0) {
      specialConditions.push(`CANCELLATION_REASON_WAIVER_${cancellationReason} (${reasonWaiverPercent}% waiver applied)`);
    }

    let effectivePenaltyPercent = Math.max(0, Math.min(100, basePenaltyPercent * (1 - tierDiscountPercent / 100) * (1 - reasonWaiverPercent / 100)));

    if (MERCHANT_OR_SYSTEM_FAULT_REASONS.has(cancellationReason)) {
      effectivePenaltyPercent = 0;
      specialConditions.push('FULL_REFUND_MERCHANT_OR_SYSTEM_FAULT');
    }

    const lineItemBreakdowns = lineItems.map((item) =>
      this.processLineItem(item, effectivePenaltyPercent, cancellationReason, hoursBeforeStart, customerTier)
    );

    lineItemBreakdowns
      .filter((b) => b.rejectionReason)
      .forEach((b) => specialConditions.push(`ITEM_OVERRIDE_${b.itemId}: ${b.rejectionReason}`));

    const totalOriginalAmount = lineItems.reduce((acc, item) => acc + item.amount, 0);
    const totalOriginalTax = lineItems.reduce((acc, item) => acc + item.taxAmount, 0);
    const totalGrossRefundable = lineItemBreakdowns.reduce((acc, b) => acc + b.grossRefundableAmount, 0);
    const totalPenaltyAmount = lineItemBreakdowns.reduce((acc, b) => acc + b.penaltyAmount, 0);
    const totalTaxRefundAmount = lineItemBreakdowns.reduce((acc, b) => acc + b.taxRefundAmount, 0);

    let netCashRefund = totalGrossRefundable - totalPenaltyAmount;

    const { deduction: priorRefundDeduction, condition: priorCondition } = calculatePriorRefundDeduction(priorRefundAmount, netCashRefund, currency);
    netCashRefund -= priorRefundDeduction;
    if (priorCondition) specialConditions.push(priorCondition);

    const { bonus: storeCreditBonus, condition: bonusCondition } = calculateStoreCreditBonus(
      requestedStoreCredit,
      netCashRefund,
      customerTier,
      this.roundToTwoDecimals
    );
    if (bonusCondition) specialConditions.push(bonusCondition);

    const finalRefundValueTotal = this.roundToTwoDecimals(netCashRefund + storeCreditBonus + totalTaxRefundAmount);

    return {
      bookingId,
      customerId,
      currency,
      customerTier,
      cancellationReason,
      hoursBeforeStart: this.roundToTwoDecimals(hoursBeforeStart),
      isNoShow,
      basePenaltyPercentage: this.roundToTwoDecimals(basePenaltyPercent),
      tierPenaltyDiscountPercentage: this.roundToTwoDecimals(tierDiscountPercent),
      reasonWaiverPercentage: this.roundToTwoDecimals(reasonWaiverPercent),
      effectivePenaltyPercentage: this.roundToTwoDecimals(effectivePenaltyPercent),
      totalOriginalAmount: this.roundToTwoDecimals(totalOriginalAmount),
      totalOriginalTax: this.roundToTwoDecimals(totalOriginalTax),
      totalGrossRefundable: this.roundToTwoDecimals(totalGrossRefundable),
      totalPenaltyAmount: this.roundToTwoDecimals(totalPenaltyAmount),
      totalTaxRefundAmount: this.roundToTwoDecimals(totalTaxRefundAmount),
      priorRefundDeducted: this.roundToTwoDecimals(priorRefundDeduction),
      netCashRefundAmount: this.roundToTwoDecimals(netCashRefund),
      storeCreditBonusAmount: this.roundToTwoDecimals(storeCreditBonus),
      finalRefundValueTotal,
      lineItemBreakdowns,
      specialConditionsApplied: Array.from(new Set(specialConditions)),
    };
  }

  private determineBasePenaltyPercentage(hoursBeforeStart: number, isNoShow: boolean): number {
    if (isNoShow) {
      return 100;
    }
    if (hoursBeforeStart >= 168) {
      return 0;
    } else if (hoursBeforeStart >= 72) {
      return 15;
    } else if (hoursBeforeStart >= 48) {
      return 30;
    } else if (hoursBeforeStart >= 24) {
      return 50;
    } else if (hoursBeforeStart >= 12) {
      return 75;
    } else {
      return 90;
    }
  }

  private determineTierDiscount(tier: CustomerTier, hoursBeforeStart: number): number {
    const rule = TIER_DISCOUNT_RULES[tier];
    return rule ? rule(hoursBeforeStart) : 0;
  }

  private determineReasonWaiver(
    reason: CancellationReason,
    proofDocument: DocumentProofDto | undefined,
    hoursBeforeStart: number,
    cancellationTimestamp: Date,
    serviceStartTimestamp: Date
  ): number {
    const handler = REASON_WAIVER_HANDLERS[reason];
    return handler ? handler(proofDocument, hoursBeforeStart) : 0;
  }

  private processLineItem(
    item: BookingLineItemDto,
    effectivePenaltyPercent: number,
    reason: CancellationReason,
    hoursBeforeStart: number,
    tier: CustomerTier
  ): LineItemRefundBreakdownDto {
    const breakdown: LineItemRefundBreakdownDto = {
      itemId: item.itemId,
      itemType: item.itemType,
      originalAmount: item.amount,
      originalTaxAmount: item.taxAmount,
      grossRefundableAmount: item.amount,
      penaltyAmount: 0,
      netRefundAmount: 0,
      taxRefundAmount: 0,
      appliedPenaltyPercentage: effectivePenaltyPercent,
    };

    if (item.isNonRefundableOverride) {
      setZeroRefund(breakdown, 100, 'ITEM_MARKED_NON_REFUNDABLE_OVERRIDE');
      return breakdown;
    }

    if (MERCHANT_OR_SYSTEM_FAULT_REASONS.has(reason)) {
      setFullRefund(breakdown, item);
      return breakdown;
    }

    const processor = LINE_ITEM_PROCESSORS[item.itemType] || LINE_ITEM_PROCESSORS[LineItemType.CORE_BOOKING];
    processor({ item, breakdown, reason, hoursBeforeStart, tier, roundFn: this.roundToTwoDecimals });

    return breakdown;
  }

  private roundToTwoDecimals(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }
}