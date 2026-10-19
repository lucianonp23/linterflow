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

    if (
      reason === CancellationReason.MEDICAL_EMERGENCY ||
      reason === CancellationReason.FORCE_MAJEURE ||
      reason === CancellationReason.FLIGHT_DELAY_CANCELLED ||
      reason === CancellationReason.WEATHER_EVENT
    ) {
      if (!proofDocument) {
        return false;
      }
      if (!proofDocument.documentId || !proofDocument.documentType || !proofDocument.issuedAt) {
        return false;
      }

      if (reason === CancellationReason.MEDICAL_EMERGENCY && proofDocument.documentType !== DocumentType.MEDICAL_CERTIFICATE) {
        return false;
      }
      if (reason === CancellationReason.FLIGHT_DELAY_CANCELLED && proofDocument.documentType !== DocumentType.FLIGHT_CANCEL_NOTICE) {
        return false;
      }
      if (reason === CancellationReason.WEATHER_EVENT && proofDocument.documentType !== DocumentType.WEATHER_ALERT) {
        return false;
      }
      if (
        reason === CancellationReason.FORCE_MAJEURE &&
        proofDocument.documentType !== DocumentType.OFFICIAL_DECREE &&
        proofDocument.documentType !== DocumentType.POLICE_REPORT
      ) {
        return false;
      }
    }
    return true;
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
      bookingTimestamp,
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

    const reasonWaiverPercent = this.determineReasonWaiver(cancellationReason, proofDocument, hoursBeforeStart, cancellationTimestamp, serviceStartTimestamp);
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
    hoursBeforeStart: number,
    cancellationTimestamp: Date,
    serviceStartTimestamp: Date
  ): number {
    switch (reason) {
      case CancellationReason.MEDICAL_EMERGENCY:
        return proofDocument && proofDocument.verifiedByAdmin ? 100 : proofDocument ? 80 : 0;

      case CancellationReason.FORCE_MAJEURE:
        return proofDocument ? 100 : 50;

      case CancellationReason.FLIGHT_DELAY_CANCELLED:
        return proofDocument ? 75 : 25;

      case CancellationReason.WEATHER_EVENT:
        return proofDocument ? 75 : 30;

      case CancellationReason.SERVICE_DISSATISFACTION:
        if (hoursBeforeStart < 0 && Math.abs(hoursBeforeStart) <= 24) {
          return 50;
        }
        return 0;

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
      breakdown.appliedPenaltyPercentage = 100;
      breakdown.penaltyAmount = item.amount;
      breakdown.netRefundAmount = 0;
      breakdown.taxRefundAmount = 0;
      breakdown.rejectionReason = 'ITEM_MARKED_NON_REFUNDABLE_OVERRIDE';
      return breakdown;
    }

    if (reason === CancellationReason.MERCHANT_CANCELLED || reason === CancellationReason.FRAUD_OR_SYSTEM_ERROR) {
      breakdown.appliedPenaltyPercentage = 0;
      breakdown.penaltyAmount = 0;
      breakdown.netRefundAmount = item.amount;
      breakdown.taxRefundAmount = item.taxAmount;
      return breakdown;
    }

    switch (item.itemType) {
      case LineItemType.INSURANCE:
        breakdown.appliedPenaltyPercentage = 100;
        breakdown.penaltyAmount = item.amount;
        breakdown.netRefundAmount = 0;
        breakdown.taxRefundAmount = 0;
        breakdown.rejectionReason = 'INSURANCE_PREMIUM_NON_REFUNDABLE';
        break;

      case LineItemType.DEPOSIT:
        if (
          reason === CancellationReason.MEDICAL_EMERGENCY ||
          reason === CancellationReason.FORCE_MAJEURE ||
          tier === CustomerTier.VIP
        ) {
          breakdown.appliedPenaltyPercentage = 0;
          breakdown.penaltyAmount = 0;
          breakdown.netRefundAmount = item.amount;
          breakdown.taxRefundAmount = item.taxAmount;
        } else {
          breakdown.appliedPenaltyPercentage = 100;
          breakdown.penaltyAmount = item.amount;
          breakdown.netRefundAmount = 0;
          breakdown.taxRefundAmount = 0;
          breakdown.rejectionReason = 'DEPOSIT_FORFEITED';
        }
        break;

      case LineItemType.SERVICE_FEE:
        if (hoursBeforeStart >= 72) {
          breakdown.appliedPenaltyPercentage = 0;
          breakdown.penaltyAmount = 0;
          breakdown.netRefundAmount = item.amount;
          breakdown.taxRefundAmount = item.taxAmount;
        } else {
          breakdown.appliedPenaltyPercentage = 100;
          breakdown.penaltyAmount = item.amount;
          breakdown.netRefundAmount = 0;
          breakdown.taxRefundAmount = 0;
          breakdown.rejectionReason = 'SERVICE_FEE_NON_REFUNDABLE_WITHIN_72H';
        }
        break;

      case LineItemType.ADD_ON:
        if (hoursBeforeStart < 24 && tier !== CustomerTier.VIP && tier !== CustomerTier.PLATINUM) {
          breakdown.appliedPenaltyPercentage = 100;
          breakdown.penaltyAmount = item.amount;
          breakdown.netRefundAmount = 0;
          breakdown.taxRefundAmount = 0;
          breakdown.rejectionReason = 'ADD_ON_NON_REFUNDABLE_WITHIN_24H';
        } else {
          breakdown.penaltyAmount = this.roundToTwoDecimals(item.amount * (breakdown.appliedPenaltyPercentage / 100));
          breakdown.netRefundAmount = this.roundToTwoDecimals(item.amount - breakdown.penaltyAmount);
          const refundRatio = item.amount > 0 ? breakdown.netRefundAmount / item.amount : 0;
          breakdown.taxRefundAmount = this.roundToTwoDecimals(item.taxAmount * refundRatio);
        }
        break;

      case LineItemType.CORE_BOOKING:
      default:
        let calculatedPenalty = item.amount * (breakdown.appliedPenaltyPercentage / 100);
        if (item.customNonRefundableFee && item.customNonRefundableFee > 0) {
          calculatedPenalty = Math.max(calculatedPenalty, item.customNonRefundableFee);
          if (calculatedPenalty > item.amount) {
            calculatedPenalty = item.amount;
          }
          breakdown.rejectionReason = 'CUSTOM_MINIMUM_NON_REFUNDABLE_FEE_APPLIED';
        }
        breakdown.penaltyAmount = this.roundToTwoDecimals(calculatedPenalty);
        breakdown.netRefundAmount = this.roundToTwoDecimals(item.amount - breakdown.penaltyAmount);
        const ratio = item.amount > 0 ? breakdown.netRefundAmount / item.amount : 0;
        breakdown.taxRefundAmount = this.roundToTwoDecimals(item.taxAmount * ratio);
        break;
    }

    return breakdown;
  }

  private roundToTwoDecimals(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }
}
