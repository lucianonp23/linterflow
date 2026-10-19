import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export interface CartItemDto {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  category: 'digital' | 'physical' | 'perishable' | 'hazardous';
  isTaxExempt?: boolean;
  maxAllowedPerOrder?: number;
}

export interface CustomerDto {
  id: string;
  email: string;
  ipAddress: string;
  isVpn?: boolean;
  recentOrderCount5Min?: number;
  taxExemptId?: string;
  baseRiskScore?: number;
}

export interface AddressDto {
  street: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  isRemoteArea?: boolean;
}

export interface CouponDto {
  code: string;
  discountType: 'percent' | 'fixed';
  value: number;
  categoryRestriction?: 'digital' | 'physical' | 'perishable' | 'hazardous';
  minSubtotal?: number;
  maxDiscountCap?: number;
  canStack: boolean;
  expiresAt: string;
}

export interface CheckoutPayloadDto {
  items: CartItemDto[];
  customer: CustomerDto;
  billingAddress: AddressDto;
  shippingAddress: AddressDto;
  coupons?: CouponDto[];
  shippingMethod: 'standard' | 'express' | 'overnight';
  currency: string;
}

export interface RefundPayloadDto {
  orderId: string;
  itemsToRefund: { sku: string; quantity: number }[];
  reason: 'damaged' | 'defective' | 'buyer_remorse' | 'fraud_chargeback';
  isReturnedToInventory: boolean;
  customerRiskRating?: number;
}

const MOCK_INVENTORY_DATABASE: Record<string, { stock: number; backorderAllowed: boolean }> = {
  'SKU-DIGITAL-1': { stock: 99999, backorderAllowed: true },
  'SKU-PHYSICAL-1': { stock: 15, backorderAllowed: false },
  'SKU-PHYSICAL-2': { stock: 2, backorderAllowed: true },
  'SKU-PERISHABLE-1': { stock: 5, backorderAllowed: false },
  'SKU-HAZARDOUS-1': { stock: 20, backorderAllowed: false },
  'SKU-OUT-OF-STOCK': { stock: 0, backorderAllowed: false },
};

const MOCK_ORDERS_DATABASE: Map<string, any> = new Map();

// Helpers for Fraud evaluation
const BLACKLISTED_EMAIL_DOMAINS = new Set([
  'tempmail.com',
  'throwaway.org',
  'mailinator.com',
  '10minutemail.com',
  'dispostable.com',
]);

const RISK_THRESHOLDS = [
  { minScore: 80, riskLevel: 'CRITICAL', action: 'REJECT' },
  { minScore: 50, riskLevel: 'HIGH', action: 'FLAG' },
  { minScore: 25, riskLevel: 'MEDIUM', action: 'ALLOW' },
  { minScore: 0, riskLevel: 'LOW', action: 'ALLOW' },
] as const;

interface FraudRule {
  evaluate: (payload: CheckoutPayloadDto, subtotal: number) => { score: number; reason: string } | null;
}

const FRAUD_RULES: FraudRule[] = [
  {
    evaluate: (p) => {
      const emailDomain = p.customer.email.split('@')[1]?.toLowerCase();
      return emailDomain && BLACKLISTED_EMAIL_DOMAINS.has(emailDomain)
        ? { score: 45, reason: `Blacklisted disposable email domain detected: ${emailDomain}` }
        : null;
    },
  },
  {
    evaluate: (p) => (p.customer.isVpn ? { score: 20, reason: 'User is ordering behind a VPN/Proxy' } : null),
  },
  {
    evaluate: (p) =>
      p.customer.recentOrderCount5Min && p.customer.recentOrderCount5Min > 3
        ? {
            score: 35,
            reason: `High order velocity detected: ${p.customer.recentOrderCount5Min} orders in 5 minutes`,
          }
        : null,
  },
  {
    evaluate: (p, subtotal) => {
      if (p.billingAddress.country.toUpperCase() === p.shippingAddress.country.toUpperCase()) return null;
      return subtotal > 300
        ? { score: 30, reason: 'Cross-border mismatch between billing and shipping address on order > $300' }
        : { score: 15, reason: 'Cross-border mismatch between billing and shipping address' };
    },
  },
  {
    evaluate: (p) =>
      p.billingAddress.zipCode !== p.shippingAddress.zipCode
        ? { score: 5, reason: 'Billing and shipping zip codes do not match' }
        : null,
  },
  {
    evaluate: (_, subtotal) =>
      subtotal > 2000 ? { score: 25, reason: 'High value transaction exceeding $2000' } : null,
  },
  {
    evaluate: (p, subtotal) =>
      subtotal > 1000 && p.items.some((item) => item.category === 'hazardous')
        ? { score: 15, reason: 'High-value hazardous materials order' }
        : null,
  },
  {
    evaluate: (p) =>
      p.customer.isVpn && p.items.some((item) => item.category === 'digital')
        ? { score: 15, reason: 'Digital goods purchase over VPN' }
        : null,
  },
];

function evaluateFraudScoreAndReasons(
  payload: CheckoutPayloadDto,
  subtotal: number,
): { score: number; reasons: string[] } {
  let score = payload.customer.baseRiskScore || 0;
  const reasons: string[] = [];

  for (const rule of FRAUD_RULES) {
    const result = rule.evaluate(payload, subtotal);
    if (result) {
      score += result.score;
      reasons.push(result.reason);
    }
  }

  return { score, reasons };
}

// Helpers for Inventory evaluation
function getStockError(item: CartItemDto, dbInventory: { stock: number; backorderAllowed: boolean }): string | null {
  if (dbInventory.stock >= item.quantity) return null;
  if (item.category === 'perishable') {
    return `Perishable item ${item.sku} is out of stock (available: ${dbInventory.stock}, requested: ${item.quantity}). Backorders strictly prohibited for perishables.`;
  }
  if (!dbInventory.backorderAllowed) {
    return `Item ${item.sku} is out of stock (available: ${dbInventory.stock}, requested: ${item.quantity}) and backorders are not allowed.`;
  }
  return null;
}

function validateSingleInventoryItem(item: CartItemDto, shippingMethod: string): string[] {
  const errors: string[] = [];

  if (item.quantity <= 0) {
    errors.push(`Invalid quantity ${item.quantity} for item ${item.sku}. Must be greater than 0.`);
  }

  if (item.maxAllowedPerOrder && item.quantity > item.maxAllowedPerOrder) {
    errors.push(
      `Item ${item.sku} exceeds maximum allowed limit of ${item.maxAllowedPerOrder} per order (requested ${item.quantity}).`,
    );
  }

  const dbInventory = MOCK_INVENTORY_DATABASE[item.sku];
  if (!dbInventory) {
    errors.push(`Item ${item.sku} does not exist in inventory system.`);
    return errors;
  }

  const stockErr = getStockError(item, dbInventory);
  if (stockErr) {
    errors.push(stockErr);
  }

  const isAirShipping = shippingMethod === 'overnight' || shippingMethod === 'express';
  if (item.category === 'hazardous' && isAirShipping) {
    errors.push(
      `Hazardous item ${item.sku} cannot be shipped via air transport (${shippingMethod}). Ground shipping standard only.`,
    );
  }

  return errors;
}

// Helpers for Coupon evaluation
function evaluateSingleCoupon(
  coupon: CouponDto,
  items: CartItemDto[],
  subtotal: number,
  now: Date,
): { appliedCode?: string; discount: number; error?: string } {
  if (new Date(coupon.expiresAt) < now) {
    return { discount: 0, error: `Coupon ${coupon.code} has expired.` };
  }

  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
    return {
      discount: 0,
      error: `Coupon ${coupon.code} requires minimum subtotal of $${coupon.minSubtotal}. Current: $${subtotal}`,
    };
  }

  let applicableBaseAmount = subtotal;

  if (coupon.categoryRestriction) {
    applicableBaseAmount = items
      .filter((item) => item.category === coupon.categoryRestriction)
      .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    if (applicableBaseAmount === 0) {
      return {
        discount: 0,
        error: `Coupon ${coupon.code} is restricted to category '${coupon.categoryRestriction}', which is not present in cart.`,
      };
    }
  }

  let calculatedDiscount =
    coupon.discountType === 'percent' ? (applicableBaseAmount * coupon.value) / 100 : coupon.value;

  if (coupon.maxDiscountCap && calculatedDiscount > coupon.maxDiscountCap) {
    calculatedDiscount = coupon.maxDiscountCap;
  }

  return { appliedCode: coupon.code, discount: calculatedDiscount };
}

// Helpers for Shipping evaluation
const SHIPPING_BASE_RATES: Record<string, number> = {
  standard: 5.0,
  express: 15.0,
  overnight: 35.0,
};

function calculateWeightFee(billableWeightKg: number): number {
  if (billableWeightKg > 20) return 30.0 + (billableWeightKg - 20) * 2.5;
  if (billableWeightKg > 5) return 15.0;
  if (billableWeightKg > 1) return 5.0;
  return 0;
}

function extractShippingMetrics(items: CartItemDto[]) {
  let physicalItemsCount = 0;
  let totalWeightKg = 0;
  let totalVolumetricWeightKg = 0;
  let hasHazardous = false;
  let hasPerishable = false;

  for (const item of items) {
    if (item.category !== 'digital') {
      physicalItemsCount += item.quantity;
      totalWeightKg += item.weightKg * item.quantity;

      if (item.lengthCm && item.widthCm && item.heightCm) {
        const volumetric = (item.lengthCm * item.widthCm * item.heightCm) / 5000;
        totalVolumetricWeightKg += volumetric * item.quantity;
      }
    }

    if (item.category === 'hazardous') hasHazardous = true;
    if (item.category === 'perishable') hasPerishable = true;
  }

  return { physicalItemsCount, totalWeightKg, totalVolumetricWeightKg, hasHazardous, hasPerishable };
}

const SURCHARGE_RULES: Array<{
  condition: (m: { hasHazardous: boolean; hasPerishable: boolean; isRemoteArea?: boolean }) => boolean;
  amount: number;
  message: string;
}> = [
  {
    condition: (m) => m.hasHazardous,
    amount: 25.0,
    message: 'Hazardous material handling surcharge: $25.00',
  },
  {
    condition: (m) => m.hasPerishable,
    amount: 10.0,
    message: 'Perishable cold-pack handling surcharge: $10.00',
  },
  {
    condition: (m) => !!m.isRemoteArea,
    amount: 18.0,
    message: 'Remote location delivery surcharge: $18.00',
  },
];

function isFreeShippingEligible(
  discountedSubtotal: number,
  shippingMethod: string,
  billableWeightKg: number,
  isDomesticUS: boolean,
): boolean {
  return discountedSubtotal >= 150 && shippingMethod === 'standard' && billableWeightKg <= 10 && isDomesticUS;
}

// Helpers for Tax evaluation
const US_STATE_TAX_RATES: Record<string, (category: string) => number> = {
  CA: (cat) => (cat === 'digital' ? 0.06 : 0.0725),
  NY: () => 0.04,
  TX: () => 0.0625,
  OR: () => 0.0,
  DE: () => 0.0,
  NH: () => 0.0,
  MT: () => 0.0,
};

const CA_STATE_TAX_RATES: Record<string, number> = {
  ON: 0.13,
  BC: 0.12,
  AB: 0.05,
  QC: 0.14975,
};

const EU_COUNTRIES = new Set(['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'SE', 'PL']);
const EU_DIGITAL_RATES: Record<string, number> = { DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21, SE: 0.25 };
const EU_PHYSICAL_RATES: Record<string, number> = { DE: 0.19, FR: 0.2 };

function getUsTaxRate(state: string, category: string, isRemoteArea?: boolean): number {
  const baseRate = US_STATE_TAX_RATES[state] ? US_STATE_TAX_RATES[state](category) : 0.05;
  return isRemoteArea ? baseRate + 0.01 : baseRate;
}

function getCaTaxRate(state: string): number {
  return CA_STATE_TAX_RATES[state] ?? 0.05;
}

function getEuTaxRate(country: string, category: string): number {
  return category === 'digital'
    ? (EU_DIGITAL_RATES[country] ?? 0.2)
    : (EU_PHYSICAL_RATES[country] ?? 0.21);
}

function determineTaxRate(country: string, state: string, category: string, isRemoteArea?: boolean): number {
  if (country === 'US') return getUsTaxRate(state, category, isRemoteArea);
  if (country === 'CA') return getCaTaxRate(state);
  if (EU_COUNTRIES.has(country)) return getEuTaxRate(country, category);
  return 0.1;
}

@Controller('checkout')
export class CheckoutController {
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validateCheckout(@Body() payload: CheckoutPayloadDto) {
    const fraudAssessment = this.evaluateFraudRules(payload);
    if (fraudAssessment.action === 'REJECT') {
      throw new ForbiddenException(
        `Checkout rejected due to high fraud score: ${fraudAssessment.score}. Reasons: ${fraudAssessment.reasons.join(', ')}`,
      );
    }

    const inventoryCheck = this.evaluateInventoryRules(payload.items, payload.shippingMethod);
    if (!inventoryCheck.isValid) {
      throw new UnprocessableEntityException({
        message: 'Inventory validation failed',
        errors: inventoryCheck.errors,
      });
    }

    const subtotal = this.calculateSubtotal(payload.items);
    const couponResult = this.evaluateCouponsRules(payload.coupons || [], payload.items, subtotal);
    const shippingResult = this.calculateShippingRules(
      payload.items,
      payload.shippingMethod,
      payload.shippingAddress,
      couponResult.discountedSubtotal,
    );
    const taxResult = this.calculateTaxRules(
      payload.items,
      payload.customer,
      payload.shippingAddress,
      couponResult.discountedSubtotal,
    );

    const grandTotal = Number(
      (couponResult.discountedSubtotal + shippingResult.totalShipping + taxResult.totalTax).toFixed(2),
    );

    return {
      status: 'VALIDATED',
      fraudAssessment: {
        score: fraudAssessment.score,
        riskLevel: fraudAssessment.riskLevel,
        warnings: fraudAssessment.reasons,
      },
      pricing: {
        rawSubtotal: subtotal,
        discountTotal: couponResult.totalDiscount,
        appliedCoupons: couponResult.appliedCoupons,
        discountedSubtotal: couponResult.discountedSubtotal,
        shippingFee: shippingResult.baseShippingFee,
        shippingSurcharges: shippingResult.surcharges,
        internationalDuties: shippingResult.dutiesFee,
        totalShipping: shippingResult.totalShipping,
        taxDetails: taxResult.details,
        totalTax: taxResult.totalTax,
        grandTotal: grandTotal,
        currency: payload.currency,
      },
    };
  }

  @Post('process')
  @HttpCode(HttpStatus.CREATED)
  processCheckout(@Body() payload: CheckoutPayloadDto, @Headers('x-idempotency-key') idempotencyKey?: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('Missing required header: x-idempotency-key');
    }

    if (MOCK_ORDERS_DATABASE.has(idempotencyKey)) {
      return {
        status: 'DUPLICATE_PROCESSED',
        order: MOCK_ORDERS_DATABASE.get(idempotencyKey),
      };
    }

    const validationResult = this.validateCheckout(payload);

    for (const item of payload.items) {
      const dbItem = MOCK_INVENTORY_DATABASE[item.sku];
      if (dbItem) {
        dbItem.stock = Math.max(0, dbItem.stock - item.quantity);
      }
    }

    const orderRecord = {
      orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      idempotencyKey,
      timestamp: new Date().toISOString(),
      customer: payload.customer.email,
      pricing: validationResult.pricing,
      items: payload.items,
      shippingAddress: payload.shippingAddress,
      status: 'COMPLETED',
    };

    MOCK_ORDERS_DATABASE.set(idempotencyKey, orderRecord);

    return {
      status: 'SUCCESS',
      order: orderRecord,
    };
  }

  @Post('calculate-tax-shipping')
  @HttpCode(HttpStatus.OK)
  calculateTaxAndShippingOnly(
    @Body()
    payload: {
      items: CartItemDto[];
      customer: CustomerDto;
      shippingAddress: AddressDto;
      shippingMethod: 'standard' | 'express' | 'overnight';
    },
  ) {
    const subtotal = this.calculateSubtotal(payload.items);
    const shipping = this.calculateShippingRules(
      payload.items,
      payload.shippingMethod,
      payload.shippingAddress,
      subtotal,
    );
    const tax = this.calculateTaxRules(payload.items, payload.customer, payload.shippingAddress, subtotal);

    return {
      subtotal,
      shipping,
      tax,
      estimatedTotal: Number((subtotal + shipping.totalShipping + tax.totalTax).toFixed(2)),
    };
  }

  @Post('coupons/apply')
  @HttpCode(HttpStatus.OK)
  applyCoupons(@Body() payload: { coupons: CouponDto[]; items: CartItemDto[] }) {
    const subtotal = this.calculateSubtotal(payload.items);
    return this.evaluateCouponsRules(payload.coupons, payload.items, subtotal);
  }

  @Get('inventory-check/:sku')
  checkInventorySku(@Param('sku') sku: string, @Query('quantity') quantityStr?: string) {
    const quantity = quantityStr ? parseInt(quantityStr, 10) : 1;
    const dbItem = MOCK_INVENTORY_DATABASE[sku];

    if (!dbItem) {
      throw new NotFoundException(`SKU ${sku} was not found in inventory.`);
    }

    const isAvailable = dbItem.stock >= quantity || dbItem.backorderAllowed;
    const isBackordered = dbItem.stock < quantity && dbItem.backorderAllowed;

    return {
      sku,
      requestedQuantity: quantity,
      availableStock: dbItem.stock,
      isAvailable,
      isBackordered,
      backorderAllowed: dbItem.backorderAllowed,
    };
  }

  @Post('fraud-check')
  @HttpCode(HttpStatus.OK)
  standaloneFraudCheck(@Body() payload: CheckoutPayloadDto) {
    return this.evaluateFraudRules(payload);
  }

  @Post('refund')
  @HttpCode(HttpStatus.OK)
  processRefund(@Body() payload: RefundPayloadDto) {
    let refundTotal = 0;
    let restockingFee = 0;

    for (const item of payload.itemsToRefund) {
      const mockItem = MOCK_INVENTORY_DATABASE[item.sku];
      if (payload.isReturnedToInventory && mockItem) {
        mockItem.stock += item.quantity;
      }
      refundTotal += item.quantity * 20.0;
    }

    switch (payload.reason) {
      case 'buyer_remorse':
        restockingFee = refundTotal * 0.15;
        if (payload.customerRiskRating && payload.customerRiskRating > 50) {
          restockingFee = refundTotal * 0.25;
        }
        break;
      case 'damaged':
      case 'defective':
        restockingFee = 0;
        break;
      case 'fraud_chargeback':
        restockingFee = 0;
        break;
      default:
        restockingFee = refundTotal * 0.1;
        break;
    }

    const netRefund = Number((refundTotal - restockingFee).toFixed(2));

    return {
      orderId: payload.orderId,
      grossRefund: refundTotal,
      restockingFee: restockingFee,
      netRefund: netRefund,
      status: 'REFUND_PROCESSED',
    };
  }

  private calculateSubtotal(items: CartItemDto[]): number {
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.unitPrice * item.quantity;
    }
    return Number(subtotal.toFixed(2));
  }

  private evaluateFraudRules(payload: CheckoutPayloadDto): {
    score: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    action: 'ALLOW' | 'FLAG' | 'REJECT';
    reasons: string[];
  } {
    const subtotal = this.calculateSubtotal(payload.items);
    const { score, reasons } = evaluateFraudScoreAndReasons(payload, subtotal);
    const assessment = RISK_THRESHOLDS.find((t) => score >= t.minScore) || RISK_THRESHOLDS[3];

    return {
      score,
      riskLevel: assessment.riskLevel,
      action: assessment.action,
      reasons,
    };
  }

  private evaluateInventoryRules(
    items: CartItemDto[],
    shippingMethod: string,
  ): { isValid: boolean; errors: string[] } {
    if (!items || items.length === 0) {
      return { isValid: false, errors: ['Cart is empty. At least one item is required.'] };
    }

    const errors: string[] = [];
    for (const item of items) {
      errors.push(...validateSingleInventoryItem(item, shippingMethod));
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private evaluateCouponsRules(
    coupons: CouponDto[],
    items: CartItemDto[],
    subtotal: number,
  ): {
    appliedCoupons: string[];
    totalDiscount: number;
    discountedSubtotal: number;
    couponErrors: string[];
  } {
    const appliedCoupons: string[] = [];
    const couponErrors: string[] = [];
    let totalDiscount = 0;
    const now = new Date();

    if (!coupons || coupons.length === 0) {
      return { appliedCoupons, totalDiscount: 0, discountedSubtotal: subtotal, couponErrors };
    }

    const hasNonStackable = coupons.some((c) => !c.canStack);
    if (hasNonStackable && coupons.length > 1) {
      couponErrors.push('Contains non-stackable coupon. Multiple coupons cannot be applied together.');
      return { appliedCoupons: [], totalDiscount: 0, discountedSubtotal: subtotal, couponErrors };
    }

    for (const coupon of coupons) {
      const result = evaluateSingleCoupon(coupon, items, subtotal, now);
      if (result.error) {
        couponErrors.push(result.error);
      } else {
        totalDiscount += result.discount;
        if (result.appliedCode) {
          appliedCoupons.push(result.appliedCode);
        }
      }
    }

    if (totalDiscount > subtotal) {
      totalDiscount = subtotal;
    }

    totalDiscount = Number(totalDiscount.toFixed(2));
    const discountedSubtotal = Number((subtotal - totalDiscount).toFixed(2));

    return {
      appliedCoupons,
      totalDiscount,
      discountedSubtotal,
      couponErrors,
    };
  }

  private calculateShippingRules(
    items: CartItemDto[],
    shippingMethod: 'standard' | 'express' | 'overnight',
    shippingAddress: AddressDto,
    discountedSubtotal: number,
  ): {
    baseShippingFee: number;
    surcharges: number;
    dutiesFee: number;
    totalShipping: number;
    breakdown: string[];
  } {
    const metrics = extractShippingMetrics(items);

    if (metrics.physicalItemsCount === 0) {
      return {
        baseShippingFee: 0,
        surcharges: 0,
        dutiesFee: 0,
        totalShipping: 0,
        breakdown: ['All items are digital. Zero shipping fee.'],
      };
    }

    const billableWeightKg = Math.max(metrics.totalWeightKg, metrics.totalVolumetricWeightKg);
    const breakdown: string[] = [];
    const baseRate = SHIPPING_BASE_RATES[shippingMethod] || 0;
    const weightFee = calculateWeightFee(billableWeightKg);

    breakdown.push(`Base Method (${shippingMethod}): $${baseRate}`);
    breakdown.push(`Billable Weight Fee (${billableWeightKg.toFixed(2)} kg): $${weightFee}`);

    let surcharges = 0;
    const surchargeContext = { ...metrics, isRemoteArea: shippingAddress.isRemoteArea };
    for (const rule of SURCHARGE_RULES) {
      if (rule.condition(surchargeContext)) {
        surcharges += rule.amount;
        breakdown.push(rule.message);
      }
    }

    let baseShippingFee = baseRate + weightFee;
    const isDomesticUS = shippingAddress.country.toUpperCase() === 'US';

    if (isFreeShippingEligible(discountedSubtotal, shippingMethod, billableWeightKg, isDomesticUS)) {
      breakdown.push('Free Standard Shipping eligibility unlocked (subtotal >= $150). Base weight fee waived.');
      baseShippingFee = 0;
    }

    let dutiesFee = 0;
    if (!isDomesticUS) {
      dutiesFee = Number((discountedSubtotal * 0.08 + 12.0).toFixed(2));
      breakdown.push(`International Duty & Import Handling: $${dutiesFee}`);
    }

    const totalShipping = Number((baseShippingFee + surcharges + dutiesFee).toFixed(2));

    return {
      baseShippingFee,
      surcharges,
      dutiesFee,
      totalShipping,
      breakdown,
    };
  }

  private calculateTaxRules(
    items: CartItemDto[],
    customer: CustomerDto,
    shippingAddress: AddressDto,
    discountedSubtotal: number,
  ): {
    totalTax: number;
    details: { sku: string; rate: number; taxAmount: number }[];
  } {
    if (customer.taxExemptId && customer.taxExemptId.trim().length > 0) {
      return {
        totalTax: 0,
        details: items.map((item) => ({ sku: item.sku, rate: 0, taxAmount: 0 })),
      };
    }

    const country = shippingAddress.country.toUpperCase();
    const state = shippingAddress.state.toUpperCase();
    const subtotal = this.calculateSubtotal(items);
    const effectiveDiscountRatio = discountedSubtotal > 0 ? discountedSubtotal / subtotal : 0;

    let totalTax = 0;
    const details = items.map((item) => {
      if (item.isTaxExempt) {
        return { sku: item.sku, rate: 0, taxAmount: 0 };
      }

      const taxRate = determineTaxRate(country, state, item.category, shippingAddress.isRemoteArea);
      const itemBasePrice = item.unitPrice * item.quantity * effectiveDiscountRatio;
      const itemTax = Number((itemBasePrice * taxRate).toFixed(2));

      totalTax += itemTax;
      return { sku: item.sku, rate: taxRate, taxAmount: itemTax };
    });

    return {
      totalTax: Number(totalTax.toFixed(2)),
      details,
    };
  }
}