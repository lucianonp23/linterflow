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

    const currentZoneVolume: { [key in 'AMBIENT' | 'COLD' | 'FROZEN' | 'HAZARDOUS']: number } = {
      AMBIENT: warehouse.zoneCapacities.AMBIENT.currentCBM,
      COLD: warehouse.zoneCapacities.COLD.currentCBM,
      FROZEN: warehouse.zoneCapacities.FROZEN.currentCBM,
      HAZARDOUS: warehouse.zoneCapacities.HAZARDOUS.currentCBM,
    };

    if (supplier.tier === 'RESTRICTED' && !params.emergencyProcurementMode) {
      globalWarnings.push(`Supplier ${supplier.name} is RESTRICTED. Non-emergency orders blocked.`);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemWarnings: string[] = [];

      if (supplier.tier === 'RESTRICTED' && !params.emergencyProcurementMode) {
        rejectedItems.push(this.createEmptyCalculatedItem(item, 'RESTRICTED_REJECTED', ['Supplier tier restricted']));
        continue;
      }

      if (item.category === 'PERISHABLE' && item.expiryDate) {
        const daysToExpiry = Math.ceil((new Date(item.expiryDate).getTime() - targetDate.getTime()) / (1000 * 3600 * 24));
        if (daysToExpiry <= 0) {
          rejectedItems.push(this.createEmptyCalculatedItem(item, 'EXPIRED_SKIPPED', ['Existing inventory expired']));
          continue;
        }
        if (daysToExpiry < supplier.baseLeadTimeDays) {
          itemWarnings.push(`Expiry date is closer than supplier lead time (${daysToExpiry} vs ${supplier.baseLeadTimeDays} days)`);
        }
      }

      let effectiveLeadTime = supplier.baseLeadTimeDays;
      if (supplier.reliabilityScore < 70) {
        effectiveLeadTime += Math.ceil((100 - supplier.reliabilityScore) / 10);
        itemWarnings.push(`Lead time padded to ${effectiveLeadTime} days due to low supplier score (${supplier.reliabilityScore})`);
      }

      if (supplier.leadTimeVarianceDays > 0) {
        effectiveLeadTime += supplier.leadTimeVarianceDays * 0.5;
      }

      let seasonalityMultiplier = 1.0;
      let peakMultiplier = 1.0;

      for (let j = 0; j < seasonalityRules.length; j++) {
        const rule = seasonalityRules[j];
        if (rule.month === currentMonth) {
          seasonalityMultiplier = rule.demandMultiplier || 1.0;
          if (rule.peakMultiplier) {
            peakMultiplier = rule.peakMultiplier;
            itemWarnings.push(`Peak event active: ${rule.peakEventName || 'Seasonal Peak'}`);
          }
          break;
        }
      }

      const adjustedDailyDemand = item.avgDailyDemand * seasonalityMultiplier * peakMultiplier;
      const leadTimeDemand = adjustedDailyDemand * effectiveLeadTime;

      const zScore = this.calculateZScore(item.targetServiceLevel);
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
          break;
        default:
          break;
      }

      const reorderPoint = leadTimeDemand + safetyStock;
      const netRequirement = reorderPoint + item.backorders - (item.currentStock + item.onOrderStock - item.allocatedStock);

      if (netRequirement <= 0) {
        continue;
      }

      let rawQty = netRequirement;
      let status: CalculatedReorderItem['status'] = 'OPTIMAL';

      if (rawQty < item.moq) {
        if (params.emergencyProcurementMode || item.backorders > 0) {
          rawQty = item.moq;
          status = 'ADJUSTED_MOQ';
          itemWarnings.push(`Order quantity bumped to MOQ ${item.moq}`);
        } else if (rawQty < item.moq * 0.5) {
          itemWarnings.push(`Net requirement ${rawQty} far below MOQ ${item.moq}. Order skipped.`);
          continue;
        } else {
          rawQty = item.moq;
          status = 'ADJUSTED_MOQ';
        }
      }

      if (item.maxOq > 0 && rawQty > item.maxOq) {
        rawQty = item.maxOq;
        itemWarnings.push(`Order quantity capped at MaxOQ ${item.maxOq}`);
      }

      if (item.packSize > 1) {
        const remainder = rawQty % item.packSize;
        if (remainder !== 0) {
          rawQty = rawQty + (item.packSize - remainder);
          itemWarnings.push(`Rounded up to pack size multiple of ${item.packSize}`);
        }
      }

      let totalCost = rawQty * item.unitCost;
      let totalVolume = rawQty * item.unitVolumeCBM;
      let totalWeight = rawQty * item.unitWeightKG;

      if (totalCost > availableBudget) {
        if (params.allowPartialOrders) {
          const maxAffordableQty = Math.floor(availableBudget / item.unitCost);
          let roundedAffordable = maxAffordableQty;
          if (item.packSize > 1) {
            roundedAffordable = Math.floor(maxAffordableQty / item.packSize) * item.packSize;
          }

          if (roundedAffordable >= item.moq) {
            rawQty = roundedAffordable;
            totalCost = rawQty * item.unitCost;
            totalVolume = rawQty * item.unitVolumeCBM;
            totalWeight = rawQty * item.unitWeightKG;
            status = 'BUDGET_CAP';
            itemWarnings.push(`Order scaled down to ${rawQty} due to budget limits`);
          } else {
            rejectedItems.push(this.createEmptyCalculatedItem(item, 'BUDGET_CAP', ['Insufficient budget to meet MOQ']));
            continue;
          }
        } else {
          rejectedItems.push(this.createEmptyCalculatedItem(item, 'BUDGET_CAP', ['Order exceeds remaining budget']));
          continue;
        }
      }

      const zoneKey = item.storageZone;
      const zoneCap = warehouse.zoneCapacities[zoneKey];
      const maxZoneVolume = zoneCap ? zoneCap.maxCBM : warehouse.maxVolumeCBM;
      const currentZoneVol = currentZoneVolume[zoneKey] || 0;

      if (currentZoneVol + totalVolume > maxZoneVolume) {
        const availableZoneVol = Math.max(0, maxZoneVolume - currentZoneVol);
        const maxFitQty = Math.floor(availableZoneVol / item.unitVolumeCBM);

        if (maxFitQty >= item.moq && params.allowPartialOrders) {
          let roundedFit = maxFitQty;
          if (item.packSize > 1) {
            roundedFit = Math.floor(maxFitQty / item.packSize) * item.packSize;
          }
          rawQty = roundedFit;
          totalCost = rawQty * item.unitCost;
          totalVolume = rawQty * item.unitVolumeCBM;
          totalWeight = rawQty * item.unitWeightKG;
          status = 'CAPACITY_SCALED';
          itemWarnings.push(`Scaled down to ${rawQty} due to ${zoneKey} zone volume limit`);
        } else {
          rejectedItems.push(this.createEmptyCalculatedItem(item, 'CAPACITY_SCALED', [`${zoneKey} storage zone capacity exceeded`]));
          continue;
        }
      }

      availableBudget -= totalCost;
      accumulatedVolume += totalVolume;
      accumulatedWeight += totalWeight;
      currentZoneVolume[zoneKey] = (currentZoneVolume[zoneKey] || 0) + totalVolume;

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

    if (supplier.minOrderValue > 0 && totalOrderValue < supplier.minOrderValue && processedItems.length > 0) {
      globalWarnings.push(`Total order value $${totalOrderValue.toFixed(2)} is below supplier Minimum Order Value $${supplier.minOrderValue}`);
      if (!params.emergencyProcurementMode) {
        for (let k = 0; k < processedItems.length; k++) {
          processedItems[k].warnings.push('Supplier minimum order value breach - order subject to hold');
        }
      }
    }

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
