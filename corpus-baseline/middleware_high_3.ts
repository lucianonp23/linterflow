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

type StorageZoneKey = 'AMBIENT' | 'COLD' | 'FROZEN' | 'HAZARDOUS';

@Injectable()
export class ReorderPlannerMiddleware implements NestMiddleware {
  public use(req: any, res: any, next: () => void): void {
    if (req.method !== 'POST' && req.method !== 'PUT') {
      return next();
    }

    if (!req.path || !req.path.includes('/reorder-planner')) {
      return next();
    }

    const payload: ReorderPlannerPayload = req.body;

    if (!payload || !payload.supplier || !payload.warehouse || !payload.items || !payload.params) {
      throw new HttpException(
        'Invalid reorder planner payload structure',
        HttpStatus.BAD_REQUEST,
      );
    }

    const context = this.processReorderPlan(payload);

    if (context.rejectedItems.length > 0 && !payload.params.allowPartialOrders) {
      if (context.processedItems.length === 0) {
        throw new HttpException(
          {
            message: 'Reorder planning failed due to unresolvable supply chain constraints',
            context,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    req.reorderPlanContext = context;
    req.headers['x-reorder-plan-processed'] = 'true';
    req.headers['x-reorder-total-value'] = context.totalOrderValue.toFixed(2);

    next();
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

    const currentZoneVolume: Record<StorageZoneKey, number> = {
      AMBIENT: warehouse.zoneCapacities.AMBIENT.currentCBM,
      COLD: warehouse.zoneCapacities.COLD.currentCBM,
      FROZEN: warehouse.zoneCapacities.FROZEN.currentCBM,
      HAZARDOUS: warehouse.zoneCapacities.HAZARDOUS.currentCBM,
    };

    if (supplier.tier === 'RESTRICTED' && !params.emergencyProcurementMode) {
      globalWarnings.push(`Supplier ${supplier.name} is RESTRICTED. Non-emergency orders blocked.`);
    }

    for (const item of items) {
      const itemWarnings: string[] = [];

      if (supplier.tier === 'RESTRICTED' && !params.emergencyProcurementMode) {
        rejectedItems.push(this.createEmptyCalculatedItem(item, 'RESTRICTED_REJECTED', ['Supplier tier restricted']));
        continue;
      }

      if (this.isPerishableExpired(item, targetDate, supplier, itemWarnings, rejectedItems)) {
        continue;
      }

      const effectiveLeadTime = this.calculateEffectiveLeadTime(supplier, itemWarnings);
      const { seasonalityMultiplier, peakMultiplier } = this.calculateSeasonalityMultipliers(seasonalityRules, currentMonth, itemWarnings);

      const adjustedDailyDemand = item.avgDailyDemand * seasonalityMultiplier * peakMultiplier;
      const leadTimeDemand = adjustedDailyDemand * effectiveLeadTime;

      const zScore = this.calculateZScore(item.targetServiceLevel);
      const safetyStock = this.calculateSafetyStock(item, supplier, effectiveLeadTime, adjustedDailyDemand, zScore, itemWarnings);

      const reorderPoint = leadTimeDemand + safetyStock;
      const netRequirement = reorderPoint + item.backorders - (item.currentStock + item.onOrderStock - item.allocatedStock);

      if (netRequirement <= 0) {
        continue;
      }

      const quantityResult = this.adjustQuantityForMOQAndLimits(netRequirement, item, params.emergencyProcurementMode, itemWarnings);
      if (quantityResult.skip) {
        continue;
      }

      let { qty: rawQty, status } = quantityResult;

      const budgetResult = this.applyBudgetConstraint(rawQty, item, availableBudget, params.allowPartialOrders, status, itemWarnings);
      if (budgetResult.rejected) {
        rejectedItems.push(budgetResult.rejected);
        continue;
      }
      rawQty = budgetResult.rawQty;
      status = budgetResult.status;

      const capacityResult = this.applyCapacityConstraint(rawQty, item, warehouse, currentZoneVolume, params.allowPartialOrders, status, itemWarnings);
      if (capacityResult.rejected) {
        rejectedItems.push(capacityResult.rejected);
        continue;
      }
      rawQty = capacityResult.rawQty;
      status = capacityResult.status;

      const totalCost = capacityResult.totalCost;
      const totalVolume = capacityResult.totalVolume;
      const totalWeight = capacityResult.totalWeight;

      availableBudget -= totalCost;
      accumulatedVolume += totalVolume;
      accumulatedWeight += totalWeight;
      currentZoneVolume[item.storageZone] = (currentZoneVolume[item.storageZone] || 0) + totalVolume;

      processedItems.push({
        sku: item.sku,
        category: item.category,
        calculatedLeadTime: effectiveLeadTime,
        adjustedDailyDemand,
        leadTimeDemand,
        zScore,
        safetyStock,
        reorderPoint,
        netRequirement,
        finalOrderQuantity: rawQty,
        totalCost,
        totalVolumeCBM: totalVolume,
        totalWeightKG: totalWeight,
        allocatedZone: item.storageZone,
        warnings: itemWarnings,
        status,
      });
    }

    const totalOrderValue = processedItems.reduce((acc, curr) => acc + curr.totalCost, 0);

    this.checkMinOrderValueConstraint(supplier, totalOrderValue, processedItems, params.emergencyProcurementMode, globalWarnings);

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

  private isPerishableExpired(
    item: InventoryItem,
    targetDate: Date,
    supplier: SupplierProfile,
    itemWarnings: string[],
    rejectedItems: CalculatedReorderItem[]
  ): boolean {
    if (item.category === 'PERISHABLE' && item.expiryDate) {
      const daysToExpiry = Math.ceil((new Date(item.expiryDate).getTime() - targetDate.getTime()) / (1000 * 3600 * 24));
      if (daysToExpiry <= 0) {
        rejectedItems.push(this.createEmptyCalculatedItem(item, 'EXPIRED_SKIPPED', ['Existing inventory expired']));
        return true;
      }
      if (daysToExpiry < supplier.baseLeadTimeDays) {
        itemWarnings.push(`Expiry date is closer than supplier lead time (${daysToExpiry} vs ${supplier.baseLeadTimeDays} days)`);
      }
    }
    return false;
  }

  private calculateEffectiveLeadTime(supplier: SupplierProfile, itemWarnings: string[]): number {
    let effectiveLeadTime = supplier.baseLeadTimeDays;
    if (supplier.reliabilityScore < 70) {
      effectiveLeadTime += Math.ceil((100 - supplier.reliabilityScore) / 10);
      itemWarnings.push(`Lead time padded to ${effectiveLeadTime} days due to low supplier score (${supplier.reliabilityScore})`);
    }

    if (supplier.leadTimeVarianceDays > 0) {
      effectiveLeadTime += supplier.leadTimeVarianceDays * 0.5;
    }

    return effectiveLeadTime;
  }

  private calculateSeasonalityMultipliers(
    seasonalityRules: SeasonalityRule[],
    currentMonth: number,
    itemWarnings: string[]
  ): { seasonalityMultiplier: number; peakMultiplier: number } {
    let seasonalityMultiplier = 1.0;
    let peakMultiplier = 1.0;

    for (const rule of seasonalityRules) {
      if (rule.month === currentMonth) {
        seasonalityMultiplier = rule.demandMultiplier || 1.0;
        if (rule.peakMultiplier) {
          peakMultiplier = rule.peakMultiplier;
          itemWarnings.push(`Peak event active: ${rule.peakEventName || 'Seasonal Peak'}`);
        }
        break;
      }
    }

    return { seasonalityMultiplier, peakMultiplier };
  }

  private calculateSafetyStock(
    item: InventoryItem,
    supplier: SupplierProfile,
    effectiveLeadTime: number,
    adjustedDailyDemand: number,
    zScore: number,
    itemWarnings: string[]
  ): number {
    const combinedVariance = Math.sqrt(
      effectiveLeadTime * Math.pow(item.demandStdDev, 2) +
      Math.pow(adjustedDailyDemand, 2) * Math.pow(supplier.leadTimeVarianceDays, 2)
    );

    let safetyStock = Math.ceil(zScore * combinedVariance);

    switch (item.category) {
      case 'PERISHABLE':
        if (item.shelfLifeDays && item.shelfLifeDays > 0) {
          const maxAllowedSafetyStock = Math.floor(adjustedDailyDemand * item.shelfLifeDays * 0.4);
          if (safetyStock > maxAllowedSafetyStock) {
            safetyStock = maxAllowedSafetyStock;
            itemWarnings.push(`Safety stock capped at ${maxAllowedSafetyStock} due to perishable shelf life constraint`);
          }
        }
        break;
      case 'HAZMAT':
        safetyStock = Math.ceil(safetyStock * 1.15);
        itemWarnings.push('Safety stock increased by 15% for hazmat buffer');
        break;
      case 'COLD_STORAGE':
        safetyStock = Math.ceil(safetyStock * 1.08);
        break;
      case 'BULK':
      default:
        break;
    }

    return safetyStock;
  }

  private adjustQuantityForMOQAndLimits(
    rawQty: number,
    item: InventoryItem,
    emergencyProcurementMode: boolean,
    itemWarnings: string[]
  ): { qty: number; status: CalculatedReorderItem['status']; skip: boolean } {
    let qty = rawQty;
    let status: CalculatedReorderItem['status'] = 'OPTIMAL';

    if (qty < item.moq) {
      if (emergencyProcurementMode || item.backorders > 0) {
        qty = item.moq;
        status = 'ADJUSTED_MOQ';
        itemWarnings.push(`Order quantity bumped to MOQ ${item.moq}`);
      } else if (qty < item.moq * 0.5) {
        itemWarnings.push(`Net requirement ${qty} far below MOQ ${item.moq}. Order skipped.`);
        return { qty: 0, status: 'OPTIMAL', skip: true };
      } else {
        qty = item.moq;
        status = 'ADJUSTED_MOQ';
      }
    }

    if (item.maxOq > 0 && qty > item.maxOq) {
      qty = item.maxOq;
      itemWarnings.push(`Order quantity capped at MaxOQ ${item.maxOq}`);
    }

    if (item.packSize > 1) {
      const remainder = qty % item.packSize;
      if (remainder !== 0) {
        qty = qty + (item.packSize - remainder);
        itemWarnings.push(`Rounded up to pack size multiple of ${item.packSize}`);
      }
    }

    return { qty, status, skip: false };
  }

  private applyBudgetConstraint(
    rawQty: number,
    item: InventoryItem,
    availableBudget: number,
    allowPartialOrders: boolean,
    currentStatus: CalculatedReorderItem['status'],
    itemWarnings: string[]
  ): {
    rawQty: number;
    totalCost: number;
    totalVolume: number;
    totalWeight: number;
    status: CalculatedReorderItem['status'];
    rejected: CalculatedReorderItem | null;
  } {
    let qty = rawQty;
    let totalCost = qty * item.unitCost;

    if (totalCost > availableBudget) {
      if (allowPartialOrders) {
        const maxAffordableQty = Math.floor(availableBudget / item.unitCost);
        let roundedAffordable = maxAffordableQty;
        if (item.packSize > 1) {
          roundedAffordable = Math.floor(maxAffordableQty / item.packSize) * item.packSize;
        }

        if (roundedAffordable >= item.moq) {
          qty = roundedAffordable;
          itemWarnings.push(`Order scaled down to ${qty} due to budget limits`);
          return {
            rawQty: qty,
            totalCost: qty * item.unitCost,
            totalVolume: qty * item.unitVolumeCBM,
            totalWeight: qty * item.unitWeightKG,
            status: 'BUDGET_CAP',
            rejected: null,
          };
        } else {
          return {
            rawQty: qty,
            totalCost: 0,
            totalVolume: 0,
            totalWeight: 0,
            status: currentStatus,
            rejected: this.createEmptyCalculatedItem(item, 'BUDGET_CAP', ['Insufficient budget to meet MOQ']),
          };
        }
      } else {
        return {
          rawQty: qty,
          totalCost: 0,
          totalVolume: 0,
          totalWeight: 0,
          status: currentStatus,
          rejected: this.createEmptyCalculatedItem(item, 'BUDGET_CAP', ['Order exceeds remaining budget']),
        };
      }
    }

    return {
      rawQty: qty,
      totalCost,
      totalVolume: qty * item.unitVolumeCBM,
      totalWeight: qty * item.unitWeightKG,
      status: currentStatus,
      rejected: null,
    };
  }

  private applyCapacityConstraint(
    rawQty: number,
    item: InventoryItem,
    warehouse: WarehouseCapacity,
    currentZoneVolume: Record<StorageZoneKey, number>,
    allowPartialOrders: boolean,
    currentStatus: CalculatedReorderItem['status'],
    itemWarnings: string[]
  ): {
    rawQty: number;
    totalCost: number;
    totalVolume: number;
    totalWeight: number;
    status: CalculatedReorderItem['status'];
    rejected: CalculatedReorderItem | null;
  } {
    let qty = rawQty;
    let totalVolume = qty * item.unitVolumeCBM;

    const zoneKey = item.storageZone;
    const zoneCap = warehouse.zoneCapacities[zoneKey];
    const maxZoneVolume = zoneCap ? zoneCap.maxCBM : warehouse.maxVolumeCBM;
    const currentZoneVol = currentZoneVolume[zoneKey] || 0;

    if (currentZoneVol + totalVolume > maxZoneVolume) {
      const availableZoneVol = Math.max(0, maxZoneVolume - currentZoneVol);
      const maxFitQty = Math.floor(availableZoneVol / item.unitVolumeCBM);

      if (maxFitQty >= item.moq && allowPartialOrders) {
        let roundedFit = maxFitQty;
        if (item.packSize > 1) {
          roundedFit = Math.floor(maxFitQty / item.packSize) * item.packSize;
        }
        qty = roundedFit;
        itemWarnings.push(`Scaled down to ${qty} due to ${zoneKey} zone volume limit`);
        return {
          rawQty: qty,
          totalCost: qty * item.unitCost,
          totalVolume: qty * item.unitVolumeCBM,
          totalWeight: qty * item.unitWeightKG,
          status: 'CAPACITY_SCALED',
          rejected: null,
        };
      } else {
        return {
          rawQty: qty,
          totalCost: 0,
          totalVolume: 0,
          totalWeight: 0,
          status: currentStatus,
          rejected: this.createEmptyCalculatedItem(item, 'CAPACITY_SCALED', [`${zoneKey} storage zone capacity exceeded`]),
        };
      }
    }

    return {
      rawQty: qty,
      totalCost: qty * item.unitCost,
      totalVolume,
      totalWeight: qty * item.unitWeightKG,
      status: currentStatus,
      rejected: null,
    };
  }

  private checkMinOrderValueConstraint(
    supplier: SupplierProfile,
    totalOrderValue: number,
    processedItems: CalculatedReorderItem[],
    emergencyProcurementMode: boolean,
    globalWarnings: string[]
  ): void {
    if (supplier.minOrderValue > 0 && totalOrderValue < supplier.minOrderValue && processedItems.length > 0) {
      globalWarnings.push(`Total order value $${totalOrderValue.toFixed(2)} is below supplier Minimum Order Value $${supplier.minOrderValue}`);
      if (!emergencyProcurementMode) {
        for (const processedItem of processedItems) {
          processedItem.warnings.push('Supplier minimum order value breach - order subject to hold');
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