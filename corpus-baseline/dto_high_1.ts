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
import { Type } from 'class-transformer';

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
    return `${args.property} must be later than ${relatedPropertyName}`;
  }
}

export function IsAfterDate(property: string, validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [property],
      validator: IsAfterDateConstraint
    });
  };
}

@ValidatorConstraint({ name: 'UniqueArrayConstraint', async: false })
export class UniqueArrayConstraint implements ValidatorConstraintInterface {
  validate(value: any[]): boolean {
    if (!Array.isArray(value)) return false;
    return new Set(value).size === value.length;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} contains duplicate values`;
  }
}

export function IsUniqueArray(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
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

export class PromotionEligibilityEngine {
  public evaluatePromotions(request: EvaluatePromotionRequestDto): EngineEvaluationResponseDto {
    const evaluationTime = request.evaluationTimestamp ?? new Date();
    const cartSubtotal = this.calculateCartSubtotal(request.cart);
    const ruleMap = new Map<string, PromotionRuleDto>(
      request.activeRules.map((rule) => [rule.code, rule])
    );

    const evaluationResults: PromotionEvaluationResultDto[] = [];

    for (const code of request.requestedPromotionCodes) {
      const rule = ruleMap.get(code);

      if (!rule) {
        evaluationResults.push({
          promotionCode: code,
          isEligible: false,
          calculatedDiscount: 0,
          ineligibleReasons: [EngineErrorCode.EXPIRED_PROMOTION],
          appliedToItemIds: []
        });
        continue;
      }

      const reasons: EngineErrorCode[] = [];

      if (evaluationTime < rule.validFrom) {
        reasons.push(EngineErrorCode.NOT_STARTED);
      }
      if (evaluationTime > rule.validTo) {
        reasons.push(EngineErrorCode.EXPIRED_PROMOTION);
      }
      if (rule.currentTotalUsage >= rule.usageLimitTotal) {
        reasons.push(EngineErrorCode.USAGE_LIMIT_EXCEEDED);
      }

      const customerUsageCount = this.calculateCustomerUsage(request.customer.id, rule);
      if (customerUsageCount >= rule.usageLimitPerCustomer) {
        reasons.push(EngineErrorCode.CUSTOMER_USAGE_LIMIT_EXCEEDED);
      }

      if (cartSubtotal < rule.minCartSubtotal) {
        reasons.push(EngineErrorCode.MIN_SUBTOTAL_NOT_MET);
      }

      const segmentMatch = this.evaluateCustomerSegments(request.customer, request.purchaseHistory, rule);
      if (!segmentMatch) {
        reasons.push(EngineErrorCode.SEGMENT_NOT_MATCHED);
      }

      const requiredProductsMatch = this.checkRequiredProducts(request.cart, rule);
      if (!requiredProductsMatch) {
        reasons.push(EngineErrorCode.MISSING_REQUIRED_PRODUCTS);
      }

      const exclusionCheck = this.evaluateExclusions(request.cart, rule);
      if (exclusionCheck.hasCartLevelExclusion) {
        if (exclusionCheck.paymentMethodExcluded) {
          reasons.push(EngineErrorCode.EXCLUDED_PAYMENT_METHOD);
        }
        if (exclusionCheck.shippingMethodExcluded) {
          reasons.push(EngineErrorCode.EXCLUDED_SHIPPING_METHOD);
        }
      }

      if (rule.discountType === DiscountType.BUY_X_GET_Y) {
        const buyXValid = this.evaluateBuyXGetYCondition(request.cart, rule);
        if (!buyXValid) {
          reasons.push(EngineErrorCode.BUY_X_GET_Y_CONDITION_UNMET);
        }
      }

      const eligibleItemIds = exclusionCheck.eligibleCartItemIds;

      if (eligibleItemIds.length === 0 && rule.discountType !== DiscountType.FREE_SHIPPING) {
        reasons.push(EngineErrorCode.EXCLUDED_ITEMS_PRESENT);
      }

      const isEligible = reasons.length === 0;
      const discountAmount = isEligible
        ? this.calculateDiscountValue(request.cart, rule, eligibleItemIds)
        : 0;

      evaluationResults.push({
        promotionCode: code,
        isEligible,
        calculatedDiscount: discountAmount,
        ineligibleReasons: reasons,
        appliedToItemIds: isEligible ? eligibleItemIds : []
      });
    }

    const { applied, disqualified } = this.resolveStackingAndConflicts(evaluationResults, ruleMap, request.cart);

    let totalDiscount = 0;
    let finalShippingFee = request.cart.shippingFee;

    for (const appliedPromo of applied) {
      const rule = ruleMap.get(appliedPromo.promotionCode);
      if (rule?.discountType === DiscountType.FREE_SHIPPING) {
        finalShippingFee = 0;
      } else {
        totalDiscount += appliedPromo.calculatedDiscount;
      }
    }

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
    return cart.items.reduce((subtotal, item) => subtotal + item.unitPrice * item.quantity, 0);
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

    const customerSegmentIds = new Set(
      customer.segments
        .filter((segment) => this.isSegmentValid(segment, customer, history))
        .map((segment) => segment.id)
    );

    return rule.eligibleSegmentIds.some((id) => customerSegmentIds.has(id));
  }

  private isSegmentValid(
    segment: CustomerSegmentDto,
    customer: CustomerProfileDto,
    history: CustomerPurchaseHistoryDto
  ): boolean {
    switch (segment.type) {
      case CustomerSegmentType.VIP:
        return customer.lifetimeSpend >= 1000 || customer.orderCount >= 10;

      case CustomerSegmentType.NEW_USER: {
        const thirtyDaysAgo = this.getDaysAgo(30);
        return customer.createdDate >= thirtyDaysAgo && customer.orderCount <= 1;
      }

      case CustomerSegmentType.INACTIVE: {
        if (!customer.lastPurchaseDate) return true;
        const ninetyDaysAgo = this.getDaysAgo(90);
        return customer.lastPurchaseDate < ninetyDaysAgo;
      }

      case CustomerSegmentType.HIGH_SPENDER: {
        const sixtyDaysAgo = this.getDaysAgo(60);
        const recentSpend = history.orders
          .filter((order) => order.orderDate >= sixtyDaysAgo)
          .reduce((sum, order) => sum + order.totalSpent, 0);

        return recentSpend >= 500;
      }

      case CustomerSegmentType.CUSTOM:
        if (!segment.conditions || segment.conditions.length === 0) {
          return true;
        }
        return this.evaluateCustomConditions(segment.conditions, customer);

      default:
        return false;
    }
  }

  private getDaysAgo(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  private evaluateCustomConditions(conditions: SegmentConditionDto[], customer: CustomerProfileDto): boolean {
    return conditions.every((condition) => {
      const fieldValue = this.extractFieldValue(customer, condition.field);
      return this.evaluateOperator(fieldValue, condition.operator, condition.value);
    });
  }

  private extractFieldValue(object: any, fieldPath: string): any {
    return fieldPath.split('.').reduce((curr, part) => (curr == null ? undefined : curr[part]), object);
  }

  private evaluateOperator(fieldValue: any, operator: RuleOperator, targetValue: any): boolean {
    switch (operator) {
      case RuleOperator.EQUALS:
        return fieldValue === targetValue;
      case RuleOperator.NOT_EQUALS:
        return fieldValue !== targetValue;
      case RuleOperator.GREATER_THAN:
        return Number(fieldValue) > Number(targetValue);
      case RuleOperator.LESS_THAN:
        return Number(fieldValue) < Number(targetValue);
      case RuleOperator.CONTAINS:
        return typeof fieldValue === 'string' && fieldValue.includes(String(targetValue));
      case RuleOperator.IN:
        return Array.isArray(targetValue) && targetValue.includes(fieldValue);
      case RuleOperator.NOT_IN:
        return Array.isArray(targetValue) && !targetValue.includes(fieldValue);
      default:
        return false;
    }
  }

  private checkRequiredProducts(cart: CartDto, rule: PromotionRuleDto): boolean {
    if (!rule.requiredProductIds || rule.requiredProductIds.length === 0) {
      return true;
    }

    const cartProductIds = new Set(cart.items.map((item) => item.productId));
    return rule.requiredProductIds.every((requiredId) => cartProductIds.has(requiredId));
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
    let paymentMethodExcluded = false;
    let shippingMethodExcluded = false;

    const excludedProductIds = new Set<string>();
    const excludedCategoryIds = new Set<string>();
    const excludedBrandIds = new Set<string>();

    if (rule.exclusions && rule.exclusions.length > 0) {
      for (const exclusion of rule.exclusions) {
        switch (exclusion.type) {
          case ExclusionType.PAYMENT_METHOD:
            if (cart.paymentMethod === exclusion.value) {
              paymentMethodExcluded = true;
            }
            break;
          case ExclusionType.SHIPPING_METHOD:
            if (cart.shippingMethod === exclusion.value) {
              shippingMethodExcluded = true;
            }
            break;
          case ExclusionType.PRODUCT:
            excludedProductIds.add(exclusion.value);
            break;
          case ExclusionType.CATEGORY:
            excludedCategoryIds.add(exclusion.value);
            break;
          case ExclusionType.BRAND:
            excludedBrandIds.add(exclusion.value);
            break;
        }
      }
    }

    const eligibleCartItemIds = cart.items
      .filter((item) => !excludedProductIds.has(item.productId) && !excludedCategoryIds.has(item.categoryId) && !excludedBrandIds.has(item.brandId))
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
    const buyQuantityFound = cart.items
      .filter((item) => item.productId === config.buyProductId)
      .reduce((sum, item) => sum + item.quantity, 0);

    return buyQuantityFound >= config.buyQuantity;
  }

  private calculateDiscountValue(cart: CartDto, rule: PromotionRuleDto, eligibleItemIds: string[]): number {
    const eligibleSet = new Set(eligibleItemIds);
    const eligibleSubtotal = cart.items
      .filter((item) => eligibleSet.has(item.productId))
      .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    let calculatedDiscount = 0;

    switch (rule.discountType) {
      case DiscountType.PERCENTAGE:
        calculatedDiscount = eligibleSubtotal * (rule.discountValue / 100);
        break;

      case DiscountType.FIXED_AMOUNT:
        calculatedDiscount = Math.min(rule.discountValue, eligibleSubtotal);
        break;

      case DiscountType.FREE_SHIPPING:
        calculatedDiscount = cart.shippingFee;
        break;

      case DiscountType.BUY_X_GET_Y: {
        if (!rule.buyXGetYConfig) break;
        const config = rule.buyXGetYConfig;
        const getFreeItem = cart.items.find((item) => item.productId === config.getFreeProductId);

        if (getFreeItem) {
          const discountableQuantity = Math.min(getFreeItem.quantity, config.getFreeQuantity);
          const baseDiscountPrice = discountableQuantity * getFreeItem.unitPrice;
          calculatedDiscount = baseDiscountPrice * (config.discountPercentageForY / 100);
        }
        break;
      }
    }

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
      const ruleA = ruleMap.get(a.promotionCode);
      const ruleB = ruleMap.get(b.promotionCode);
      const priorityA = ruleA?.priority ?? 0;
      const priorityB = ruleB?.priority ?? 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }
      return b.calculatedDiscount - a.calculatedDiscount;
    });

    const applied: PromotionEvaluationResultDto[] = [];
    let hasExclusive = false;
    let hasNoStacking = false;
    const appliedCategories = new Set<string>();

    for (const evalResult of eligible) {
      const rule = ruleMap.get(evalResult.promotionCode);

      if (!rule) continue;

      if (hasNoStacking || hasExclusive) {
        disqualified.push({
          ...evalResult,
          isEligible: false,
          ineligibleReasons: [...evalResult.ineligibleReasons, EngineErrorCode.STACKING_CONFLICT]
        });
        continue;
      }

      if (rule.stackingMode === StackingMode.NO_STACKING) {
        if (applied.length > 0) {
          disqualified.push({
            ...evalResult,
            isEligible: false,
            ineligibleReasons: [...evalResult.ineligibleReasons, EngineErrorCode.STACKING_CONFLICT]
          });
        } else {
          hasNoStacking = true;
          applied.push(evalResult);
        }
        continue;
      }

      if (rule.stackingMode === StackingMode.EXCLUSIVE_PROMOTION) {
        if (applied.length > 0) {
          disqualified.push({
            ...evalResult,
            isEligible: false,
            ineligibleReasons: [...evalResult.ineligibleReasons, EngineErrorCode.STACKING_CONFLICT]
          });
        } else {
          hasExclusive = true;
          applied.push(evalResult);
        }
        continue;
      }

      if (rule.stackingMode === StackingMode.EXCLUSIVE_CATEGORY) {
        const ruleCategories = this.getCartCategoriesForItems(cart, evalResult.appliedToItemIds);
        const categoryConflict = ruleCategories.some((cat) => appliedCategories.has(cat));

        if (categoryConflict) {
          disqualified.push({
            ...evalResult,
            isEligible: false,
            ineligibleReasons: [...evalResult.ineligibleReasons, EngineErrorCode.STACKING_CONFLICT]
          });
        } else {
          ruleCategories.forEach((cat) => appliedCategories.add(cat));
          applied.push(evalResult);
        }
        continue;
      }

      applied.push(evalResult);
    }

    return { applied, disqualified };
  }

  private getCartCategoriesForItems(cart: CartDto, itemIds: string[]): string[] {
    const itemSet = new Set(itemIds);
    const categories = new Set<string>();

    for (const item of cart.items) {
      if (itemSet.has(item.productId)) {
        categories.add(item.categoryId);
      }
    }

    return Array.from(categories);
  }
}