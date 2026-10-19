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

const BLACKLISTED_DOMAINS = new Set([
  'tempmail.com',
  'throwaway.org',
  'mailinator.com',
  '10minutemail.com',
  'dispostable.com',
]);

const SHIPPING_BASE_RATES: Record<string, number> = {
  standard: 5.0,
  express: 15.0,
  overnight: 35.0,
};

function calculateWeightFee(weightKg: number): number {
  if (weightKg > 20) return 30.0 + (weightKg - 20) * 2.5;
  if (weightKg > 5) return 15.0;
  if (weightKg > 1) return 5.0;
  return 0;
}

function getTaxRate(country: string, state: string, category: string, isRemote: boolean): number {
  if (country === 'US') {
    let rate = 0.05;
    if (state === 'CA') rate = category === 'digital' ? 0.06 : 0.0725;
    else if (state === 'NY') rate = 0.04;
    else if (state === 'TX') rate = 0.0625;
    else if (['OR', 'DE', 'NH', 'MT'].includes(state)) rate = 0.0;

    return isRemote ? rate + 0.01 : rate;
  }

  if (country === 'CA') {
    const caRates: Record<string, number> = { ON: 0.13, BC: 0.12, AB: 0.05, QC: 0.14975 };
    return caRates[state] ?? 0.05;
  }

  const euCountries = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'SE', 'PL'];
  if (euCountries.includes(country)) {
    if (category === 'digital') {
      const digitalRates: Record<string, number> = { DE: 0.19, FR: 0.20, IT: 0.22, ES: 0.21, SE: 0.25 };
      return digitalRates[country] ?? 0.20;
    }
    const physicalRates: Record<string, number> = { DE: 0.19, FR: 0.20 };
    return physicalRates[country] ?? 0.21;
  }

  return 0.10;
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
        grandTotal,
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

    for (const item of payload.itemsToRefund) {
      const mockItem = MOCK_INVENTORY_DATABASE[item.sku];
      if (payload.isReturnedToInventory && mockItem) {
        mockItem.stock += item.quantity;
      }
      refundTotal += item.quantity * 20.0;
    }

    const restockingFee = this.calculateRestockingFee(payload.reason, refundTotal, payload.customerRiskRating);
    const netRefund = Number((refundTotal - restockingFee).toFixed(2));

    return {
      orderId: payload.orderId,
      grossRefund: refundTotal,
      restockingFee,
      netRefund,
      status: 'REFUND_PROCESSED',
    };
  }

  private calculateSubtotal(items: CartItemDto[]): number {
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    return Number(total.toFixed(2));
  }

  private evaluateFraudRules(payload: CheckoutPayloadDto): {
    score: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    action: 'ALLOW' | 'FLAG' | 'REJECT';
    reasons: string[];
  } {
    let score = payload.customer.baseRiskScore || 0;
    const reasons: string[] = [];

    const emailDomain = payload.customer.email.split('@')[1]?.toLowerCase();
    if (emailDomain && BLACKLISTED_DOMAINS.has(emailDomain)) {
      score += 45;
      reasons.push(`Blacklisted disposable email domain detected: ${emailDomain}`);
    }

    if (payload.customer.isVpn) {
      score += 20;
      reasons.push('User is ordering behind a VPN/Proxy');
    }

    if (payload.customer.recentOrderCount5Min && payload.customer.recentOrderCount5Min > 3) {
      score += 35;
      reasons.push(`High order velocity detected: ${payload.customer.recentOrderCount5Min} orders in 5 minutes`);
    }

    const subtotal = this.calculateSubtotal(payload.items);
    if (payload.billingAddress.country.toUpperCase() !== payload.shippingAddress.country.toUpperCase()) {
      if (subtotal > 300) {
        score += 30;
        reasons.push('Cross-border mismatch between billing and shipping address on order > $300');
      } else {
        score += 15;
        reasons.push('Cross-border mismatch between billing and shipping address');
      }
    }

    if (payload.billingAddress.zipCode !== payload.shippingAddress.zipCode) {
      score += 5;
      reasons.push('Billing and shipping zip codes do not match');
    }

    if (subtotal > 2000) {
      score += 25;
      reasons.push('High value transaction exceeding $2000');
    }

    const hasHazardous = payload.items.some((item) => item.category === 'hazardous');
    const hasDigital = payload.items.some((item) => item.category === 'digital');

    if (hasHazardous && subtotal > 1000) {
      score += 15;
      reasons.push('High-value hazardous materials order');
    }

    if (hasDigital && payload.customer.isVpn) {
      score += 15;
      reasons.push('Digital goods purchase over VPN');
    }

    const { riskLevel, action } = this.getRiskAndAction(score);
    return { score, riskLevel, action, reasons };
  }

  private getRiskAndAction(score: number): {
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    action: 'ALLOW' | 'FLAG' | 'REJECT';
  } {
    if (score >= 80) return { riskLevel: 'CRITICAL', action: 'REJECT' };
    if (score >= 50) return { riskLevel: 'HIGH', action: 'FLAG' };
    if (score >= 25) return { riskLevel: 'MEDIUM', action: 'ALLOW' };
    return { riskLevel: 'LOW', action: 'ALLOW' };
  }

  private evaluateInventoryRules(
    items: CartItemDto[],
    shippingMethod: string,
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!items || items.length === 0) {
      errors.push('Cart is empty. At least one item is required.');
      return { isValid: false, errors };
    }

    for (const item of items) {
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
        continue;
      }

      if (dbInventory.stock < item.quantity) {
        if (item.category === 'perishable') {
          errors.push(
            `Perishable item ${item.sku} is out of stock (available: ${dbInventory.stock}, requested: ${item.quantity}). Backorders strictly prohibited for perishables.`,
          );
        } else if (!dbInventory.backorderAllowed) {
          errors.push(
            `Item ${item.sku} is out of stock (available: ${dbInventory.stock}, requested: ${item.quantity}) and backorders are not allowed.`,
          );
        }
      }

      if (item.category === 'hazardous' && (shippingMethod === 'overnight' || shippingMethod === 'express')) {
        errors.push(
          `Hazardous item ${item.sku} cannot be shipped via air transport (${shippingMethod}). Ground shipping standard only.`,
        );
      }
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
      if (new Date(coupon.expiresAt) < now) {
        couponErrors.push(`Coupon ${coupon.code} has expired.`);
        continue;
      }

      if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
        couponErrors.push(
          `Coupon ${coupon.code} requires minimum subtotal of $${coupon.minSubtotal}. Current: $${subtotal}`,
        );
        continue;
      }

      let applicableBaseAmount = subtotal;

      if (coupon.categoryRestriction) {
        applicableBaseAmount = items
          .filter((item) => item.category === coupon.categoryRestriction)
          .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

        if (applicableBaseAmount === 0) {
          couponErrors.push(
            `Coupon ${coupon.code} is restricted to category '${coupon.categoryRestriction}', which is not present in cart.`,
          );
          continue;
        }
      }

      let calculatedDiscount = 0;
      if (coupon.discountType === 'percent') {
        calculatedDiscount = (applicableBaseAmount * coupon.value) / 100;
      } else if (coupon.discountType === 'fixed') {
        calculatedDiscount = coupon.value;
      }

      if (coupon.maxDiscountCap && calculatedDiscount > coupon.maxDiscountCap) {
        calculatedDiscount = coupon.maxDiscountCap;
      }

      totalDiscount += calculatedDiscount;
      appliedCoupons.push(coupon.code);
    }

    totalDiscount = Math.min(totalDiscount, subtotal);
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
    const physicalItemsCount = items
      .filter((item) => item.category !== 'digital')
      .reduce((sum, item) => sum + item.quantity, 0);

    if (physicalItemsCount === 0) {
      return {
        baseShippingFee: 0,
        surcharges: 0,
        dutiesFee: 0,
        totalShipping: 0,
        breakdown: ['All items are digital. Zero shipping fee.'],
      };
    }

    let totalWeightKg = 0;
    let totalVolumetricWeightKg = 0;
    let hasHazardous = false;
    let hasPerishable = false;

    for (const item of items) {
      if (item.category !== 'digital') {
        totalWeightKg += item.weightKg * item.quantity;
        if (item.lengthCm && item.widthCm && item.heightCm) {
          const volumetric = (item.lengthCm * item.widthCm * item.heightCm) / 5000;
          totalVolumetricWeightKg += volumetric * item.quantity;
        }
      }
      if (item.category === 'hazardous') hasHazardous = true;
      if (item.category === 'perishable') hasPerishable = true;
    }

    const billableWeightKg = Math.max(totalWeightKg, totalVolumetricWeightKg);
    const breakdown: string[] = [];

    const baseRate = SHIPPING_BASE_RATES[shippingMethod] ?? 0;
    const weightFee = calculateWeightFee(billableWeightKg);

    breakdown.push(`Base Method (${shippingMethod}): $${baseRate}`);
    breakdown.push(`Billable Weight Fee (${billableWeightKg.toFixed(2)} kg): $${weightFee}`);

    let surcharges = 0;
    if (hasHazardous) {
      surcharges += 25.0;
      breakdown.push('Hazardous material handling surcharge: $25.00');
    }

    if (hasPerishable) {
      surcharges += 10.0;
      breakdown.push('Perishable cold-pack handling surcharge: $10.00');
    }

    if (shippingAddress.isRemoteArea) {
      surcharges += 18.0;
      breakdown.push('Remote location delivery surcharge: $18.00');
    }

    let baseShippingFee = baseRate + weightFee;

    const isDomesticUS = shippingAddress.country.toUpperCase() === 'US';
    if (discountedSubtotal >= 150 && shippingMethod === 'standard' && billableWeightKg <= 10 && isDomesticUS) {
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

    const details: { sku: string; rate: number; taxAmount: number }[] = [];
    const country = shippingAddress.country.toUpperCase();
    const state = shippingAddress.state.toUpperCase();
    const subtotal = this.calculateSubtotal(items);
    const effectiveDiscountRatio = discountedSubtotal > 0 ? discountedSubtotal / subtotal : 0;
    let totalTax = 0;

    for (const item of items) {
      if (item.isTaxExempt) {
        details.push({ sku: item.sku, rate: 0, taxAmount: 0 });
        continue;
      }

      const taxRate = getTaxRate(country, state, item.category, Boolean(shippingAddress.isRemoteArea));
      const itemBasePrice = item.unitPrice * item.quantity * effectiveDiscountRatio;
      const itemTax = Number((itemBasePrice * taxRate).toFixed(2));

      totalTax += itemTax;
      details.push({
        sku: item.sku,
        rate: taxRate,
        taxAmount: itemTax,
      });
    }

    return {
      totalTax: Number(totalTax.toFixed(2)),
      details,
    };
  }

  private calculateRestockingFee(reason: string, refundTotal: number, customerRiskRating?: number): number {
    switch (reason) {
      case 'buyer_remorse':
        return refundTotal * (customerRiskRating && customerRiskRating > 50 ? 0.25 : 0.15);
      case 'damaged':
      case 'defective':
      case 'fraud_chargeback':
        return 0;
      default:
        return refundTotal * 0.1;
    }
  }
}