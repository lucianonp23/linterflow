import {
  IsString,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  IsOptional,
  IsDate,
  Min,
  Max,
  ValidateNested,
  IsNotEmpty,
  IsDefined,
  ArrayNotEmpty,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum CustomerSegmentType {
  VIP = 'VIP',
  NEW_USER = 'NEW_USER',
  INACTIVE = 'INACTIVE',
  HIGH_SPENDER = 'HIGH_SPENDER',
  CUSTOM = 'CUSTOM'
}

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  BUY_X_GET_Y = 'BUY_X_GET_Y',
  FREE_SHIPPING = 'FREE_SHIPPING'
}

export enum StackingMode {
  NO_STACKING = 'NO_STACKING',
  STACK_WITH_ALL = 'STACK_WITH_ALL',
  EXCLUSIVE_CATEGORY = 'EXCLUSIVE_CATEGORY',
  EXCLUSIVE_PROMOTION = 'EXCLUSIVE_PROMOTION',
  MAX_DISCOUNT_CAP = 'MAX_DISCOUNT_CAP'
}

export enum ExclusionType {
  PRODUCT = 'PRODUCT',
  CATEGORY = 'CATEGORY',
  BRAND = 'BRAND',
  PROMOTION_CODE = 'PROMOTION_CODE',
  PAYMENT_METHOD = 'PAYMENT_METHOD',
  SHIPPING_METHOD = 'SHIPPING_METHOD'
}

export enum RuleOperator {
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  GREATER_THAN = 'GREATER_THAN',
  LESS_THAN = 'LESS_THAN',
  CONTAINS = 'CONTAINS',
  IN = 'IN',
  NOT_IN = 'NOT_IN'
}

export enum EngineErrorCode {
  EXPIRED_PROMOTION = 'EXPIRED_PROMOTION',
  NOT_STARTED = 'NOT_STARTED',
  USAGE_LIMIT_EXCEEDED = 'USAGE_LIMIT_EXCEEDED',
  CUSTOMER_USAGE_LIMIT_EXCEEDED = 'CUSTOMER_USAGE_LIMIT_EXCEEDED',
  MIN_SUBTOTAL_NOT_MET = 'MIN_SUBTOTAL_NOT_MET',
  SEGMENT_NOT_MATCHED = 'SEGMENT_NOT_MATCHED',
  EXCLUDED_ITEMS_PRESENT = 'EXCLUDED_ITEMS_PRESENT',
  EXCLUDED_PAYMENT_METHOD = 'EXCLUDED_PAYMENT_METHOD',
  EXCLUDED_SHIPPING_METHOD = 'EXCLUDED_SHIPPING_METHOD',
  STACKING_CONFLICT = 'STACKING_CONFLICT',
  MISSING_REQUIRED_PRODUCTS = 'MISSING_REQUIRED_PRODUCTS',
  BUY_X_GET_Y_CONDITION_UNMET = 'BUY_X_GET_Y_CONDITION_UNMET'
}

@ValidatorConstraint({ name: 'IsAfterDateConstraint', async: false })
export class IsAfterDateConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: any, args: ValidationArguments) {
    const [relatedPropertyName] = args.constraints;
    const relatedValue = (args.object as any)[relatedPropertyName];
    if (!(propertyValue instanceof Date) || !(relatedValue instanceof Date)) {
      return false;
    }
    return propertyValue.getTime() > relatedValue.getTime();
  }

  defaultMessage(args: ValidationArguments) {
    const [relatedPropertyName] = args.constraints;
    return `${args.property} must be later than ${relatedPropertyName}`;
  }
}

export function IsAfterDate(property: string, validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsAfterDateConstraint
    });
  };
}

@ValidatorConstraint({ name: 'UniqueArrayConstraint', async: false })
export class UniqueArrayConstraint implements ValidatorConstraintInterface {
  validate(value: any[]) {
    if (!Array.isArray(value)) return false;
    return new Set(value).size === value.length;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} contains duplicate values`;
  }
}

export function IsUniqueArray(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: UniqueArrayConstraint
    });
  };
}

export class SegmentConditionDto {
  @IsString()
  @IsNotEmpty()
  field: string;

  @IsEnum(RuleOperator)
  operator: RuleOperator;

  @IsDefined()
  value: any;
}

export class CustomerSegmentDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsEnum(CustomerSegmentType)
  type: CustomerSegmentType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SegmentConditionDto)
  conditions?: SegmentConditionDto[];
}

export class CartItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  brandId: string;

  @IsNumber()
  @Min(0.01)
  unitPrice: number;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CartDto {
  @IsString()
  @IsNotEmpty()
  cartId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @IsString()
  @IsNotEmpty()
  shippingMethod: string;

  @IsNumber()
  @Min(0)
  shippingFee: number;
}

export class PurchaseHistoryItemDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsDate()
  @Type(() => Date)
  orderDate: Date;

  @IsNumber()
  @Min(0)
  totalSpent: number;

  @IsArray()
  @IsString({ each: true })
  itemIds: string[];

  @IsArray()
  @IsString({ each: true })
  categoryIds: string[];
}

export class CustomerPurchaseHistoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseHistoryItemDto)
  orders: PurchaseHistoryItemDto[];
}

export class CustomerProfileDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerSegmentDto)
  segments: CustomerSegmentDto[];

  @IsNumber()
  @Min(0)
  lifetimeSpend: number;

  @IsNumber()
  @Min(0)
  orderCount: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  lastPurchaseDate?: Date;

  @IsDate()
  @Type(() => Date)
  createdDate: Date;

  @IsOptional()
  @IsDefined()
  attributes?: Record<string, any>;
}

export class ExclusionRuleDto {
  @IsEnum(ExclusionType)
  type: ExclusionType;

  @IsString()
  @IsNotEmpty()
  value: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class BuyXGetYConfigDto {
  @IsString()
  @IsNotEmpty()
  buyProductId: string;

  @IsNumber()
  @Min(1)
  buyQuantity: number;

  @IsString()
  @IsNotEmpty()
  getFreeProductId: string;

  @IsNumber()
  @Min(1)
  getFreeQuantity: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercentageForY: number;
}

export class PromotionRuleDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsEnum(DiscountType)
  discountType: DiscountType;

  @IsNumber()
  @Min(0)
  discountValue: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @IsNumber()
  @Min(0)
  minCartSubtotal: number;

  @IsArray()
  @IsString({ each: true })
  eligibleSegmentIds: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredProductIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExclusionRuleDto)
  exclusions?: ExclusionRuleDto[];

  @IsEnum(StackingMode)
  stackingMode: StackingMode;

  @IsNumber()
  priority: number;

  @IsDate()
  @Type(() => Date)
  validFrom: Date;

  @IsDate()
  @Type(() => Date)
  @IsAfterDate('validFrom')
  validTo: Date;

  @IsNumber()
  @Min(1)
  usageLimitTotal: number;

  @IsNumber()
  @Min(1)
  usageLimitPerCustomer: number;

  @IsNumber()
  @Min(0)
  currentTotalUsage: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BuyXGetYConfigDto)
  buyXGetYConfig?: BuyXGetYConfigDto;
}

export class EvaluatePromotionRequestDto {
  @ValidateNested()
  @Type(() => CartDto)
  @IsDefined()
  cart: CartDto;

  @ValidateNested()
  @Type(() => CustomerProfileDto)
  @IsDefined()
  customer: CustomerProfileDto;

  @ValidateNested()
  @Type(() => CustomerPurchaseHistoryDto)
  @IsDefined()
  purchaseHistory: CustomerPurchaseHistoryDto;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsUniqueArray()
  requestedPromotionCodes: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionRuleDto)
  activeRules: PromotionRuleDto[];

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  evaluationTimestamp?: Date;
}

export class PromotionEvaluationResultDto {
  @IsString()
  @IsNotEmpty()
  promotionCode: string;

  @IsBoolean()
  isEligible: boolean;

  @IsNumber()
  @Min(0)
  calculatedDiscount: number;

  @IsArray()
  @IsEnum(EngineErrorCode, { each: true })
  ineligibleReasons: EngineErrorCode[];

  @IsArray()
  @IsString({ each: true })
  appliedToItemIds: string[];

  @IsOptional()
  @IsString()
  exclusionNote?: string;
}

export class EngineEvaluationResponseDto {
  @IsBoolean()
  isValid: boolean;

  @IsNumber()
  @Min(0)
  totalDiscount: number;

  @IsNumber()
  @Min(0)
  finalCartSubtotal: number;

  @IsNumber()
  @Min(0)
  finalShippingFee: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionEvaluationResultDto)
  appliedPromotions: PromotionEvaluationResultDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionEvaluationResultDto)
  disqualifiedPromotions: PromotionEvaluationResultDto[];
}

interface StackingState {
  isBlocked: boolean;
  appliedCount: number;
  appliedCategories: Set<string>;
}

type RuleCheck = (
  engine: PromotionEligibilityEngine,
  rule: PromotionRuleDto,
  request: EvaluatePromotionRequestDto,
  time: Date,
  subtotal: number,
  exclusions: {
    hasCartLevelExclusion: boolean;
    paymentMethodExcluded: boolean;
    shippingMethodExcluded: boolean;
    eligibleCartItemIds: string[];
  }
) => EngineErrorCode | null;

export class PromotionEligibilityEngine {
  private static readonly OPERATOR_EVALUATORS: Record<
    RuleOperator,
    (fieldValue: any, targetValue: any) => boolean
  > = {
    [RuleOperator.EQUALS]: (f, t) => f === t,
    [RuleOperator.NOT_EQUALS]: (f, t) => f !== t,
    [RuleOperator.GREATER_THAN]: (f, t) => Number(f) > Number(t),
    [RuleOperator.LESS_THAN]: (f, t) => Number(f) < Number(t),
    [RuleOperator.CONTAINS]: (f, t) => typeof f === 'string' && f.includes(String(t)),
    [RuleOperator.IN]: (f, t) => Array.isArray(t) && t.includes(f),
    [RuleOperator.NOT_IN]: (f, t) => Array.isArray(t) && !t.includes(f)
  };

  private static readonly SEGMENT_EVALUATORS: Record<
    CustomerSegmentType,
    (
      engine: PromotionEligibilityEngine,
      segment: CustomerSegmentDto,
      customer: CustomerProfileDto,
      history: CustomerPurchaseHistoryDto
    ) => boolean
  > = {
    [CustomerSegmentType.VIP]: (_e, _s, c) => c.lifetimeSpend >= 1000 || c.orderCount >= 10,
    [CustomerSegmentType.NEW_USER]: (_e, _s, c) => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return c.createdDate >= thirtyDaysAgo && c.orderCount <= 1;
    },
    [CustomerSegmentType.INACTIVE]: (_e, _s, c) => {
      if (!c.lastPurchaseDate) return true;
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      return c.lastPurchaseDate < ninetyDaysAgo;
    },
    [CustomerSegmentType.HIGH_SPENDER]: (_e, _s, _c, h) => {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const recentSpend = h.orders
        .filter((order) => order.orderDate >= sixtyDaysAgo)
        .reduce((sum, order) => sum + order.totalSpent, 0);
      return recentSpend >= 500;
    },
    [CustomerSegmentType.CUSTOM]: (e, s, c) => {
      if (!s.conditions || s.conditions.length === 0) return true;
      return e.evaluateCustomConditions(s.conditions, c);
    }
  };

  private static readonly DISCOUNT_STRATEGIES: Record<
    DiscountType,
    (cart: CartDto, rule: PromotionRuleDto, eligibleSubtotal: number) => number
  > = {
    [DiscountType.PERCENTAGE]: (_cart, rule, subtotal) => subtotal * (rule.discountValue / 100),
    [DiscountType.FIXED_AMOUNT]: (_cart, rule, subtotal) => Math.min(rule.discountValue, subtotal),
    [DiscountType.FREE_SHIPPING]: (cart) => cart.shippingFee,
    [DiscountType.BUY_X_GET_Y]: (cart, rule) => {
      const config = rule.buyXGetYConfig;
      if (!config) return 0;
      const getFreeItem = cart.items.find((item) => item.productId === config.getFreeProductId);
      if (!getFreeItem) return 0;
      const discountableQuantity = Math.min(getFreeItem.quantity, config.getFreeQuantity);
      return discountableQuantity * getFreeItem.unitPrice * (config.discountPercentageForY / 100);
    }
  };

  private static readonly EXCLUSION_HANDLERS: Partial<
    Record<
      ExclusionType,
      (
        exclusion: ExclusionRuleDto,
        cart: CartDto,
        sets: { products: Set<string>; categories: Set<string>; brands: Set<string> }
      ) => { payment?: boolean; shipping?: boolean }
    >
  > = {
    [ExclusionType.PAYMENT_METHOD]: (ex, cart) => ({ payment: cart.paymentMethod === ex.value }),
    [ExclusionType.SHIPPING_METHOD]: (ex, cart) => ({ shipping: cart.shippingMethod === ex.value }),
    [ExclusionType.PRODUCT]: (ex, _cart, sets) => { sets.products.add(ex.value); return {}; },
    [ExclusionType.CATEGORY]: (ex, _cart, sets) => { sets.categories.add(ex.value); return {}; },
    [ExclusionType.BRAND]: (ex, _cart, sets) => { sets.brands.add(ex.value); return {}; }
  };

  private static readonly STACKING_HANDLERS: Record<
    StackingMode,
    {
      isConflicted: (state: StackingState, ruleCategories: string[]) => boolean;
      onApply: (state: StackingState, ruleCategories: string[]) => void;
    }
  > = {
    [StackingMode.NO_STACKING]: {
      isConflicted: (state) => state.isBlocked || state.appliedCount > 0,
      onApply: (state) => { state.isBlocked = true; }
    },
    [StackingMode.EXCLUSIVE_PROMOTION]: {
      isConflicted: (state) => state.isBlocked || state.appliedCount > 0,
      onApply: (state) => { state.isBlocked = true; }
    },
    [StackingMode.EXCLUSIVE_CATEGORY]: {
      isConflicted: (state, cats) => state.isBlocked || cats.some((c) => state.appliedCategories.has(c)),
      onApply: (state, cats) => cats.forEach((c) => state.appliedCategories.add(c))
    },
    [StackingMode.STACK_WITH_ALL]: {
      isConflicted: (state) => state.isBlocked,
      onApply: () => {}
    },
    [StackingMode.MAX_DISCOUNT_CAP]: {
      isConflicted: (state) => state.isBlocked,
      onApply: () => {}
    }
  };

  private static readonly RULE_CHECKS: RuleCheck[] = [
    (_e, r, _req, t) => (t < r.validFrom ? EngineErrorCode.NOT_STARTED : null),
    (_e, r, _req, t) => (t > r.validTo ? EngineErrorCode.EXPIRED_PROMOTION : null),
    (_e, r) => (r.currentTotalUsage >= r.usageLimitTotal ? EngineErrorCode.USAGE_LIMIT_EXCEEDED : null),
    (e, r, req) => (e.calculateCustomerUsage(req.customer.id, r) >= r.usageLimitPerCustomer ? EngineErrorCode.CUSTOMER_USAGE_LIMIT_EXCEEDED : null),
    (_e, r, _req, _t, subtotal) => (subtotal < r.minCartSubtotal ? EngineErrorCode.MIN_SUBTOTAL_NOT_MET : null),
    (e, r, req) => (!e.evaluateCustomerSegments(req.customer, req.purchaseHistory, r) ? EngineErrorCode.SEGMENT_NOT_MATCHED : null),
    (e, r, req) => (!e.checkRequiredProducts(req.cart, r) ? EngineErrorCode.MISSING_REQUIRED_PRODUCTS : null),
    (_e, _r, _req, _t, _s, ex) => (ex.paymentMethodExcluded ? EngineErrorCode.EXCLUDED_PAYMENT_METHOD : null),
    (_e, _r, _req, _t, _s, ex) => (ex.shippingMethodExcluded ? EngineErrorCode.EXCLUDED_SHIPPING_METHOD : null),
    (e, r, req) => (r.discountType === DiscountType.BUY_X_GET_Y && !e.evaluateBuyXGetYCondition(req.cart, r) ? EngineErrorCode.BUY_X_GET_Y_CONDITION_UNMET : null),
    (_e, r, _req, _t, _s, ex) => (ex.eligibleCartItemIds.length === 0 && r.discountType !== DiscountType.FREE_SHIPPING ? EngineErrorCode.EXCLUDED_ITEMS_PRESENT : null)
  ];

  public evaluatePromotions(request: EvaluatePromotionRequestDto): EngineEvaluationResponseDto {
    const evaluationTime = request.evaluationTimestamp || new Date();
    const cartSubtotal = this.calculateCartSubtotal(request.cart);
    const ruleMap = new Map<string, PromotionRuleDto>(
      request.activeRules.map((rule) => [rule.code, rule])
    );

    const evaluationResults = request.requestedPromotionCodes.map((code) => {
      const rule = ruleMap.get(code);
      if (!rule) {
        return {
          promotionCode: code,
          isEligible: false,
          calculatedDiscount: 0,
          ineligibleReasons: [EngineErrorCode.EXPIRED_PROMOTION],
          appliedToItemIds: []
        };
      }

      const exclusionCheck = this.evaluateExclusions(request.cart, rule);
      const reasons = PromotionEligibilityEngine.RULE_CHECKS
        .map((check) => check(this, rule, request, evaluationTime, cartSubtotal, exclusionCheck))
        .filter((reason): reason is EngineErrorCode => reason !== null);

      const isEligible = reasons.length === 0;
      const eligibleItemIds = exclusionCheck.eligibleCartItemIds;
      const discountAmount = isEligible ? this.calculateDiscountValue(request.cart, rule, eligibleItemIds) : 0;

      return {
        promotionCode: code,
        isEligible,
        calculatedDiscount: discountAmount,
        ineligibleReasons: reasons,
        appliedToItemIds: isEligible ? eligibleItemIds : []
      };
    });

    const { applied, disqualified } = this.resolveStackingAndConflicts(evaluationResults, ruleMap, request.cart);

    const hasFreeShipping = applied.some(
      (promo) => ruleMap.get(promo.promotionCode)?.discountType === DiscountType.FREE_SHIPPING
    );
    const finalShippingFee = hasFreeShipping ? 0 : request.cart.shippingFee;
    const totalDiscount = applied
      .filter((promo) => ruleMap.get(promo.promotionCode)?.discountType !== DiscountType.FREE_SHIPPING)
      .reduce((sum, promo) => sum + promo.calculatedDiscount, 0);

    const finalSubtotal = Math.max(0, cartSubtotal - totalDiscount);

    return {
      isValid: applied.length > 0,
      totalDiscount,
      finalCartSubtotal: finalSubtotal,
      finalShippingFee,
      appliedPromotions: applied,
      disqualifiedPromotions: disqualified
    };
  }

  private calculateCartSubtotal(cart: CartDto): number {
    let subtotal = 0;
    for (let i = 0; i < cart.items.length; i++) {
      const item = cart.items[i];
      subtotal += item.unitPrice * item.quantity;
    }
    return subtotal;
  }

  private calculateCustomerUsage(customerId: string, rule: PromotionRuleDto): number {
    return 0;
  }

  private evaluateCustomerSegments(
    customer: CustomerProfileDto,
    history: CustomerPurchaseHistoryDto,
    rule: PromotionRuleDto
  ): boolean {
    if (!rule.eligibleSegmentIds || rule.eligibleSegmentIds.length === 0) {
      return true;
    }

    const customerSegmentIds = new Set<string>();

    for (let i = 0; i < customer.segments.length; i++) {
      const segment = customer.segments[i];
      if (this.isSegmentValid(segment, customer, history)) {
        customerSegmentIds.add(segment.id);
      }
    }

    for (let j = 0; j < rule.eligibleSegmentIds.length; j++) {
      if (customerSegmentIds.has(rule.eligibleSegmentIds[j])) {
        return true;
      }
    }

    return false;
  }

  private isSegmentValid(
    segment: CustomerSegmentDto,
    customer: CustomerProfileDto,
    history: CustomerPurchaseHistoryDto
  ): boolean {
    const evaluator = PromotionEligibilityEngine.SEGMENT_EVALUATORS[segment.type];
    return evaluator ? evaluator(this, segment, customer, history) : false;
  }

  private evaluateCustomConditions(conditions: SegmentConditionDto[], customer: CustomerProfileDto): boolean {
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const fieldValue = this.extractFieldValue(customer, condition.field);

      if (!this.evaluateOperator(fieldValue, condition.operator, condition.value)) {
        return false;
      }
    }
    return true;
  }

  private extractFieldValue(object: any, fieldPath: string): any {
    const parts = fieldPath.split('.');
    let curr = object;
    for (let i = 0; i < parts.length; i++) {
      if (curr === null || curr === undefined) return undefined;
      curr = curr[parts[i]];
    }
    return curr;
  }

  private evaluateOperator(fieldValue: any, operator: RuleOperator, targetValue: any): boolean {
    const handler = PromotionEligibilityEngine.OPERATOR_EVALUATORS[operator];
    return handler ? handler(fieldValue, targetValue) : false;
  }

  private checkRequiredProducts(cart: CartDto, rule: PromotionRuleDto): boolean {
    if (!rule.requiredProductIds || rule.requiredProductIds.length === 0) {
      return true;
    }

    const cartProductIds = new Set<string>();
    for (let i = 0; i < cart.items.length; i++) {
      cartProductIds.add(cart.items[i].productId);
    }

    for (let j = 0; j < rule.requiredProductIds.length; j++) {
      if (!cartProductIds.has(rule.requiredProductIds[j])) {
        return false;
      }
    }

    return true;
  }

  private evaluateExclusions(
    cart: CartDto,
    rule: PromotionRuleDto
  ): {
    hasCartLevelExclusion: boolean;
    paymentMethodExcluded: boolean;
    shippingMethodExcluded: boolean;
    eligibleCartItemIds: string[];
  } {
    const sets = {
      products: new Set<string>(),
      categories: new Set<string>(),
      brands: new Set<string>()
    };

    let paymentMethodExcluded = false;
    let shippingMethodExcluded = false;

    for (const exclusion of rule.exclusions || []) {
      const handler = PromotionEligibilityEngine.EXCLUSION_HANDLERS[exclusion.type];
      if (handler) {
        const res = handler(exclusion, cart, sets);
        if (res.payment) paymentMethodExcluded = true;
        if (res.shipping) shippingMethodExcluded = true;
      }
    }

    const eligibleCartItemIds = cart.items
      .filter(
        (item) =>
          !sets.products.has(item.productId) &&
          !sets.categories.has(item.categoryId) &&
          !sets.brands.has(item.brandId)
      )
      .map((item) => item.productId);

    return {
      hasCartLevelExclusion: paymentMethodExcluded || shippingMethodExcluded,
      paymentMethodExcluded,
      shippingMethodExcluded,
      eligibleCartItemIds
    };
  }

  private evaluateBuyXGetYCondition(cart: CartDto, rule: PromotionRuleDto): boolean {
    if (!rule.buyXGetYConfig) return false;

    const config = rule.buyXGetYConfig;
    let buyQuantityFound = 0;

    for (let i = 0; i < cart.items.length; i++) {
      if (cart.items[i].productId === config.buyProductId) {
        buyQuantityFound += cart.items[i].quantity;
      }
    }

    return buyQuantityFound >= config.buyQuantity;
  }

  private calculateDiscountValue(cart: CartDto, rule: PromotionRuleDto, eligibleItemIds: string[]): number {
    const eligibleSet = new Set(eligibleItemIds);
    const eligibleSubtotal = cart.items
      .filter((item) => eligibleSet.has(item.productId))
      .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    const strategy = PromotionEligibilityEngine.DISCOUNT_STRATEGIES[rule.discountType];
    let calculatedDiscount = strategy ? strategy(cart, rule, eligibleSubtotal) : 0;

    if (rule.maxDiscountAmount !== undefined && rule.maxDiscountAmount > 0) {
      calculatedDiscount = Math.min(calculatedDiscount, rule.maxDiscountAmount);
    }

    return Math.max(0, calculatedDiscount);
  }

  private resolveStackingAndConflicts(
    evaluations: PromotionEvaluationResultDto[],
    ruleMap: Map<string, PromotionRuleDto>,
    cart: CartDto
  ): { applied: PromotionEvaluationResultDto[]; disqualified: PromotionEvaluationResultDto[] } {
    const eligible = evaluations.filter((e) => e.isEligible);
    const disqualified = evaluations.filter((e) => !e.isEligible);

    eligible.sort((a, b) => {
      const priorityA = ruleMap.get(a.promotionCode)?.priority ?? 0;
      const priorityB = ruleMap.get(b.promotionCode)?.priority ?? 0;
      return priorityA !== priorityB ? priorityB - priorityA : b.calculatedDiscount - a.calculatedDiscount;
    });

    const applied: PromotionEvaluationResultDto[] = [];
    const state: StackingState = {
      isBlocked: false,
      appliedCount: 0,
      appliedCategories: new Set<string>()
    };

    for (const evalResult of eligible) {
      const rule = ruleMap.get(evalResult.promotionCode);
      if (!rule) continue;

      const handler = PromotionEligibilityEngine.STACKING_HANDLERS[rule.stackingMode];
      const ruleCategories = this.getCartCategoriesForItems(cart, evalResult.appliedToItemIds);

      if (handler && handler.isConflicted(state, ruleCategories)) {
        disqualified.push({
          ...evalResult,
          isEligible: false,
          ineligibleReasons: [...evalResult.ineligibleReasons, EngineErrorCode.STACKING_CONFLICT]
        });
        continue;
      }

      if (handler) {
        handler.onApply(state, ruleCategories);
      }
      state.appliedCount++;
      applied.push(evalResult);
    }

    return { applied, disqualified };
  }

  private getCartCategoriesForItems(cart: CartDto, itemIds: string[]): string[] {
    const itemSet = new Set(itemIds);
    const categories = new Set<string>();

    for (let i = 0; i < cart.items.length; i++) {
      if (itemSet.has(cart.items[i].productId)) {
        categories.add(cart.items[i].categoryId);
      }
    }

    return Array.from(categories);
  }
}