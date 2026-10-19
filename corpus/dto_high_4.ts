import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsArray,
  IsDateString,
  IsBoolean,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  IsNotEmpty,
  IsDefined,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum CurrencyCode {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  JPY = 'JPY',
  CAD = 'CAD',
  AUD = 'AUD',
  CHF = 'CHF',
  SGD = 'SGD',
  HKD = 'HKD',
}

export enum RoundingMode {
  HALF_UP = 'HALF_UP',
  HALF_EVEN = 'HALF_EVEN',
  FLOOR = 'FLOOR',
  CEIL = 'CEIL',
}

export enum TaxType {
  VAT = 'VAT',
  GST = 'GST',
  SALES_TAX = 'SALES_TAX',
  WITHHOLDING = 'WITHHOLDING',
  ZERO_RATED = 'ZERO_RATED',
  EXEMPT = 'EXEMPT',
}

export enum DisputeReason {
  PRICE_MISMATCH = 'PRICE_MISMATCH',
  QUANTITY_MISMATCH = 'QUANTITY_MISMATCH',
  TAX_CALCULATION_ERROR = 'TAX_CALCULATION_ERROR',
  FX_RATE_MISMATCH = 'FX_RATE_MISMATCH',
  UNAUTHORIZED_FEE = 'UNAUTHORIZED_FEE',
  DUPLICATE = 'DUPLICATE',
}

export enum DisputeStatus {
  OPEN = 'OPEN',
  UNDER_INVESTIGATION = 'UNDER_INVESTIGATION',
  RESOLVED_CREDIT_MEMO = 'RESOLVED_CREDIT_MEMO',
  RESOLVED_WAIVED = 'RESOLVED_WAIVED',
  REJECTED = 'REJECTED',
}

export enum PaymentMethod {
  WIRE = 'WIRE',
  ACH = 'ACH',
  CREDIT_CARD = 'CREDIT_CARD',
  DIRECT_DEBIT = 'DIRECT_DEBIT',
  SEPA = 'SEPA',
}

function getCurrencyDecimals(currency: CurrencyCode): number {
  switch (currency) {
    case CurrencyCode.JPY:
      return 0;
    case CurrencyCode.USD:
    case CurrencyCode.EUR:
    case CurrencyCode.GBP:
    case CurrencyCode.CAD:
    case CurrencyCode.AUD:
    case CurrencyCode.CHF:
    case CurrencyCode.SGD:
    case CurrencyCode.HKD:
    default:
      return 2;
  }
}

function roundMoney(value: number, decimals: number, mode: RoundingMode): number {
  const factor = Math.pow(10, decimals);
  const n = value * factor;
  let rounded: number;
  switch (mode) {
    case RoundingMode.FLOOR:
      rounded = Math.floor(n + 1e-9);
      break;
    case RoundingMode.CEIL:
      rounded = Math.ceil(n - 1e-9);
      break;
    case RoundingMode.HALF_EVEN: {
      const floorVal = Math.floor(n);
      const diff = n - floorVal;
      if (Math.abs(diff - 0.5) < 1e-9) {
        rounded = floorVal % 2 === 0 ? floorVal : floorVal + 1;
      } else {
        rounded = Math.round(n);
      }
      break;
    }
    case RoundingMode.HALF_UP:
    default:
      rounded = Math.round(n);
      break;
  }
  return rounded / factor;
}

export class FXRateDto {
  @IsEnum(CurrencyCode)
  fromCurrency!: CurrencyCode;

  @IsEnum(CurrencyCode)
  toCurrency!: CurrencyCode;

  @IsNumber()
  @Min(0.000001)
  rate!: number;

  @IsDateString()
  effectiveDate!: string;

  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  invertedRate?: number;
}

export class TaxDetailDto {
  @IsEnum(TaxType)
  taxType!: TaxType;

  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent!: number;

  @IsNumber()
  @Min(0)
  taxableAmount!: number;

  @IsNumber()
  @Min(0)
  taxAmount!: number;

  @IsString()
  @IsNotEmpty()
  taxJurisdiction!: string;

  @IsBoolean()
  isExempt!: boolean;

  @IsOptional()
  @IsString()
  exemptionReason?: string;
}

export class InvoiceLineItemDto {
  @IsString()
  @IsNotEmpty()
  lineId!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  discountAmount!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxDetailDto)
  taxDetails!: TaxDetailDto[];

  @IsNumber()
  @Min(0)
  netAmount!: number;

  @IsNumber()
  @Min(0)
  grossAmount!: number;

  @IsOptional()
  @IsString()
  matchedPaymentLineId?: string;
}

export class InvoiceDisputeDto {
  @IsString()
  @IsNotEmpty()
  disputeId!: string;

  @IsOptional()
  @IsString()
  lineItemId?: string;

  @IsEnum(DisputeReason)
  reason!: DisputeReason;

  @IsEnum(DisputeStatus)
  status!: DisputeStatus;

  @IsNumber()
  @Min(0.01)
  disputedAmount!: number;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsDateString()
  raisedAt!: string;

  @IsOptional()
  @IsDateString()
  resolvedAt?: string;

  @IsNumber()
  @Min(0)
  resolutionAmount!: number;
}

export class PaymentAllocationDto {
  @IsString()
  @IsNotEmpty()
  paymentId!: string;

  @IsEnum(CurrencyCode)
  paymentCurrency!: CurrencyCode;

  @IsNumber()
  @Min(0.01)
  allocatedAmount!: number;

  @IsNumber()
  @Min(0.000001)
  fxRateUsed!: number;

  @IsNumber()
  @Min(0)
  allocatedAmountInInvoiceCurrency!: number;

  @IsNumber()
  @Min(0)
  bankFeeAmount!: number;

  @IsBoolean()
  bankFeeAbsorbedBySupplier!: boolean;

  @IsDateString()
  paymentDate!: string;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsString()
  @IsNotEmpty()
  transactionReference!: string;
}

@ValidatorConstraint({ name: 'IsFXRateMapValidConstraint', async: false })
export class IsFXRateMapValidConstraint implements ValidatorConstraintInterface {
  validate(rates: FXRateDto[], args: ValidationArguments): boolean {
    if (!Array.isArray(rates)) return false;
    for (let i = 0; i < rates.length; i++) {
      const rateA = rates[i];
      if (rateA.fromCurrency === rateA.toCurrency) {
        if (Math.abs(rateA.rate - 1.0) > 0.000001) return false;
      }
      if (rateA.invertedRate) {
        const product = rateA.rate * rateA.invertedRate;
        if (Math.abs(product - 1.0) > 0.01) return false;
      }
      for (let j = i + 1; j < rates.length; j++) {
        const rateB = rates[j];
        if (
          rateA.fromCurrency === rateB.toCurrency &&
          rateA.toCurrency === rateB.fromCurrency
        ) {
          const directProduct = rateA.rate * rateB.rate;
          if (Math.abs(directProduct - 1.0) > 0.02) return false;
        }
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return 'FX rates matrix contains invalid, zero, or inconsistent reciprocal currency conversion pairs.';
  }
}

@ValidatorConstraint({ name: 'IsLineItemMathValidConstraint', async: false })
export class IsLineItemMathValidConstraint implements ValidatorConstraintInterface {
  validate(lineItems: InvoiceLineItemDto[], args: ValidationArguments): boolean {
    if (!Array.isArray(lineItems) || lineItems.length === 0) return false;
    const parentObj = args.object as any;
    const currency: CurrencyCode = parentObj.supplierCurrency || CurrencyCode.USD;
    const mode: RoundingMode = parentObj.roundingMode || RoundingMode.HALF_UP;
    const decimals = getCurrencyDecimals(currency);

    for (const item of lineItems) {
      const expectedRawNet = item.quantity * item.unitPrice - item.discountAmount;
      if (expectedRawNet < 0) return false;

      const computedNet = roundMoney(expectedRawNet, decimals, mode);
      if (Math.abs(computedNet - item.netAmount) > 0.01) return false;

      let computedTaxSum = 0;
      if (Array.isArray(item.taxDetails)) {
        for (const tax of item.taxDetails) {
          if (tax.isExempt || tax.taxType === TaxType.ZERO_RATED || tax.taxType === TaxType.EXEMPT) {
            if (tax.taxAmount !== 0) return false;
            if (tax.isExempt && !tax.exemptionReason) return false;
          } else {
            const computedTax = roundMoney((tax.taxableAmount * tax.ratePercent) / 100, decimals, mode);
            if (Math.abs(computedTax - tax.taxAmount) > 0.02) return false;
          }
          if (tax.taxType !== TaxType.WITHHOLDING) {
            computedTaxSum += tax.taxAmount;
          }
        }
      }

      const computedGross = roundMoney(computedNet + computedTaxSum, decimals, mode);
      if (Math.abs(computedGross - item.grossAmount) > 0.02) return false;
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return 'One or more invoice line items fail precision math verification (net, discount, tax, or gross mismatch).';
  }
}

@ValidatorConstraint({ name: 'IsInvoiceReconciliationValidConstraint', async: false })
export class IsInvoiceReconciliationValidConstraint implements ValidatorConstraintInterface {
  validate(dto: any, args: ValidationArguments): boolean {
    if (!dto) return false;

    const supplierCurrency: CurrencyCode = dto.supplierCurrency;
    const customerCurrency: CurrencyCode = dto.customerCurrency;
    const reconciliationCurrency: CurrencyCode = dto.reconciliationCurrency;
    const mode: RoundingMode = dto.roundingMode || RoundingMode.HALF_UP;
    const tolerance: number = dto.toleranceThreshold ?? 0.05;
    const decimals = getCurrencyDecimals(reconciliationCurrency);

    const lineItems: InvoiceLineItemDto[] = dto.lineItems || [];
    const payments: PaymentAllocationDto[] = dto.payments || [];
    const disputes: InvoiceDisputeDto[] = dto.disputes || [];
    const fxRates: FXRateDto[] = dto.fxRates || [];

    let calculatedNetSum = 0;
    let calculatedTaxSum = 0;
    let calculatedGrossSum = 0;

    const lineItemMap = new Map<string, InvoiceLineItemDto>();

    for (const item of lineItems) {
      calculatedNetSum += item.netAmount;
      calculatedGrossSum += item.grossAmount;
      lineItemMap.set(item.lineId, item);

      if (Array.isArray(item.taxDetails)) {
        for (const tax of item.taxDetails) {
          if (tax.taxType !== TaxType.WITHHOLDING) {
            calculatedTaxSum += tax.taxAmount;
          }
        }
      }
    }

    const roundedNetSum = roundMoney(calculatedNetSum, decimals, mode);
    const roundedTaxSum = roundMoney(calculatedTaxSum, decimals, mode);
    const roundedGrossSum = roundMoney(calculatedGrossSum, decimals, mode);

    if (Math.abs(roundedNetSum - dto.totalNetAmount) > 0.05) return false;
    if (Math.abs(roundedTaxSum - dto.totalTaxAmount) > 0.05) return false;
    if (Math.abs(roundedGrossSum - dto.totalGrossAmount) > 0.05) return false;

    let totalDisputeAdjustments = 0;
    for (const dispute of disputes) {
      if (dispute.lineItemId) {
        const matchedItem = lineItemMap.get(dispute.lineItemId);
        if (!matchedItem) return false;
        if (dispute.disputedAmount > matchedItem.grossAmount + 0.01) return false;
      } else {
        if (dispute.disputedAmount > dto.totalGrossAmount + 0.01) return false;
      }

      switch (dispute.status) {
        case DisputeStatus.RESOLVED_CREDIT_MEMO:
        case DisputeStatus.RESOLVED_WAIVED:
          if (dispute.resolutionAmount <= 0) return false;
          if (dispute.resolutionAmount > dispute.disputedAmount + 0.01) return false;
          if (!dispute.resolvedAt) return false;
          totalDisputeAdjustments += dispute.resolutionAmount;
          break;
        case DisputeStatus.REJECTED:
          if (dispute.resolutionAmount !== 0) return false;
          break;
        case DisputeStatus.OPEN:
        case DisputeStatus.UNDER_INVESTIGATION:
          if (dispute.resolutionAmount !== 0) return false;
          break;
        default:
          return false;
      }
    }

    let totalEffectivePaidInInvoiceCurrency = 0;

    for (const payment of payments) {
      if (payment.paymentCurrency === supplierCurrency) {
        if (Math.abs(payment.fxRateUsed - 1.0) > 0.0001) return false;
        if (Math.abs(payment.allocatedAmount - payment.allocatedAmountInInvoiceCurrency) > 0.01) return false;
      } else {
        const expectedInvoiceAmount = payment.allocatedAmount * payment.fxRateUsed;
        const roundedExpected = roundMoney(expectedInvoiceAmount, decimals, mode);
        if (Math.abs(roundedExpected - payment.allocatedAmountInInvoiceCurrency) > 0.05) return false;

        let fxFound = false;
        for (const rate of fxRates) {
          if (rate.fromCurrency === payment.paymentCurrency && rate.toCurrency === supplierCurrency) {
            if (Math.abs(rate.rate - payment.fxRateUsed) < 0.05) {
              fxFound = true;
              break;
            }
          }
        }
        if (!fxFound && fxRates.length > 0) return false;
      }

      let netPaymentContribution = payment.allocatedAmountInInvoiceCurrency;
      if (payment.bankFeeAmount > 0) {
        if (payment.bankFeeAbsorbedBySupplier) {
          netPaymentContribution -= payment.bankFeeAmount;
        }
      }

      totalEffectivePaidInInvoiceCurrency += netPaymentContribution;
    }

    const netTargetToSettle = dto.totalGrossAmount - totalDisputeAdjustments;
    const remainingBalance = netTargetToSettle - totalEffectivePaidInInvoiceCurrency;

    if (remainingBalance > tolerance) {
      return false;
    }

    if (remainingBalance < -tolerance) {
      return false;
    }

    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return 'Invoice reconciliation audit failed due to line sum discrepancy, dispute invalidity, FX mismatch, or tolerance threshold breach.';
  }
}

export class InvoiceReconciliationRequestDto {
  @IsString()
  @IsNotEmpty()
  invoiceId!: string;

  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsDateString()
  issueDate!: string;

  @IsDateString()
  dueDate!: string;

  @IsEnum(CurrencyCode)
  supplierCurrency!: CurrencyCode;

  @IsEnum(CurrencyCode)
  customerCurrency!: CurrencyCode;

  @IsEnum(CurrencyCode)
  reconciliationCurrency!: CurrencyCode;

  @IsEnum(RoundingMode)
  roundingMode!: RoundingMode;

  @IsNumber()
  @Min(0)
  @Max(100)
  toleranceThreshold!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FXRateDto)
  @Validate(IsFXRateMapValidConstraint)
  fxRates!: FXRateDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  @Validate(IsLineItemMathValidConstraint)
  lineItems!: InvoiceLineItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  payments!: PaymentAllocationDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceDisputeDto)
  disputes!: InvoiceDisputeDto[];

  @IsNumber()
  @Min(0)
  totalNetAmount!: number;

  @IsNumber()
  @Min(0)
  totalTaxAmount!: number;

  @IsNumber()
  @Min(0)
  totalGrossAmount!: number;

  @Validate(IsInvoiceReconciliationValidConstraint)
  reconciliationValidationTrigger!: boolean;
}
