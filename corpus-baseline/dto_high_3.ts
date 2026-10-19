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
  ArrayMinSize,
  RegisterDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

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

@ValidatorConstraint({ name: 'IsAfterDateConstraint', async: false })
export class IsAfterDateConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: unknown, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];

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
  private static readonly REQUIRED_DOCUMENT_TYPES: Partial<Record<CancellationReason, DocumentType[]>> = {
    [CancellationReason.MEDICAL_EMERGENCY]: [DocumentType.MEDICAL_CERTIFICATE],
    [CancellationReason.FLIGHT_DELAY_CANCELLED]: [DocumentType.FLIGHT_CANCEL_NOTICE],
    [CancellationReason.WEATHER_EVENT]: [DocumentType.WEATHER_ALERT],
    [CancellationReason.FORCE_MAJEURE]: [DocumentType.OFFICIAL_DECREE, DocumentType.POLICE_REPORT],
  };

  validate(proofDocument: any, args: ValidationArguments): boolean {
    const dto = args.object as Record<string, unknown>;
    const reason = dto.cancellationReason as CancellationReason;
    const allowedTypes = IsValidProofForReasonConstraint.REQUIRED_DOCUMENT_TYPES[reason];

    if (!allowedTypes) {
      return true;
    }

    if (!proofDocument || !proofDocument.documentId || !proofDocument.documentType || !proofDocument.issuedAt) {
      return false;
    }

    return allowedTypes.includes(proofDocument.documentType);
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as Record<string, unknown>;
    return `Provided proof document is missing or incompatible with cancellation reason '${dto.cancellationReason}'`;
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

    const dto = args.object as Record<string, any>;
    const priorRefundAmount = dto.priorRefundAmount || 0;

    let totalLineItemsAmount = 0;
    let coreBookingCount = 0;

    for (const item of lineItems) {
      if (!item || typeof item.amount !== 'number' || item.amount < 0) {
        return false;
      }
      totalLineItemsAmount += item.amount;
      if (item.itemType === LineItemType.CORE_BOOKING) {
        coreBookingCount++;
      }
    }

    return coreBookingCount > 0 && priorRefundAmount < totalLineItemsAmount;
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

    const specialConditions: string[] = [];
    const diffMs = serviceStartTimestamp.getTime() - cancellationTimestamp.getTime();
    const hoursBeforeStart = diffMs / (1000 * 60 * 60);
    const isNoShow = hoursBeforeStart <= 0;

    let basePenaltyPercent = this.determineBasePenaltyPercentage(hoursBeforeStart, isNoShow);

    if (isPeakSeason && basePenaltyPercent > 0 && basePenaltyPercent < 100) {
      basePenaltyPercent = Math.min(100, basePenaltyPercent * 1.25);
      specialConditions.push('PEAK_SEASON_SURGE_PENALTY_APPLIED (+25% to base penalty)');
    }

    const tierDiscountPercent = this.determineTierDiscount(customerTier, hoursBeforeStart);
    if (tierDiscountPercent > 0) {
      specialConditions.push(`CUSTOMER_TIER_DISCOUNT_${customerTier} (${tierDiscountPercent}% discount on penalty)`);
    }

    const reasonWaiverPercent = this.determineReasonWaiver(cancellationReason, proofDocument, hoursBeforeStart);
    if (reasonWaiverPercent > 0) {
      specialConditions.push(`CANCELLATION_REASON_WAIVER_${cancellationReason} (${reasonWaiverPercent}% waiver applied)`);
    }

    let effectivePenaltyPercent = basePenaltyPercent * (1 - tierDiscountPercent / 100) * (1 - reasonWaiverPercent / 100);
    effectivePenaltyPercent = Math.max(0, Math.min(100, effectivePenaltyPercent));

    if (cancellationReason === CancellationReason.MERCHANT_CANCELLED || cancellationReason === CancellationReason.FRAUD_OR_SYSTEM_ERROR) {
      effectivePenaltyPercent = 0;
      specialConditions.push('FULL_REFUND_MERCHANT_OR_SYSTEM_FAULT');
    }

    let totalOriginalAmount = 0;
    let totalOriginalTax = 0;
    let totalGrossRefundable = 0;
    let totalPenaltyAmount = 0;
    let totalTaxRefundAmount = 0;

    const lineItemBreakdowns: LineItemRefundBreakdownDto[] = [];

    for (const item of lineItems) {
      totalOriginalAmount += item.amount;
      totalOriginalTax += item.taxAmount;

      const breakdown = this.processLineItem(
        item,
        effectivePenaltyPercent,
        cancellationReason,
        hoursBeforeStart,
        customerTier
      );

      if (breakdown.rejectionReason) {
        specialConditions.push(`ITEM_OVERRIDE_${item.itemId}: ${breakdown.rejectionReason}`);
      }

      totalGrossRefundable += breakdown.grossRefundableAmount;
      totalPenaltyAmount += breakdown.penaltyAmount;
      totalTaxRefundAmount += breakdown.taxRefundAmount;

      lineItemBreakdowns.push(breakdown);
    }

    let netCashRefund = totalGrossRefundable - totalPenaltyAmount;

    let priorRefundDeduction = 0;
    if (priorRefundAmount > 0) {
      priorRefundDeduction = Math.min(netCashRefund, priorRefundAmount);
      netCashRefund -= priorRefundDeduction;
      specialConditions.push(`PRIOR_REFUND_DEDUCTED (${priorRefundDeduction} ${currency})`);
    }

    let storeCreditBonus = 0;
    if (requestedStoreCredit && netCashRefund > 0) {
      const bonusRate = customerTier === CustomerTier.VIP || customerTier === CustomerTier.PLATINUM ? 0.15 : 0.10;
      storeCreditBonus = this.roundToTwoDecimals(netCashRefund * bonusRate);
      specialConditions.push(`STORE_CREDIT_INCENTIVE_BONUS (+${bonusRate * 100}% extra value as store credit)`);
    }

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
    if (isNoShow) return 100;
    if (hoursBeforeStart >= 168) return 0;
    if (hoursBeforeStart >= 72) return 15;
    if (hoursBeforeStart >= 48) return 30;
    if (hoursBeforeStart >= 24) return 50;
    if (hoursBeforeStart >= 12) return 75;
    return 90;
  }

  private determineTierDiscount(tier: CustomerTier, hoursBeforeStart: number): number {
    switch (tier) {
      case CustomerTier.VIP:
        return 100;
      case CustomerTier.PLATINUM:
        return hoursBeforeStart >= 12 ? 100 : 50;
      case CustomerTier.GOLD:
        return hoursBeforeStart >= 24 ? 50 : 25;
      case CustomerTier.SILVER:
        return hoursBeforeStart >= 48 ? 25 : 10;
      case CustomerTier.CORPORATE:
        return hoursBeforeStart >= 24 ? 80 : 40;
      case CustomerTier.STANDARD:
      default:
        return 0;
    }
  }

  private determineReasonWaiver(
    reason: CancellationReason,
    proofDocument: DocumentProofDto | undefined,
    hoursBeforeStart: number
  ): number {
    switch (reason) {
      case CancellationReason.MEDICAL_EMERGENCY:
        return proofDocument?.verifiedByAdmin ? 100 : proofDocument ? 80 : 0;
      case CancellationReason.FORCE_MAJEURE:
        return proofDocument ? 100 : 50;
      case CancellationReason.FLIGHT_DELAY_CANCELLED:
        return proofDocument ? 75 : 25;
      case CancellationReason.WEATHER_EVENT:
        return proofDocument ? 75 : 30;
      case CancellationReason.SERVICE_DISSATISFACTION:
        return hoursBeforeStart < 0 && Math.abs(hoursBeforeStart) <= 24 ? 50 : 0;
      case CancellationReason.CHANGE_OF_PLANS:
      default:
        return 0;
    }
  }

  private processLineItem(
    item: BookingLineItemDto,
    effectivePenaltyPercent: number,
    reason: CancellationReason,
    hoursBeforeStart: number,
    tier: CustomerTier
  ): LineItemRefundBreakdownDto {
    const baseBreakdown: LineItemRefundBreakdownDto = {
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
      return this.setZeroRefund(baseBreakdown, 'ITEM_MARKED_NON_REFUNDABLE_OVERRIDE');
    }

    if (reason === CancellationReason.MERCHANT_CANCELLED || reason === CancellationReason.FRAUD_OR_SYSTEM_ERROR) {
      return this.setFullRefund(baseBreakdown);
    }

    switch (item.itemType) {
      case LineItemType.INSURANCE:
        return this.setZeroRefund(baseBreakdown, 'INSURANCE_PREMIUM_NON_REFUNDABLE');

      case LineItemType.DEPOSIT: {
        const isWaived =
          reason === CancellationReason.MEDICAL_EMERGENCY ||
          reason === CancellationReason.FORCE_MAJEURE ||
          tier === CustomerTier.VIP;
        return isWaived ? this.setFullRefund(baseBreakdown) : this.setZeroRefund(baseBreakdown, 'DEPOSIT_FORFEITED');
      }

      case LineItemType.SERVICE_FEE:
        return hoursBeforeStart >= 72
          ? this.setFullRefund(baseBreakdown)
          : this.setZeroRefund(baseBreakdown, 'SERVICE_FEE_NON_REFUNDABLE_WITHIN_72H');

      case LineItemType.ADD_ON: {
        const isNonRefundable = hoursBeforeStart < 24 && tier !== CustomerTier.VIP && tier !== CustomerTier.PLATINUM;
        if (isNonRefundable) {
          return this.setZeroRefund(baseBreakdown, 'ADD_ON_NON_REFUNDABLE_WITHIN_24H');
        }
        return this.applyProportionalRefund(baseBreakdown, item, item.amount * (effectivePenaltyPercent / 100));
      }

      case LineItemType.CORE_BOOKING:
      default: {
        let calculatedPenalty = item.amount * (effectivePenaltyPercent / 100);
        let rejectionReason: string | undefined;

        if (item.customNonRefundableFee && item.customNonRefundableFee > 0) {
          calculatedPenalty = Math.min(item.amount, Math.max(calculatedPenalty, item.customNonRefundableFee));
          rejectionReason = 'CUSTOM_MINIMUM_NON_REFUNDABLE_FEE_APPLIED';
        }

        const breakdown = this.applyProportionalRefund(baseBreakdown, item, calculatedPenalty);
        if (rejectionReason) {
          breakdown.rejectionReason = rejectionReason;
        }
        return breakdown;
      }
    }
  }

  private setZeroRefund(breakdown: LineItemRefundBreakdownDto, rejectionReason: string): LineItemRefundBreakdownDto {
    return {
      ...breakdown,
      appliedPenaltyPercentage: 100,
      penaltyAmount: breakdown.originalAmount,
      netRefundAmount: 0,
      taxRefundAmount: 0,
      rejectionReason,
    };
  }

  private setFullRefund(breakdown: LineItemRefundBreakdownDto): LineItemRefundBreakdownDto {
    return {
      ...breakdown,
      appliedPenaltyPercentage: 0,
      penaltyAmount: 0,
      netRefundAmount: breakdown.originalAmount,
      taxRefundAmount: breakdown.originalTaxAmount,
    };
  }

  private applyProportionalRefund(
    breakdown: LineItemRefundBreakdownDto,
    item: BookingLineItemDto,
    calculatedPenalty: number
  ): LineItemRefundBreakdownDto {
    const penaltyAmount = this.roundToTwoDecimals(calculatedPenalty);
    const netRefundAmount = this.roundToTwoDecimals(item.amount - penaltyAmount);
    const refundRatio = item.amount > 0 ? netRefundAmount / item.amount : 0;
    const taxRefundAmount = this.roundToTwoDecimals(item.taxAmount * refundRatio);

    return {
      ...breakdown,
      penaltyAmount,
      netRefundAmount,
      taxRefundAmount,
    };
  }

  private roundToTwoDecimals(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }
}