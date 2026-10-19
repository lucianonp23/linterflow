import { Injectable, NestMiddleware, HttpStatus, HttpException } from '@nestjs/common';

export interface SupplierProfile {
  id: string;
  name: string;
  tier: 'PREFERRED' | 'SECONDARY' | 'SPOT_MARKET' | 'RESTRICTED';
  reliabilityScore: number;
  baseLeadTimeDays: number;
  leadTimeVarianceDays: number;
  minOrderValue: number;
  operationalDaysMask: number[];
  blackoutDates: string[];
}

export interface InventoryItem {
  sku: string;
  category: 'PERISHABLE' | 'HAZMAT' | 'BULK' | 'STANDARD' | 'COLD_STORAGE';
  currentStock: number;
  onOrderStock: number;
  allocatedStock: number;
  backorders: number;
  avgDailyDemand: number;
  demandStdDev: number;
  unitCost: number;
  unitVolumeCBM: number;
  unitWeightKG: number;
  moq: number;
  maxOq: number;
  packSize: number;
  targetServiceLevel: number;
  shelfLifeDays?: number;
  expiryDate?: string;
  storageZone: 'AMBIENT' | 'COLD' | 'FROZEN' | 'HAZARDOUS';
}

export interface SeasonalityRule {
  month: number;
  demandMultiplier: number;
  peakEventName?: string;
  peakMultiplier?: number;
}

export interface WarehouseCapacity {
  id: string;
  maxVolumeCBM: number;
  maxWeightKG: number;
  availableVolumeCBM: number;
  availableWeightKG: number;
  zoneCapacities: {
    AMBIENT: { maxCBM: number; currentCBM: number };
    COLD: { maxCBM: number; currentCBM: number };
    FROZEN: { maxCBM: number; currentCBM: number };
    HAZARDOUS: { maxCBM: number; currentCBM: number };
  };
}

export interface GlobalPlannerParams {
  planningHorizonDays: number;
  budgetLimit: number;
  allowPartialOrders: boolean;
  emergencyProcurementMode: boolean;
  targetDate: string;
}

export interface ReorderPlannerPayload {
  supplier: SupplierProfile;
  warehouse: WarehouseCapacity;
  items: InventoryItem[];
  seasonalityRules: SeasonalityRule[];
  params: GlobalPlannerParams;
}

export interface CalculatedReorderItem {
  sku: string;
  category: string;
  calculatedLeadTime: number;
  adjustedDailyDemand: number;
  leadTimeDemand: number;
  zScore: number;
  safetyStock: number;
  reorderPoint: number;
  netRequirement: number;
  finalOrderQuantity: number;
  totalCost: number;
  totalVolumeCBM: number;
  totalWeightKG: number;
  allocatedZone: string;
  warnings: string[];
  status: 'OPTIMAL' | 'ADJUSTED_MOQ' | 'CAPACITY_SCALED' | 'EXPIRED_SKIPPED' | 'RESTRICTED_REJECTED' | 'BUDGET_CAP';
}

export interface PlanningContext {
  planningTimestamp: string;
  totalOrderValue: number;
  totalVolumeCBM: number;
  totalWeightKG: number;
  budgetUtilizationPct: number;
  capacityUtilizationPct: number;
  processedItems: CalculatedReorderItem[];
  rejectedItems: CalculatedReorderItem[];
  globalWarnings: string[];
}

@Injectable()
export class ReorderPlannerMiddleware implements NestMiddleware {
  public use(req: any, res: any, next: () => void): void {
    if (!this.isValidRoute(req)) {
      return next();
    }

    const payload: ReorderPlannerPayload = req.body;

    if (!this.isValidPayload(payload)) {
      throw new HttpException(
        'Invalid reorder planner payload structure',
        HttpStatus.BAD_REQUEST,
      );
    }

    const context = this.processReorderPlan(payload);

    this.validatePlanningContext(context, payload.params.allowPartialOrders);

    req.reorderPlanContext = context;
    req.headers['x-reorder-plan-processed'] = 'true';
    req.headers['x-reorder-total-value'] = context.totalOrderValue.toFixed(2);

    next();
  }

  private isValidRoute(req: any): boolean {
    const isMethodAllowed = req.method === 'POST' || req.method === 'PUT';
    const isPlannerPath = Boolean(req.path && req.path.includes('/reorder-planner'));
    return isMethodAllowed && isPlannerPath;
  }

  private isValidPayload(payload: ReorderPlannerPayload): boolean {
    return Boolean(
      payload &&
      payload.supplier &&
      payload.warehouse &&
      payload.items &&
      payload.params
    );
  }

  private validatePlanningContext(context: PlanningContext, allowPartialOrders: boolean): void {
    if (context.rejectedItems.length > 0 && !allowPartialOrders && context.processedItems.length === 0) {
      throw new HttpException(
        {
          message: 'Reorder planning failed due to unresolvable supply chain constraints',
          context,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private processReorderPlan(payload: ReorderPlannerPayload): PlanningContext {
    const { supplier, warehouse, items, seasonalityRules, params } = payload;
    const globalWarnings: string[] = [];
    const processedItems: CalculatedReorderItem[] = [];
    const rejectedItems: CalculatedReorderItem[] = [];

    const targetDate = params.targetDate ? new Date(params.targetDate) : new Date();
    const currentMonth = targetDate.getMonth() + 1;

    let availableBudget = params.budgetLimit > 0 ? params.budgetLimit : Number.MAX_SAFE_INTEGER;
    let accumulatedVolume = 0;
    let accumulatedWeight = 0;

    const currentZoneVolume: Record<'AMBIENT' | 'COLD' | 'FROZEN' | 'HAZARDOUS', number> = {
      AMBIENT: warehouse.zoneCapacities.AMBIENT.currentCBM,
      COLD: warehouse.zoneCapacities.COLD.currentCBM,
      FROZEN: warehouse.zoneCapacities.FROZEN.currentCBM,
      HAZARDOUS: warehouse.zoneCapacities.HAZARDOUS.currentCBM,
    };

    if (supplier.tier === 'RESTRICTED' && !params.emergencyProcurementMode) {
      globalWarnings.push(`Supplier ${supplier.name} is RESTRICTED. Non-emergency orders blocked.`);
    }

    const state = {
      get budget() { return availableBudget; },
      set budget(v) { availableBudget = v; },
      get volume() { return accumulatedVolume; },
      set volume(v) { accumulatedVolume = v; },
      get weight() { return accumulatedWeight; },
      set weight(v) { accumulatedWeight = v; },
    };

    for (let i = 0; i < items.length; i++) {
      this.processItem(
        items[i],
        supplier,
        warehouse,
        seasonalityRules,
        params,
        targetDate,
        currentMonth,
        currentZoneVolume,
        processedItems,
        rejectedItems,
        state
      );
    }

    const totalOrderValue = processedItems.reduce((acc, curr) => acc + curr.totalCost, 0);

    this.checkMinOrderValue(supplier, params, totalOrderValue, processedItems, globalWarnings);

    const capacityUtilizationPct = (accumulatedVolume / (warehouse.maxVolumeCBM || 1)) * 100;
    const budgetUtilizationPct = params.budgetLimit > 0 ? (totalOrderValue / params.budgetLimit) * 100 : 0;

    return {
      planningTimestamp: new Date().toISOString(),
      totalOrderValue,
      totalVolumeCBM: accumulatedVolume,
      totalWeightKG: accumulatedWeight,
      budgetUtilizationPct,
      capacityUtilizationPct,
      processedItems,
      rejectedItems,
      globalWarnings,
    };
  }

  private isSupplierRestricted(supplier: SupplierProfile, params: GlobalPlannerParams): boolean {
    return supplier.tier === 'RESTRICTED' && !params.emergencyProcurementMode;
  }

  private calculateItemRequirement(
    item: InventoryItem,
    supplier: SupplierProfile,
    seasonalityRules: SeasonalityRule[],
    currentMonth: number,
    itemWarnings: string[]
  ) {
    const effectiveLeadTime = this.calculateLeadTime(supplier, itemWarnings);
    const { seasonalityMultiplier, peakMultiplier } = this.getSeasonalityMultipliers(seasonalityRules, currentMonth, itemWarnings);

    const adjustedDailyDemand = item.avgDailyDemand * seasonalityMultiplier * peakMultiplier;
    const leadTimeDemand = adjustedDailyDemand * effectiveLeadTime;

    const { zScore, safetyStock } = this.calculateSafetyStock(item, effectiveLeadTime, adjustedDailyDemand, supplier.leadTimeVarianceDays, itemWarnings);

    const reorderPoint = leadTimeDemand + safetyStock;
    const netRequirement = reorderPoint + item.backorders - (item.currentStock + item.onOrderStock - item.allocatedStock);

    return {
      effectiveLeadTime,
      adjustedDailyDemand,
      leadTimeDemand,
      zScore,
      safetyStock,
      reorderPoint,
      netRequirement,
    };
  }

  private evaluateOrderQuantity(
    item: InventoryItem,
    netRequirement: number,
    warehouse: WarehouseCapacity,
    currentZoneVol: number,
    params: GlobalPlannerParams,
    state: { budget: number; volume: number; weight: number },
    itemWarnings: string[]
  ): { rawQty: number; status: CalculatedReorderItem['status']; rejectedItem?: CalculatedReorderItem } {
    const moqResult = this.adjustQuantityForMOQAndPack(netRequirement, item, params.emergencyProcurementMode, itemWarnings);
    if (moqResult.skipped) {
      return { rawQty: 0, status: 'OPTIMAL' };
    }

    const budgetResult = this.applyBudgetConstraint(item, moqResult.rawQty, state.budget, params.allowPartialOrders, itemWarnings);
    if (budgetResult.rejectedItem) {
      return { rawQty: 0, status: 'OPTIMAL', rejectedItem: budgetResult.rejectedItem };
    }

    const capacityResult = this.applyCapacityConstraint(
      item,
      budgetResult.rawQty,
      warehouse,
      currentZoneVol,
      params.allowPartialOrders,
      itemWarnings
    );
    if (capacityResult.rejectedItem) {
      return { rawQty: 0, status: 'OPTIMAL', rejectedItem: capacityResult.rejectedItem };
    }

    const status = capacityResult.statusAdjustment || budgetResult.statusAdjustment || moqResult.status;
    return { rawQty: capacityResult.rawQty, status };
  }

  private recordProcessedItem(
    item: InventoryItem,
    metrics: ReturnType<typeof ReorderPlannerMiddleware.prototype.calculateItemRequirement>,
    rawQty: number,
    status: CalculatedReorderItem['status'],
    itemWarnings: string[],
    state: { budget: number; volume: number; weight: number },
    currentZoneVolume: Record<'AMBIENT' | 'COLD' | 'FROZEN' | 'HAZARDOUS', number>,
    processedItems: CalculatedReorderItem[]
  ): void {
    const totalCost = rawQty * item.unitCost;
    const totalVolume = rawQty * item.unitVolumeCBM;
    const totalWeight = rawQty * item.unitWeightKG;

    state.budget -= totalCost;
    state.volume += totalVolume;
    state.weight += totalWeight;
    currentZoneVolume[item.storageZone] = (currentZoneVolume[item.storageZone] || 0) + totalVolume;

    processedItems.push({
      sku: item.sku,
      category: item.category,
      calculatedLeadTime: metrics.effectiveLeadTime,
      adjustedDailyDemand: metrics.adjustedDailyDemand,
      leadTimeDemand: metrics.leadTimeDemand,
      zScore: metrics.zScore,
      safetyStock: metrics.safetyStock,
      reorderPoint: metrics.reorderPoint,
      netRequirement: metrics.netRequirement,
      finalOrderQuantity: rawQty,
      totalCost,
      totalVolumeCBM: totalVolume,
      totalWeightKG: totalWeight,
      allocatedZone: item.storageZone,
      warnings: itemWarnings,
      status,
    });
  }

  private processItem(
    item: InventoryItem,
    supplier: SupplierProfile,
    warehouse: WarehouseCapacity,
    seasonalityRules: SeasonalityRule[],
    params: GlobalPlannerParams,
    targetDate: Date,
    currentMonth: number,
    currentZoneVolume: Record<'AMBIENT' | 'COLD' | 'FROZEN' | 'HAZARDOUS', number>,
    processedItems: CalculatedReorderItem[],
    rejectedItems: CalculatedReorderItem[],
    state: { budget: number; volume: number; weight: number }
  ): void {
    const itemWarnings: string[] = [];

    if (this.isSupplierRestricted(supplier, params)) {
      rejectedItems.push(this.createEmptyCalculatedItem(item, 'RESTRICTED_REJECTED', ['Supplier tier restricted']));
      return;
    }

    if (this.isPerishableExpired(item, targetDate, supplier, rejectedItems, itemWarnings)) {
      return;
    }

    const metrics = this.calculateItemRequirement(item, supplier, seasonalityRules, currentMonth, itemWarnings);
    if (metrics.netRequirement <= 0) {
      return;
    }

    const zoneVolume = currentZoneVolume[item.storageZone] || 0;
    const orderEval = this.evaluateOrderQuantity(item, metrics.netRequirement, warehouse, zoneVolume, params, state, itemWarnings);

    if (orderEval.rejectedItem) {
      rejectedItems.push(orderEval.rejectedItem);
      return;
    }

    if (orderEval.rawQty <= 0) {
      return;
    }

    this.recordProcessedItem(item, metrics, orderEval.rawQty, orderEval.status, itemWarnings, state, currentZoneVolume, processedItems);
  }

  private isPerishableExpired(
    item: InventoryItem,
    targetDate: Date,
    supplier: SupplierProfile,
    rejectedItems: CalculatedReorderItem[],
    itemWarnings: string[]
  ): boolean {
    if (item.category !== 'PERISHABLE' || !item.expiryDate) {
      return false;
    }
    const daysToExpiry = Math.ceil((new Date(item.expiryDate).getTime() - targetDate.getTime()) / (1000 * 3600 * 24));
    if (daysToExpiry <= 0) {
      rejectedItems.push(this.createEmptyCalculatedItem(item, 'EXPIRED_SKIPPED', ['Existing inventory expired']));
      return true;
    }
    if (daysToExpiry < supplier.baseLeadTimeDays) {
      itemWarnings.push(`Expiry date is closer than supplier lead time (${daysToExpiry} vs ${supplier.baseLeadTimeDays} days)`);
    }
    return false;
  }

  private calculateLeadTime(supplier: SupplierProfile, warnings: string[]): number {
    let effectiveLeadTime = supplier.baseLeadTimeDays;
    if (supplier.reliabilityScore < 70) {
      effectiveLeadTime += Math.ceil((100 - supplier.reliabilityScore) / 10);
      warnings.push(`Lead time padded to ${effectiveLeadTime} days due to low supplier score (${supplier.reliabilityScore})`);
    }
    if (supplier.leadTimeVarianceDays > 0) {
      effectiveLeadTime += supplier.leadTimeVarianceDays * 0.5;
    }
    return effectiveLeadTime;
  }

  private getSeasonalityMultipliers(
    rules: SeasonalityRule[],
    currentMonth: number,
    warnings: string[]
  ): { seasonalityMultiplier: number; peakMultiplier: number } {
    let seasonalityMultiplier = 1.0;
    let peakMultiplier = 1.0;

    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j];
      if (rule.month === currentMonth) {
        seasonalityMultiplier = rule.demandMultiplier || 1.0;
        if (rule.peakMultiplier) {
          peakMultiplier = rule.peakMultiplier;
          warnings.push(`Peak event active: ${rule.peakEventName || 'Seasonal Peak'}`);
        }
        break;
      }
    }

    return { seasonalityMultiplier, peakMultiplier };
  }

  private calculateSafetyStock(
    item: InventoryItem,
    effectiveLeadTime: number,
    adjustedDailyDemand: number,
    leadTimeVarianceDays: number,
    warnings: string[]
  ): { zScore: number; safetyStock: number } {
    const zScore = this.calculateZScore(item.targetServiceLevel);
    const combinedVariance = Math.sqrt(
      effectiveLeadTime * Math.pow(item.demandStdDev, 2) +
      Math.pow(adjustedDailyDemand, 2) * Math.pow(leadTimeVarianceDays, 2)
    );

    let safetyStock = Math.ceil(zScore * combinedVariance);

    switch (item.category) {
      case 'PERISHABLE':
        if (item.shelfLifeDays && item.shelfLifeDays > 0) {
          const maxAllowedSafetyStock = Math.floor(adjustedDailyDemand * item.shelfLifeDays * 0.4);
          if (safetyStock > maxAllowedSafetyStock) {
            safetyStock = maxAllowedSafetyStock;
            warnings.push(`Safety stock capped at ${maxAllowedSafetyStock} due to perishable shelf life constraint`);
          }
        }
        break;
      case 'HAZMAT':
        safetyStock = Math.ceil(safetyStock * 1.15);
        warnings.push('Safety stock increased by 15% for hazmat buffer');
        break;
      case 'COLD_STORAGE':
        safetyStock = Math.ceil(safetyStock * 1.08);
        break;
      case 'BULK':
        break;
      default:
        break;
    }

    return { zScore, safetyStock };
  }

  private adjustQuantityForMOQAndPack(
    netRequirement: number,
    item: InventoryItem,
    emergencyProcurementMode: boolean,
    warnings: string[]
  ): { rawQty: number; status: CalculatedReorderItem['status']; skipped: boolean } {
    let rawQty = netRequirement;
    let status: CalculatedReorderItem['status'] = 'OPTIMAL';

    if (rawQty < item.moq) {
      if (emergencyProcurementMode || item.backorders > 0) {
        rawQty = item.moq;
        status = 'ADJUSTED_MOQ';
        warnings.push(`Order quantity bumped to MOQ ${item.moq}`);
      } else if (rawQty < item.moq * 0.5) {
        warnings.push(`Net requirement ${rawQty} far below MOQ ${item.moq}. Order skipped.`);
        return { rawQty, status, skipped: true };
      } else {
        rawQty = item.moq;
        status = 'ADJUSTED_MOQ';
      }
    }

    if (item.maxOq > 0 && rawQty > item.maxOq) {
      rawQty = item.maxOq;
      warnings.push(`Order quantity capped at MaxOQ ${item.maxOq}`);
    }

    if (item.packSize > 1) {
      const remainder = rawQty % item.packSize;
      if (remainder !== 0) {
        rawQty = rawQty + (item.packSize - remainder);
        warnings.push(`Rounded up to pack size multiple of ${item.packSize}`);
      }
    }

    return { rawQty, status, skipped: false };
  }

  private applyBudgetConstraint(
    item: InventoryItem,
    rawQty: number,
    availableBudget: number,
    allowPartialOrders: boolean,
    warnings: string[]
  ): { rawQty: number; statusAdjustment?: CalculatedReorderItem['status']; rejectedItem?: CalculatedReorderItem } {
    const totalCost = rawQty * item.unitCost;

    if (totalCost <= availableBudget) {
      return { rawQty };
    }

    if (!allowPartialOrders) {
      return {
        rawQty,
        rejectedItem: this.createEmptyCalculatedItem(item, 'BUDGET_CAP', ['Order exceeds remaining budget']),
      };
    }

    const maxAffordableQty = Math.floor(availableBudget / item.unitCost);
    let roundedAffordable = maxAffordableQty;
    if (item.packSize > 1) {
      roundedAffordable = Math.floor(maxAffordableQty / item.packSize) * item.packSize;
    }

    if (roundedAffordable >= item.moq) {
      warnings.push(`Order scaled down to ${roundedAffordable} due to budget limits`);
      return {
        rawQty: roundedAffordable,
        statusAdjustment: 'BUDGET_CAP',
      };
    }

    return {
      rawQty,
      rejectedItem: this.createEmptyCalculatedItem(item, 'BUDGET_CAP', ['Insufficient budget to meet MOQ']),
    };
  }

  private applyCapacityConstraint(
    item: InventoryItem,
    rawQty: number,
    warehouse: WarehouseCapacity,
    currentZoneVol: number,
    allowPartialOrders: boolean,
    warnings: string[]
  ): { rawQty: number; statusAdjustment?: CalculatedReorderItem['status']; rejectedItem?: CalculatedReorderItem } {
    const zoneKey = item.storageZone;
    const zoneCap = warehouse.zoneCapacities[zoneKey];
    const maxZoneVolume = zoneCap ? zoneCap.maxCBM : warehouse.maxVolumeCBM;
    const totalVolume = rawQty * item.unitVolumeCBM;

    if (currentZoneVol + totalVolume <= maxZoneVolume) {
      return { rawQty };
    }

    const availableZoneVol = Math.max(0, maxZoneVolume - currentZoneVol);
    const maxFitQty = Math.floor(availableZoneVol / item.unitVolumeCBM);

    if (maxFitQty >= item.moq && allowPartialOrders) {
      let roundedFit = maxFitQty;
      if (item.packSize > 1) {
        roundedFit = Math.floor(maxFitQty / item.packSize) * item.packSize;
      }
      warnings.push(`Scaled down to ${roundedFit} due to ${zoneKey} zone volume limit`);
      return {
        rawQty: roundedFit,
        statusAdjustment: 'CAPACITY_SCALED',
      };
    }

    return {
      rawQty,
      rejectedItem: this.createEmptyCalculatedItem(item, 'CAPACITY_SCALED', [`${zoneKey} storage zone capacity exceeded`]),
    };
  }

  private checkMinOrderValue(
    supplier: SupplierProfile,
    params: GlobalPlannerParams,
    totalOrderValue: number,
    processedItems: CalculatedReorderItem[],
    globalWarnings: string[]
  ): void {
    if (supplier.minOrderValue > 0 && totalOrderValue < supplier.minOrderValue && processedItems.length > 0) {
      globalWarnings.push(`Total order value $${totalOrderValue.toFixed(2)} is below supplier Minimum Order Value $${supplier.minOrderValue}`);
      if (!params.emergencyProcurementMode) {
        for (let k = 0; k < processedItems.length; k++) {
          processedItems[k].warnings.push('Supplier minimum order value breach - order subject to hold');
        }
      }
    }
  }

  private calculateZScore(serviceLevel: number): number {
    if (serviceLevel >= 0.999) return 3.09;
    if (serviceLevel >= 0.99) return 2.33;
    if (serviceLevel >= 0.98) return 2.05;
    if (serviceLevel >= 0.95) return 1.65;
    if (serviceLevel >= 0.90) return 1.28;
    if (serviceLevel >= 0.85) return 1.04;
    if (serviceLevel >= 0.80) return 0.84;
    return 0.52;
  }

  private createEmptyCalculatedItem(
    item: InventoryItem,
    status: CalculatedReorderItem['status'],
    warnings: string[]
  ): CalculatedReorderItem {
    return {
      sku: item.sku,
      category: item.category,
      calculatedLeadTime: 0,
      adjustedDailyDemand: 0,
      leadTimeDemand: 0,
      zScore: 0,
      safetyStock: 0,
      reorderPoint: 0,
      netRequirement: 0,
      finalOrderQuantity: 0,
      totalCost: 0,
      totalVolumeCBM: 0,
      totalWeightKG: 0,
      allocatedZone: item.storageZone,
      warnings,
      status,
    };
  }
}