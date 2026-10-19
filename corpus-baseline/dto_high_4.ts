import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  return currency === CurrencyCode.JPY ? 0 : 2;
}

function roundMoney(value: number, decimals: number, mode: RoundingMode): number {
  const factor = 10 ** decimals;
  const n = value * factor;

  switch (mode) {
    case RoundingMode.FLOOR:
      return Math.floor(n + 1e-9) / factor;
    case RoundingMode.CEIL:
      return Math.ceil(n - 1e-9) / factor;
    case RoundingMode.HALF_EVEN: {
      const floorVal = Math.floor(n);
      const diff = n - floorVal;
      const rounded =
        Math.abs(diff - 0.5) < 1e-9
          ? floorVal % 2 === 0
            ? floorVal
            : floorVal + 1
          : Math.round(n);
      return rounded / factor;
    }
    case RoundingMode.HALF_UP:
    default:
      return Math.round(n) / factor;
  }
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
  validate(rates: FXRateDto[], _args: ValidationArguments): boolean {
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

  defaultMessage(_args: ValidationArguments): string {
    return 'FX rates matrix contains invalid, zero, or inconsistent reciprocal currency conversion pairs.';
  }
}

function validateSingleLineItem(
  item: InvoiceLineItemDto,
  decimals: number,
  mode: RoundingMode
): boolean {
  const expectedRawNet = item.quantity * item.unitPrice - item.discountAmount;
  if (expectedRawNet < 0) return false;

  const computedNet = roundMoney(expectedRawNet, decimals, mode);
  if (Math.abs(computedNet - item.netAmount) > 0.01) return false;

  let computedTaxSum = 0;
  if (Array.isArray(item.taxDetails)) {
    for (const tax of item.taxDetails) {
      const isTaxExempt =
        tax.isExempt ||
        tax.taxType === TaxType.ZERO_RATED ||
        tax.taxType === TaxType.EXEMPT;

      if (isTaxExempt) {
        if (tax.taxAmount !== 0) return false;
        if (tax.isExempt && !tax.exemptionReason) return false;
      } else {
        const computedTax = roundMoney(
          (tax.taxableAmount * tax.ratePercent) / 100,
          decimals,
          mode
        );
        if (Math.abs(computedTax - tax.taxAmount) > 0.02) return false;
      }

      if (tax.taxType !== TaxType.WITHHOLDING) {
        computedTaxSum += tax.taxAmount;
      }
    }
  }

  const computedGross = roundMoney(computedNet + computedTaxSum, decimals, mode);
  return Math.abs(computedGross - item.grossAmount) <= 0.02;
}

@ValidatorConstraint({ name: 'IsLineItemMathValidConstraint', async: false })
export class IsLineItemMathValidConstraint implements ValidatorConstraintInterface {
  validate(lineItems: InvoiceLineItemDto[], args: ValidationArguments): boolean {
    if (!Array.isArray(lineItems) || lineItems.length === 0) return false;

    const parentObj = args.object as Record<string, any>;
    const currency: CurrencyCode = parentObj.supplierCurrency || CurrencyCode.USD;
    const mode: RoundingMode = parentObj.roundingMode || RoundingMode.HALF_UP;
    const decimals = getCurrencyDecimals(currency);

    return lineItems.every((item) => validateSingleLineItem(item, decimals, mode));
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'One or more invoice line items fail precision math verification (net, discount, tax, or gross mismatch).';
  }
}

function validateLineTotals(
  dto: Record<string, any>,
  decimals: number,
  mode: RoundingMode,
  lineItemMap: Map<string, InvoiceLineItemDto>
): boolean {
  const lineItems: InvoiceLineItemDto[] = dto.lineItems || [];
  let calculatedNetSum = 0;
  let calculatedTaxSum = 0;
  let calculatedGrossSum = 0;

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

  return (
    Math.abs(roundedNetSum - dto.totalNetAmount) <= 0.05 &&
    Math.abs(roundedTaxSum - dto.totalTaxAmount) <= 0.05 &&
    Math.abs(roundedGrossSum - dto.totalGrossAmount) <= 0.05
  );
}

function calculateDisputeAdjustments(
  disputes: InvoiceDisputeDto[],
  lineItemMap: Map<string, InvoiceLineItemDto>,
  totalGrossAmount: number
): { isValid: boolean; totalAdjustments: number } {
  let totalDisputeAdjustments = 0;

  for (const dispute of disputes) {
    if (dispute.lineItemId) {
      const matchedItem = lineItemMap.get(dispute.lineItemId);
      if (!matchedItem || dispute.disputedAmount > matchedItem.grossAmount + 0.01) {
        return { isValid: false, totalAdjustments: 0 };
      }
    } else {
      if (dispute.disputedAmount > totalGrossAmount + 0.01) {
        return { isValid: false, totalAdjustments: 0 };
      }
    }

    switch (dispute.status) {
      case DisputeStatus.RESOLVED_CREDIT_MEMO:
      case DisputeStatus.RESOLVED_WAIVED:
        if (
          dispute.resolutionAmount <= 0 ||
          dispute.resolutionAmount > dispute.disputedAmount + 0.01 ||
          !dispute.resolvedAt
        ) {
          return { isValid: false, totalAdjustments: 0 };
        }
        totalDisputeAdjustments += dispute.resolutionAmount;
        break;
      case DisputeStatus.REJECTED:
      case DisputeStatus.OPEN:
      case DisputeStatus.UNDER_INVESTIGATION:
        if (dispute.resolutionAmount !== 0) {
          return { isValid: false, totalAdjustments: 0 };
        }
        break;
      default:
        return { isValid: false, totalAdjustments: 0 };
    }
  }

  return { isValid: true, totalAdjustments: totalDisputeAdjustments };
}

function calculateTotalPaid(
  payments: PaymentAllocationDto[],
  supplierCurrency: CurrencyCode,
  fxRates: FXRateDto[],
  decimals: number,
  mode: RoundingMode
): { isValid: boolean; totalPaid: number } {
  let totalEffectivePaid = 0;

  for (const payment of payments) {
    if (payment.paymentCurrency === supplierCurrency) {
      if (
        Math.abs(payment.fxRateUsed - 1.0) > 0.0001 ||
        Math.abs(payment.allocatedAmount - payment.allocatedAmountInInvoiceCurrency) > 0.01
      ) {
        return { isValid: false, totalPaid: 0 };
      }
    } else {
      const expectedInvoiceAmount = payment.allocatedAmount * payment.fxRateUsed;
      const roundedExpected = roundMoney(expectedInvoiceAmount, decimals, mode);
      if (Math.abs(roundedExpected - payment.allocatedAmountInInvoiceCurrency) > 0.05) {
        return { isValid: false, totalPaid: 0 };
      }

      const fxFound = fxRates.some(
        (rate) =>
          rate.fromCurrency === payment.paymentCurrency &&
          rate.toCurrency === supplierCurrency &&
          Math.abs(rate.rate - payment.fxRateUsed) < 0.05
      );

      if (!fxFound && fxRates.length > 0) {
        return { isValid: false, totalPaid: 0 };
      }
    }

    let netPaymentContribution = payment.allocatedAmountInInvoiceCurrency;
    if (payment.bankFeeAmount > 0 && payment.bankFeeAbsorbedBySupplier) {
      netPaymentContribution -= payment.bankFeeAmount;
    }

    totalEffectivePaid += netPaymentContribution;
  }

  return { isValid: true, totalPaid: totalEffectivePaid };
}

@ValidatorConstraint({ name: 'IsInvoiceReconciliationValidConstraint', async: false })
export class IsInvoiceReconciliationValidConstraint implements ValidatorConstraintInterface {
  validate(dto: any, _args: ValidationArguments): boolean {
    if (!dto) return false;

    const supplierCurrency: CurrencyCode = dto.supplierCurrency;
    const reconciliationCurrency: CurrencyCode = dto.reconciliationCurrency;
    const mode: RoundingMode = dto.roundingMode || RoundingMode.HALF_UP;
    const tolerance: number = dto.toleranceThreshold ?? 0.05;
    const decimals = getCurrencyDecimals(reconciliationCurrency);

    const lineItemMap = new Map<string, InvoiceLineItemDto>();
    if (!validateLineTotals(dto, decimals, mode, lineItemMap)) {
      return false;
    }

    const disputes: InvoiceDisputeDto[] = dto.disputes || [];
    const disputeResult = calculateDisputeAdjustments(
      disputes,
      lineItemMap,
      dto.totalGrossAmount
    );
    if (!disputeResult.isValid) return false;

    const payments: PaymentAllocationDto[] = dto.payments || [];
    const fxRates: FXRateDto[] = dto.fxRates || [];
    const paymentResult = calculateTotalPaid(
      payments,
      supplierCurrency,
      fxRates,
      decimals,
      mode
    );
    if (!paymentResult.isValid) return false;

    const netTargetToSettle = dto.totalGrossAmount - disputeResult.totalAdjustments;
    const remainingBalance = netTargetToSettle - paymentResult.totalPaid;

    return Math.abs(remainingBalance) <= tolerance;
  }

  defaultMessage(_args: ValidationArguments): string {
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