import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

export enum CustomerSegment {
  RETAIL = 'RETAIL',
  VIP = 'VIP',
  WHOLESALE = 'WHOLESALE',
  NEW_USER = 'NEW_USER',
  EMPLOYEE = 'EMPLOYEE',
}

export enum DemandTrend {
  RISING = 'RISING',
  FALLING = 'FALLING',
  STABLE = 'STABLE',
}

export enum RuleAction {
  MARKUP_PERCENT = 'MARKUP_PERCENT',
  MARKUP_FLAT = 'MARKUP_FLAT',
  DISCOUNT_PERCENT = 'DISCOUNT_PERCENT',
  DISCOUNT_FLAT = 'DISCOUNT_FLAT',
  MATCH_COMPETITOR = 'MATCH_COMPETITOR',
  SET_FIXED = 'SET_FIXED',
}

export enum RoundingMode {
  NEAREST_NINETY_NINE = 'NEAREST_NINETY_NINE',
  STANDARD_TWO_DECIMALS = 'STANDARD_TWO_DECIMALS',
  CEIL_INTEGER = 'CEIL_INTEGER',
  FLOOR_INTEGER = 'FLOOR_INTEGER',
}

export interface ProductPricingConfig {
  productId: string;
  sku: string;
  basePrice: number;
  costBasis: number;
  msrp: number;
  minMarginPercent: number;
  maxMarginPercent: number;
  currentStock: number;
  safetyStock: number;
  reorderPoint: number;
  overstockThreshold: number;
  salesVelocityPerHour: number;
  roundingMode: RoundingMode;
  isPricingActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompetitorPrice {
  id: string;
  productId: string;
  competitorName: string;
  price: number;
  reliabilityScore: number;
  isPriceMatchAllowed: boolean;
  lastScrapedAt: Date;
}

export interface DemandMetric {
  productId: string;
  demandScore: number;
  trend: DemandTrend;
  viewCountLastHour: number;
  cartAddCountLastHour: number;
  conversionRate: number;
  lastUpdatedAt: Date;
}

export interface CustomerSegmentRule {
  id: string;
  segment: CustomerSegment;
  discountPercent: number;
  priority: number;
  isStackable: boolean;
  maxDiscountAmount: number;
  minOrderQuantity: number;
  loyaltyTierMultiplier: number;
}

export interface PricingRule {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  minDemandScore?: number;
  maxDemandScore?: number;
  demandTrend?: DemandTrend;
  minInventoryLevel?: number;
  maxInventoryLevel?: number;
  targetSegment?: CustomerSegment;
  action: RuleAction;
  actionValue: number;
  stopProcessingFurtherRules: boolean;
}

export interface DynamicPricingContext {
  productId: string;
  segment: CustomerSegment;
  quantity: number;
  loyaltyTierLevel?: number;
  requestTimestamp?: Date;
  allowCompetitorMatching?: boolean;
}

export interface AppliedAdjustment {
  source: string;
  ruleId?: string;
  description: string;
  priceBefore: number;
  priceAfter: number;
  delta: number;
}

export interface PricingResult {
  productId: string;
  basePrice: number;
  finalPrice: number;
  unitPrice: number;
  totalPrice: number;
  marginAchievedPercent: number;
  floorPrice: number;
  ceilingPrice: number;
  appliedAdjustments: AppliedAdjustment[];
  flags: {
    isFloorTriggered: boolean;
    isCeilingTriggered: boolean;
    isCompetitorMatched: boolean;
    isSafetyStockProtected: boolean;
    isOverstockDiscounted: boolean;
    isSurgeApplied: boolean;
  };
}

type RuleActionHandler = (currentPrice: number, actionValue: number) => number;

const RULE_ACTION_HANDLERS: Record<RuleAction, RuleActionHandler> = {
  [RuleAction.MARKUP_PERCENT]: (price, val) => price * (1 + val / 100),
  [RuleAction.MARKUP_FLAT]: (price, val) => price + val,
  [RuleAction.DISCOUNT_PERCENT]: (price, val) => price * (1 - val / 100),
  [RuleAction.DISCOUNT_FLAT]: (price, val) => Math.max(0, price - val),
  [RuleAction.SET_FIXED]: (_, val) => val,
  [RuleAction.MATCH_COMPETITOR]: (price) => price,
};

const RULE_EXCLUSION_PREDICATES: Array<
  (rule: PricingRule, product: ProductPricingConfig, demand: DemandMetric | undefined, context: DynamicPricingContext) => boolean
> = [
  (rule, _, demand) => rule.minDemandScore !== undefined && (!demand || demand.demandScore < rule.minDemandScore),
  (rule, _, demand) => rule.maxDemandScore !== undefined && (!!demand && demand.demandScore > rule.maxDemandScore),
  (rule, _, demand) => rule.demandTrend !== undefined && demand?.trend !== rule.demandTrend,
  (rule, product) => rule.minInventoryLevel !== undefined && product.currentStock < rule.minInventoryLevel,
  (rule, product) => rule.maxInventoryLevel !== undefined && product.currentStock > rule.maxInventoryLevel,
  (rule, _, __, context) => rule.targetSegment !== undefined && rule.targetSegment !== context.segment,
];

const DEMAND_SCORE_STRATEGIES: Array<{
  match: (d: DemandMetric) => boolean;
  apply: (d: DemandMetric, flags: { isSurgeApplied: boolean }) => { delta: number; text?: string };
}> = [
  {
    match: (d) => d.demandScore >= 80,
    apply: (d, flags) => {
      flags.isSurgeApplied = true;
      const trendMap: Partial<Record<DemandTrend, { delta: number; text: string }>> = {
        [DemandTrend.RISING]: { delta: 0.20, text: 'High Demand Rising' },
        [DemandTrend.STABLE]: { delta: 0.12, text: 'High Demand Stable' },
      };
      const res = trendMap[d.trend];
      return { delta: res?.delta ?? 0, text: res?.text };
    },
  },
  {
    match: (d) => d.demandScore >= 50 && d.trend === DemandTrend.RISING,
    apply: (_, flags) => {
      flags.isSurgeApplied = true;
      return { delta: 0.08, text: 'Moderate Demand Rising' };
    },
  },
  {
    match: (d) => d.demandScore < 20,
    apply: (d) => {
      const isFalling = d.trend === DemandTrend.FALLING;
      return {
        delta: isFalling ? -0.15 : -0.05,
        text: isFalling ? 'Low Demand Falling' : 'Low Demand',
      };
    },
  },
];

@Injectable()
export class DynamicPricingRepository {
  private readonly products = new Map<string, ProductPricingConfig>();
  private readonly competitorPrices = new Map<string, CompetitorPrice[]>();
  private readonly demandMetrics = new Map<string, DemandMetric>();
  private readonly segmentRules = new Map<string, CustomerSegmentRule>();
  private readonly pricingRules = new Map<string, PricingRule>();
  private readonly priceAuditLogs = new Map<string, AppliedAdjustment[]>();

  public createProduct(config: Omit<ProductPricingConfig, 'createdAt' | 'updatedAt'>): ProductPricingConfig {
    if (this.products.has(config.productId)) {
      throw new ConflictException(`Product with ID ${config.productId} already exists.`);
    }
    if (config.costBasis >= config.basePrice) {
      throw new BadRequestException('Cost basis cannot be greater than or equal to base price.');
    }
    const fullConfig: ProductPricingConfig = {
      ...config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.products.set(config.productId, fullConfig);
    return fullConfig;
  }

  public getProductById(productId: string): ProductPricingConfig {
    const product = this.products.get(productId);
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found.`);
    }
    return product;
  }

  public updateProduct(productId: string, updates: Partial<ProductPricingConfig>): ProductPricingConfig {
    const existing = this.getProductById(productId);
    const updated: ProductPricingConfig = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    if (updated.costBasis >= updated.basePrice) {
      throw new BadRequestException('Updated cost basis cannot exceed or equal base price.');
    }
    this.products.set(productId, updated);
    return updated;
  }

  public deleteProduct(productId: string): boolean {
    this.getProductById(productId);
    this.competitorPrices.delete(productId);
    this.demandMetrics.delete(productId);
    this.priceAuditLogs.delete(productId);
    return this.products.delete(productId);
  }

  public upsertCompetitorPrice(priceData: CompetitorPrice): CompetitorPrice {
    this.getProductById(priceData.productId);
    const list = this.competitorPrices.get(priceData.productId) || [];
    const idx = list.findIndex((c) => c.id === priceData.id || c.competitorName === priceData.competitorName);
    if (idx >= 0) {
      list[idx] = priceData;
    } else {
      list.push(priceData);
    }
    this.competitorPrices.set(priceData.productId, list);
    return priceData;
  }

  public getCompetitorPrices(productId: string): CompetitorPrice[] {
    return this.competitorPrices.get(productId) || [];
  }

  public updateDemandMetric(metric: DemandMetric): DemandMetric {
    this.getProductById(metric.productId);
    this.demandMetrics.set(metric.productId, metric);
    return metric;
  }

  public getDemandMetric(productId: string): DemandMetric | undefined {
    return this.demandMetrics.get(productId);
  }

  public upsertCustomerSegmentRule(rule: CustomerSegmentRule): CustomerSegmentRule {
    this.segmentRules.set(rule.id, rule);
    return rule;
  }

  public deleteCustomerSegmentRule(ruleId: string): boolean {
    if (!this.segmentRules.has(ruleId)) {
      throw new NotFoundException(`Segment rule ${ruleId} not found.`);
    }
    return this.segmentRules.delete(ruleId);
  }

  public upsertPricingRule(rule: PricingRule): PricingRule {
    this.pricingRules.set(rule.id, rule);
    return rule;
  }

  public deletePricingRule(ruleId: string): boolean {
    if (!this.pricingRules.has(ruleId)) {
      throw new NotFoundException(`Pricing rule ${ruleId} not found.`);
    }
    return this.pricingRules.delete(ruleId);
  }

  public calculateDynamicPrice(context: DynamicPricingContext): PricingResult {
    const product = this.getProductById(context.productId);
    if (!product.isPricingActive) {
      throw new BadRequestException(`Pricing engine is disabled for product ${context.productId}`);
    }

    const timestamp = context.requestTimestamp || new Date();
    const adjustments: AppliedAdjustment[] = [];
    const flags = {
      isFloorTriggered: false,
      isCeilingTriggered: false,
      isCompetitorMatched: false,
      isSafetyStockProtected: false,
      isOverstockDiscounted: false,
      isSurgeApplied: false,
    };

    let currentPrice = product.basePrice;
    const floorPrice = product.costBasis * (1 + product.minMarginPercent / 100);
    const ceilingPrice = Math.min(product.msrp, product.costBasis * (1 + product.maxMarginPercent / 100));

    currentPrice = this.recordAdjustment(adjustments, currentPrice, this.applyInventoryRules(product, currentPrice, flags));

    const demandMetric = this.demandMetrics.get(product.productId);
    if (demandMetric) {
      currentPrice = this.recordAdjustment(adjustments, currentPrice, this.applyDemandRules(demandMetric, currentPrice, flags));
    }

    if (context.allowCompetitorMatching !== false) {
      currentPrice = this.recordAdjustment(
        adjustments,
        currentPrice,
        this.applyCompetitorRules(product.productId, currentPrice, floorPrice, flags),
      );
    }

    currentPrice = this.recordAdjustments(
      adjustments,
      currentPrice,
      this.applyConfiguredRules(product, demandMetric, context, currentPrice, timestamp),
    );
    currentPrice = this.recordAdjustments(adjustments, currentPrice, this.applyCustomerSegmentRules(context, currentPrice));
    currentPrice = this.recordAdjustment(adjustments, currentPrice, this.applyTimeBasedMultipliers(timestamp, currentPrice));

    currentPrice = this.enforceMarginBounds(adjustments, currentPrice, floorPrice, ceilingPrice, flags);

    const roundedUnitPrice = this.applyRounding(currentPrice, product.roundingMode);
    const totalPrice = roundedUnitPrice * context.quantity;
    const marginAchievedPercent = ((roundedUnitPrice - product.costBasis) / product.costBasis) * 100;

    this.priceAuditLogs.set(product.productId, [
      ...(this.priceAuditLogs.get(product.productId) || []),
      ...adjustments,
    ]);

    return {
      productId: product.productId,
      basePrice: product.basePrice,
      finalPrice: roundedUnitPrice,
      unitPrice: roundedUnitPrice,
      totalPrice,
      marginAchievedPercent,
      floorPrice,
      ceilingPrice,
      appliedAdjustments: adjustments,
      flags,
    };
  }

  private recordAdjustment(
    adjustments: AppliedAdjustment[],
    currentPrice: number,
    adjustment: AppliedAdjustment,
  ): number {
    if (adjustment.delta !== 0) {
      adjustments.push(adjustment);
      return adjustment.priceAfter;
    }
    return currentPrice;
  }

  private recordAdjustments(
    adjustments: AppliedAdjustment[],
    currentPrice: number,
    newAdjustments: AppliedAdjustment[],
  ): number {
    let price = currentPrice;
    for (const adj of newAdjustments) {
      adjustments.push(adj);
      price = adj.priceAfter;
    }
    return price;
  }

  private enforceMarginBounds(
    adjustments: AppliedAdjustment[],
    currentPrice: number,
    floorPrice: number,
    ceilingPrice: number,
    flags: { isFloorTriggered: boolean; isCeilingTriggered: boolean },
  ): number {
    if (currentPrice < floorPrice) {
      adjustments.push({
        source: 'MARGIN_PROTECTION_FLOOR',
        description: 'Price adjusted up to minimum allowed floor',
        priceBefore: currentPrice,
        priceAfter: floorPrice,
        delta: floorPrice - currentPrice,
      });
      flags.isFloorTriggered = true;
      return floorPrice;
    }
    if (currentPrice > ceilingPrice) {
      adjustments.push({
        source: 'MARGIN_PROTECTION_CEILING',
        description: 'Price adjusted down to maximum allowed ceiling',
        priceBefore: currentPrice,
        priceAfter: ceilingPrice,
        delta: ceilingPrice - currentPrice,
      });
      flags.isCeilingTriggered = true;
      return ceilingPrice;
    }
    return currentPrice;
  }

  private applyInventoryRules(
    product: ProductPricingConfig,
    currentPrice: number,
    flags: { isSafetyStockProtected: boolean; isOverstockDiscounted: boolean },
  ): AppliedAdjustment {
    let priceAfter = currentPrice;
    let description = '';

    if (product.currentStock <= product.safetyStock) {
      priceAfter = currentPrice * 1.3;
      description = 'Safety stock protection surge (+30%)';
      flags.isSafetyStockProtected = true;
    } else if (product.currentStock <= product.reorderPoint) {
      const diffRatio = (product.reorderPoint - product.currentStock) / product.reorderPoint;
      const surgePercent = 0.05 + diffRatio * 0.15;
      priceAfter = currentPrice * (1 + surgePercent);
      description = `Low stock surge (+${(surgePercent * 100).toFixed(2)}%)`;
    } else if (product.currentStock >= product.overstockThreshold) {
      const overstockRatio = (product.currentStock - product.overstockThreshold) / product.overstockThreshold;
      const discountPercent = Math.min(0.25, 0.08 + overstockRatio * 0.1);
      priceAfter = currentPrice * (1 - discountPercent);
      description = `Overstock liquidation discount (-${(discountPercent * 100).toFixed(2)}%)`;
      flags.isOverstockDiscounted = true;
    }

    return {
      source: 'INVENTORY_ENGINE',
      description,
      priceBefore: currentPrice,
      priceAfter,
      delta: priceAfter - currentPrice,
    };
  }

  private applyDemandRules(
    demand: DemandMetric,
    currentPrice: number,
    flags: { isSurgeApplied: boolean },
  ): AppliedAdjustment {
    let multiplier = 1.0;
    const descParts: string[] = [];

    const matchedStrategy = DEMAND_SCORE_STRATEGIES.find((s) => s.match(demand));
    if (matchedStrategy) {
      const result = matchedStrategy.apply(demand, flags);
      multiplier += result.delta;
      if (result.text) {
        descParts.push(result.text);
      }
    }

    if (demand.conversionRate < 0.02 && demand.viewCountLastHour > 100) {
      multiplier -= 0.05;
      descParts.push('High Views Low Conversion');
    }

    const priceAfter = currentPrice * multiplier;
    return {
      source: 'DEMAND_ENGINE',
      description: descParts.length > 0 ? descParts.join(', ') : 'Demand standard baseline',
      priceBefore: currentPrice,
      priceAfter,
      delta: priceAfter - currentPrice,
    };
  }

  private applyCompetitorRules(
    productId: string,
    currentPrice: number,
    floorPrice: number,
    flags: { isCompetitorMatched: boolean },
  ): AppliedAdjustment {
    const competitors = this.getCompetitorPrices(productId);
    if (!competitors || competitors.length === 0) {
      return {
        source: 'COMPETITOR_ENGINE',
        description: 'No competitor data',
        priceBefore: currentPrice,
        priceAfter: currentPrice,
        delta: 0,
      };
    }

    const validCompetitors = competitors.filter(
      (c) => c.reliabilityScore >= 0.6 && c.isPriceMatchAllowed,
    );

    if (validCompetitors.length === 0) {
      return {
        source: 'COMPETITOR_ENGINE',
        description: 'No reliable competitors available for matching',
        priceBefore: currentPrice,
        priceAfter: currentPrice,
        delta: 0,
      };
    }

    let minCompetitorPrice = Infinity;
    let chosenCompetitor: CompetitorPrice | null = null;

    for (const comp of validCompetitors) {
      if (comp.price < minCompetitorPrice) {
        minCompetitorPrice = comp.price;
        chosenCompetitor = comp;
      }
    }

    if (chosenCompetitor && minCompetitorPrice < currentPrice) {
      const targetUndercutPrice = minCompetitorPrice * 0.99;
      if (targetUndercutPrice >= floorPrice) {
        flags.isCompetitorMatched = true;
        return {
          source: 'COMPETITOR_ENGINE',
          description: `Undercut competitor ${chosenCompetitor.competitorName} by 1%`,
          priceBefore: currentPrice,
          priceAfter: targetUndercutPrice,
          delta: targetUndercutPrice - currentPrice,
        };
      } else if (minCompetitorPrice >= floorPrice) {
        flags.isCompetitorMatched = true;
        return {
          source: 'COMPETITOR_ENGINE',
          description: `Exact price match with competitor ${chosenCompetitor.competitorName} bounded by floor`,
          priceBefore: currentPrice,
          priceAfter: minCompetitorPrice,
          delta: minCompetitorPrice - currentPrice,
        };
      }
    }

    return {
      source: 'COMPETITOR_ENGINE',
      description: 'Current price already competitive or competitor below margin floor',
      priceBefore: currentPrice,
      priceAfter: currentPrice,
      delta: 0,
    };
  }

  private isRuleActiveAt(rule: PricingRule, timestamp: Date): boolean {
    if (!rule.isActive) return false;
    if (rule.validFrom && rule.validFrom > timestamp) return false;
    if (rule.validTo && rule.validTo < timestamp) return false;
    return true;
  }

  private isRuleApplicable(
    rule: PricingRule,
    product: ProductPricingConfig,
    demand: DemandMetric | undefined,
    context: DynamicPricingContext,
  ): boolean {
    return !RULE_EXCLUSION_PREDICATES.some((isExcluded) => isExcluded(rule, product, demand, context));
  }

  private calculateRulePrice(action: RuleAction, currentPrice: number, value: number): number {
    const handler = RULE_ACTION_HANDLERS[action];
    return handler ? handler(currentPrice, value) : currentPrice;
  }

  private applyConfiguredRules(
    product: ProductPricingConfig,
    demand: DemandMetric | undefined,
    context: DynamicPricingContext,
    startingPrice: number,
    timestamp: Date,
  ): AppliedAdjustment[] {
    const adjustments: AppliedAdjustment[] = [];
    let currentPrice = startingPrice;

    const activeRules = Array.from(this.pricingRules.values())
      .filter((r) => this.isRuleActiveAt(r, timestamp))
      .sort((a, b) => b.priority - a.priority);

    for (const rule of activeRules) {
      if (!this.isRuleApplicable(rule, product, demand, context)) {
        continue;
      }

      const priceBefore = currentPrice;
      const priceAfter = this.calculateRulePrice(rule.action, currentPrice, rule.actionValue);

      adjustments.push({
        source: `DYNAMIC_RULE:${rule.id}:${rule.name}`,
        description: `Applied rule action ${rule.action} with value ${rule.actionValue}`,
        priceBefore,
        priceAfter,
        delta: priceAfter - priceBefore,
      });

      currentPrice = priceAfter;

      if (rule.stopProcessingFurtherRules) {
        break;
      }
    }

    return adjustments;
  }

  private applyCustomerSegmentRules(
    context: DynamicPricingContext,
    startingPrice: number,
  ): AppliedAdjustment[] {
    const adjustments: AppliedAdjustment[] = [];
    let currentPrice = startingPrice;

    const segmentRules = Array.from(this.segmentRules.values())
      .filter((s) => s.segment === context.segment)
      .filter((s) => context.quantity >= s.minOrderQuantity)
      .sort((a, b) => b.priority - a.priority);

    if (segmentRules.length === 0) {
      return adjustments;
    }

    let nonStackableApplied = false;

    for (const rule of segmentRules) {
      if (nonStackableApplied) {
        break;
      }

      let discountPercent = rule.discountPercent;
      if (context.loyaltyTierLevel && context.loyaltyTierLevel > 1) {
        discountPercent += (context.loyaltyTierLevel - 1) * rule.loyaltyTierMultiplier;
      }

      let rawDiscount = currentPrice * (discountPercent / 100);
      if (rule.maxDiscountAmount > 0) {
        rawDiscount = Math.min(rawDiscount, rule.maxDiscountAmount);
      }

      const priceBefore = currentPrice;
      const priceAfter = currentPrice - rawDiscount;

      adjustments.push({
        source: `SEGMENT_RULE:${rule.segment}:${rule.id}`,
        description: `Segment discount ${discountPercent}% applied (Max cap: ${rule.maxDiscountAmount})`,
        priceBefore,
        priceAfter,
        delta: priceAfter - priceBefore,
      });

      currentPrice = priceAfter;

      if (!rule.isStackable) {
        nonStackableApplied = true;
      }
    }

    return adjustments;
  }

  private applyTimeBasedMultipliers(timestamp: Date, currentPrice: number): AppliedAdjustment {
    const hour = timestamp.getUTCHours();
    const day = timestamp.getUTCDay();
    let multiplier = 1.0;
    let description = 'Standard time window';

    if (day >= 1 && day <= 5) {
      if (hour >= 18 && hour <= 21) {
        multiplier = 1.08;
        description = 'Weekday evening peak multiplier (+8%)';
      } else if (hour >= 2 && hour <= 5) {
        multiplier = 0.95;
        description = 'Off-peak night time discount (-5%)';
      }
    } else {
      if (hour >= 12 && hour <= 20) {
        multiplier = 1.10;
        description = 'Weekend peak hours multiplier (+10%)';
      }
    }

    const priceAfter = currentPrice * multiplier;
    return {
      source: 'TIME_OF_DAY_ENGINE',
      description,
      priceBefore: currentPrice,
      priceAfter,
      delta: priceAfter - currentPrice,
    };
  }

  private applyRounding(price: number, mode: RoundingMode): number {
    switch (mode) {
      case RoundingMode.NEAREST_NINETY_NINE: {
        const dollars = Math.floor(price);
        return dollars + 0.99;
      }
      case RoundingMode.CEIL_INTEGER: {
        return Math.ceil(price);
      }
      case RoundingMode.FLOOR_INTEGER: {
        return Math.floor(price);
      }
      case RoundingMode.STANDARD_TWO_DECIMALS:
      default: {
        return Math.round(price * 100) / 100;
      }
    }
  }

  public getAuditLogs(productId: string): AppliedAdjustment[] {
    return this.priceAuditLogs.get(productId) || [];
  }

  public clearAllData(): void {
    this.products.clear();
    this.competitorPrices.clear();
    this.demandMetrics.clear();
    this.segmentRules.clear();
    this.pricingRules.clear();
    this.priceAuditLogs.clear();
  }
}