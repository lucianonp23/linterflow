import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';

export enum SLATier {
  SAME_DAY = 'SAME_DAY',
  NEXT_DAY_EXPRESS = 'NEXT_DAY_EXPRESS',
  TWO_DAY_EXPEDITED = 'TWO_DAY_EXPEDITED',
  STANDARD_GROUND = 'STANDARD_GROUND',
  ECONOMY = 'ECONOMY',
}

export enum ItemCategory {
  GENERAL = 'GENERAL',
  HAZMAT = 'HAZMAT',
  PERISHABLE_COLD = 'PERISHABLE_COLD',
  PERISHABLE_FROZEN = 'PERISHABLE_FROZEN',
  FRAGILE = 'FRAGILE',
  HIGH_VALUE = 'HIGH_VALUE',
  OVERSIZED = 'OVERSIZED',
}

export enum PackageType {
  POLY_MAILER = 'POLY_MAILER',
  SMALL_BOX = 'SMALL_BOX',
  MEDIUM_BOX = 'MEDIUM_BOX',
  LARGE_BOX = 'LARGE_BOX',
  CRATE = 'CRATE',
  PALLET = 'PALLET',
  COLD_CONTAINER_SMALL = 'COLD_CONTAINER_SMALL',
  COLD_CONTAINER_LARGE = 'COLD_CONTAINER_LARGE',
}

export interface Dimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface OrderItem {
  sku: string;
  quantity: number;
  unitWeightKg: number;
  dimensions: Dimensions;
  unitValue: number;
  category: ItemCategory;
  requiresTemperatureControl: boolean;
  minTempCelsius?: number;
  maxTempCelsius?: number;
  isHazmat: boolean;
  hazmatClass?: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isCommercial: boolean;
  isRemoteZone: boolean;
  isPobox: boolean;
}

export interface Order {
  orderId: string;
  customerRef: string;
  createdAt: Date;
  slaTier: SLATier;
  targetDeliveryDate: Date;
  shippingAddress: Address;
  items: OrderItem[];
  allowPartialFulfillment: boolean;
  maxSplitShipments: number;
  declaredValueTotal: number;
  customerPaidShipping: number;
}

export interface InventoryRecord {
  sku: string;
  quantityOnHand: number;
  quantityReserved: number;
  isAwaitingReplenishment: boolean;
  nextReplenishmentDate?: Date;
}

export interface WarehouseOperatingHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  cutoffTime: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: Address;
  isOperational: boolean;
  inventory: Map<string, InventoryRecord>;
  operatingHours: WarehouseOperatingHours[];
  capabilities: {
    hazmatApproved: boolean;
    coldStorageAvailable: boolean;
    frozenStorageAvailable: boolean;
    hasPalletJack: boolean;
    highValueVault: boolean;
    maxDailyPackingCapacity: number;
    currentDailyPackedCount: number;
  };
  supportedCarrierIds: string[];
}

export interface CarrierServiceOption {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  slaTierSupported: SLATier;
  maxWeightKg: number;
  maxDimensions: Dimensions;
  supportsHazmat: boolean;
  supportsColdChain: boolean;
  supportsPobox: boolean;
  requiresSignatureThreshold: number;
  baseRate: number;
  perKgRate: number;
  dimensionalWeightDivisor: number;
  fuelSurchargePercentage: number;
  remoteZoneSurcharge: number;
  hazmatSurcharge: number;
  coldChainSurcharge: number;
  signatureFee: number;
  saturdayDeliveryAvailable: boolean;
  saturdayDeliveryFee: number;
  blacklistedPostalPrefixes: string[];
  whitelistedPostalPrefixes: string[];
}

export interface Carrier {
  id: string;
  code: string;
  name: string;
  isOperational: boolean;
  dailyPackageCap: number;
  currentDailyPackageCount: number;
  services: CarrierServiceOption[];
}

export interface PackageAllocation {
  packageType: PackageType;
  items: { sku: string; quantity: number }[];
  grossWeightKg: number;
  dimensionalWeightKg: number;
  billableWeightKg: number;
  dimensions: Dimensions;
  containsHazmat: boolean;
  containsPerishable: boolean;
  requiresColdChain: boolean;
}

export interface ShipmentSubPlan {
  warehouseId: string;
  warehouseCode: string;
  packages: PackageAllocation[];
  selectedCarrierId: string;
  selectedServiceId: string;
  carrierCode: string;
  serviceCode: string;
  dispatchDate: Date;
  estimatedDeliveryDate: Date;
  shippingCost: number;
  fuelSurcharge: number;
  specialHandlingFees: number;
  totalCost: number;
  slaMet: boolean;
}

export interface FulfillmentPlan {
  orderId: string;
  isFullyFulfilled: boolean;
  totalSubShipments: number;
  shipments: ShipmentSubPlan[];
  totalFulfillmentCost: number;
  splitPenaltyCost: number;
  grandTotalCost: number;
  fulfillmentStatus: 'OPTIMAL' | 'SUB_OPTIMAL' | 'PARTIAL' | 'FAILED';
  unfulfilledItems: { sku: string; quantity: number; reason: string }[];
  routingWarnings: string[];
}

const SLA_TRANSIT_DAYS: Record<SLATier, number> = {
  [SLATier.SAME_DAY]: 0,
  [SLATier.NEXT_DAY_EXPRESS]: 1,
  [SLATier.TWO_DAY_EXPEDITED]: 2,
  [SLATier.STANDARD_GROUND]: 4,
  [SLATier.ECONOMY]: 6,
};

@Injectable()
export class OrderFulfilmentRoutingService {
  private readonly logger = new Logger(OrderFulfilmentRoutingService.name);

  public calculateOptimalRouting(
    order: Order,
    warehouses: Warehouse[],
    carriers: Carrier[],
    currentTimestamp: Date,
  ): FulfillmentPlan {
    this.validateOrderInput(order);

    const warnings: string[] = [];
    const unfulfilledItems: { sku: string; quantity: number; reason: string }[] = [];

    const orderAnalysis = this.analyzeOrderItems(order);
    
    if (orderAnalysis.hasHazmat && order.shippingAddress.isPobox) {
      throw new BadRequestException('Hazardous materials cannot be delivered to PO Box addresses.');
    }

    const availableWarehouses = this.filterCapableWarehouses(warehouses, orderAnalysis, currentTimestamp, warnings);
    if (availableWarehouses.length === 0) {
      return this.buildFailedPlan(order, 'No operational warehouses matching criteria and capacity.');
    }

    const allocationResult = this.resolveInventoryAllocations(order, availableWarehouses, unfulfilledItems, warnings);
    if (allocationResult.failedPlanReason) {
      return this.buildFailedPlan(order, allocationResult.failedPlanReason);
    }

    const subPlans: ShipmentSubPlan[] = [];
    let grandTotalCost = 0;

    for (const alloc of allocationResult.allocations) {
      const bestSubPlan = this.findBestSubPlanForWarehouse(
        alloc,
        order,
        warehouses,
        carriers,
        currentTimestamp,
        allocationResult.allocations.length,
        warnings,
      );

      if (bestSubPlan) {
        subPlans.push(bestSubPlan);
        grandTotalCost += bestSubPlan.totalCost;
      } else {
        const wh = warehouses.find((w) => w.id === alloc.warehouseId)!;
        unfulfilledItems.push(
          ...alloc.items.map((i) => ({
            sku: i.sku,
            quantity: i.quantity,
            reason: `No eligible carrier service found from warehouse ${wh.code}`,
          })),
        );
      }
    }

    if (subPlans.length === 0) {
      return this.buildFailedPlan(order, 'Unable to route any sub-shipment via available carriers.');
    }

    const splitPenaltyCost = allocationResult.splitRequired ? (subPlans.length - 1) * 12.50 : 0;
    grandTotalCost += splitPenaltyCost;
    const overallStatus = this.determineFulfillmentStatus(unfulfilledItems.length, allocationResult.splitRequired, subPlans);

    return {
      orderId: order.orderId,
      isFullyFulfilled: unfulfilledItems.length === 0,
      totalSubShipments: subPlans.length,
      shipments: subPlans,
      totalFulfillmentCost: grandTotalCost - splitPenaltyCost,
      splitPenaltyCost,
      grandTotalCost,
      fulfillmentStatus: overallStatus,
      unfulfilledItems,
      routingWarnings: warnings,
    };
  }

  private resolveInventoryAllocations(
    order: Order,
    availableWarehouses: Warehouse[],
    unfulfilledItems: { sku: string; quantity: number; reason: string }[],
    warnings: string[],
  ): { allocations: { warehouseId: string; items: { sku: string; quantity: number }[] }[]; splitRequired: boolean; failedPlanReason?: string } {
    const single = this.findSingleWarehouseAllocation(order, availableWarehouses);
    if (single) {
      return { allocations: single, splitRequired: false };
    }

    if (!order.allowPartialFulfillment && order.maxSplitShipments <= 1) {
      return { allocations: [], splitRequired: false, failedPlanReason: 'Single warehouse cannot fulfill order and splits are disabled.' };
    }

    const multi = this.findMultiWarehouseAllocation(order, availableWarehouses, unfulfilledItems);
    if (multi.length > order.maxSplitShipments) {
      if (!order.allowPartialFulfillment) {
        return { allocations: [], splitRequired: true, failedPlanReason: `Fulfillment requires ${multi.length} splits, max allowed is ${order.maxSplitShipments}.` };
      }
      warnings.push(`Exceeded maximum splits allowed (${order.maxSplitShipments}). Order will be partially fulfilled.`);
    }

    return { allocations: multi, splitRequired: true };
  }

  private findBestSubPlanForWarehouse(
    alloc: { warehouseId: string; items: { sku: string; quantity: number }[] },
    order: Order,
    warehouses: Warehouse[],
    carriers: Carrier[],
    currentTimestamp: Date,
    totalAllocationsCount: number,
    warnings: string[],
  ): ShipmentSubPlan | null {
    const wh = warehouses.find((w) => w.id === alloc.warehouseId)!;
    const whPackages = this.packItemsIntoContainers(alloc.items, order.items, wh);

    let bestSubPlanForWh: ShipmentSubPlan | null = null;
    let lowestWhCost = Infinity;

    for (const carrier of carriers) {
      if (!carrier.isOperational) continue;
      if (carrier.currentDailyPackageCount + whPackages.length > carrier.dailyPackageCap) {
        warnings.push(`Carrier ${carrier.code} reached daily capacity limit.`);
        continue;
      }
      if (!wh.supportedCarrierIds.includes(carrier.id)) continue;

      for (const service of carrier.services) {
        const suitability = this.evaluateCarrierServiceSuitability(
          service,
          order.shippingAddress,
          whPackages,
          order.slaTier,
        );

        if (!suitability.eligible) continue;

        const dispatchDate = this.calculateWarehouseDispatchDate(wh, currentTimestamp);
        const estimatedDelivery = this.calculateDeliveryDate(dispatchDate, service, order.shippingAddress);
        const isSlaMet = estimatedDelivery.getTime() <= order.targetDeliveryDate.getTime();

        const costDetails = this.calculateShipmentCost(
          service,
          whPackages,
          order.shippingAddress,
          order.declaredValueTotal / totalAllocationsCount,
          estimatedDelivery,
        );

        let totalPlanCost = costDetails.totalCost;
        if (!isSlaMet) {
          totalPlanCost += 10000;
        }

        if (totalPlanCost < lowestWhCost) {
          lowestWhCost = totalPlanCost;
          bestSubPlanForWh = {
            warehouseId: wh.id,
            warehouseCode: wh.code,
            packages: whPackages,
            selectedCarrierId: carrier.id,
            selectedServiceId: service.serviceId,
            carrierCode: carrier.code,
            serviceCode: service.serviceCode,
            dispatchDate,
            estimatedDeliveryDate: estimatedDelivery,
            shippingCost: costDetails.shippingCost,
            fuelSurcharge: costDetails.fuelSurcharge,
            specialHandlingFees: costDetails.specialHandlingFees,
            totalCost: costDetails.totalCost,
            slaMet: isSlaMet,
          };
        }
      }
    }

    return bestSubPlanForWh;
  }

  private determineFulfillmentStatus(
    unfulfilledItemsCount: number,
    splitRequired: boolean,
    subPlans: ShipmentSubPlan[],
  ): 'OPTIMAL' | 'SUB_OPTIMAL' | 'PARTIAL' | 'FAILED' {
    if (unfulfilledItemsCount > 0) return 'PARTIAL';
    if (splitRequired || subPlans.some((s) => !s.slaMet)) return 'SUB_OPTIMAL';
    return 'OPTIMAL';
  }

  private validateOrderInput(order: Order): void {
    if (!order || !order.orderId) {
      throw new BadRequestException('Invalid order structure: Missing order ID.');
    }
    if (!order.items || order.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }
    for (const item of order.items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(`Invalid item quantity for SKU ${item.sku}. Must be > 0.`);
      }
      if (item.unitWeightKg <= 0) {
        throw new BadRequestException(`Invalid item weight for SKU ${item.sku}. Must be > 0.`);
      }
    }
    if (!order.shippingAddress || !order.shippingAddress.postalCode) {
      throw new BadRequestException('Order missing complete shipping destination address.');
    }
  }

  private inspectItem(item: OrderItem) {
    const cat = item.category;
    return {
      isHazmat: item.isHazmat || cat === ItemCategory.HAZMAT,
      isPerishable: item.requiresTemperatureControl || cat === ItemCategory.PERISHABLE_COLD || cat === ItemCategory.PERISHABLE_FROZEN,
      isFrozen: cat === ItemCategory.PERISHABLE_FROZEN,
      isFragile: cat === ItemCategory.FRAGILE,
      isHighValue: item.unitValue >= 500 || cat === ItemCategory.HIGH_VALUE,
      isOversized:
        cat === ItemCategory.OVERSIZED ||
        item.dimensions.lengthCm > 120 ||
        item.dimensions.widthCm > 80 ||
        item.dimensions.heightCm > 80 ||
        item.unitWeightKg > 31.5,
    };
  }

  private analyzeOrderItems(order: Order): {
    hasHazmat: boolean;
    hasPerishable: boolean;
    hasFrozen: boolean;
    hasFragile: boolean;
    hasHighValue: boolean;
    hasOversized: boolean;
    totalWeight: number;
  } {
    let hasHazmat = false;
    let hasPerishable = false;
    let hasFrozen = false;
    let hasFragile = false;
    let hasHighValue = false;
    let hasOversized = false;
    let totalWeight = 0;

    for (const item of order.items) {
      totalWeight += item.unitWeightKg * item.quantity;
      const flags = this.inspectItem(item);
      hasHazmat = hasHazmat || flags.isHazmat;
      hasPerishable = hasPerishable || flags.isPerishable;
      hasFrozen = hasFrozen || flags.isFrozen;
      hasFragile = hasFragile || flags.isFragile;
      hasHighValue = hasHighValue || flags.isHighValue;
      hasOversized = hasOversized || flags.isOversized;
    }

    return {
      hasHazmat,
      hasPerishable,
      hasFrozen,
      hasFragile,
      hasHighValue,
      hasOversized,
      totalWeight,
    };
  }

  private isWarehouseCapable(
    wh: Warehouse,
    analysis: {
      hasHazmat: boolean;
      hasPerishable: boolean;
      hasFrozen: boolean;
      hasHighValue: boolean;
    },
    warnings: string[],
  ): boolean {
    if (!wh.isOperational) {
      warnings.push(`Warehouse ${wh.code} is non-operational.`);
      return false;
    }

    if (wh.capabilities.currentDailyPackedCount >= wh.capabilities.maxDailyPackingCapacity) {
      warnings.push(`Warehouse ${wh.code} has reached its daily packing capacity limit.`);
      return false;
    }

    const caps = wh.capabilities;
    const checks = [
      analysis.hasHazmat && !caps.hazmatApproved,
      analysis.hasPerishable && !caps.coldStorageAvailable,
      analysis.hasFrozen && !caps.frozenStorageAvailable,
      analysis.hasHighValue && !caps.highValueVault,
    ];

    return !checks.some(Boolean);
  }

  private filterCapableWarehouses(
    warehouses: Warehouse[],
    analysis: {
      hasHazmat: boolean;
      hasPerishable: boolean;
      hasFrozen: boolean;
      hasHighValue: boolean;
    },
    currentTimestamp: Date,
    warnings: string[],
  ): Warehouse[] {
    return warehouses.filter((wh) => this.isWarehouseCapable(wh, analysis, warnings));
  }

  private findSingleWarehouseAllocation(
    order: Order,
    warehouses: Warehouse[],
  ): { warehouseId: string; items: { sku: string; quantity: number }[] }[] | null {
    for (const wh of warehouses) {
      let canFulfillAll = true;
      const allocItems: { sku: string; quantity: number }[] = [];

      for (const item of order.items) {
        const inv = wh.inventory.get(item.sku);
        if (!inv) {
          canFulfillAll = false;
          break;
        }

        const availableQty = inv.quantityOnHand - inv.quantityReserved;
        if (availableQty < item.quantity) {
          canFulfillAll = false;
          break;
        }

        allocItems.push({ sku: item.sku, quantity: item.quantity });
      }

      if (canFulfillAll) {
        return [{ warehouseId: wh.id, items: allocItems }];
      }
    }
    return null;
  }

  private countWarehouseStockForNeeds(wh: Warehouse, remainingNeeds: Map<string, number>): number {
    let count = 0;
    for (const [sku, qty] of remainingNeeds.entries()) {
      const inv = wh.inventory.get(sku);
      if (inv && inv.quantityOnHand - inv.quantityReserved >= qty) {
        count++;
      }
    }
    return count;
  }

  private findMultiWarehouseAllocation(
    order: Order,
    warehouses: Warehouse[],
    unfulfilledItems: { sku: string; quantity: number; reason: string }[],
  ): { warehouseId: string; items: { sku: string; quantity: number }[] }[] {
    const remainingNeeds = new Map<string, number>();
    for (const item of order.items) {
      remainingNeeds.set(item.sku, item.quantity);
    }

    const allocationMap = new Map<string, { sku: string; quantity: number }[]>();

    const sortedWarehouses = [...warehouses].sort((a, b) => {
      const aCount = this.countWarehouseStockForNeeds(a, remainingNeeds);
      const bCount = this.countWarehouseStockForNeeds(b, remainingNeeds);
      return bCount - aCount;
    });

    for (const wh of sortedWarehouses) {
      const whAllocations: { sku: string; quantity: number }[] = [];

      for (const [sku, neededQty] of remainingNeeds.entries()) {
        if (neededQty <= 0) continue;

        const inv = wh.inventory.get(sku);
        if (!inv) continue;

        const avail = Math.max(0, inv.quantityOnHand - inv.quantityReserved);
        if (avail > 0) {
          const takeQty = Math.min(neededQty, avail);
          whAllocations.push({ sku, quantity: takeQty });
          remainingNeeds.set(sku, neededQty - takeQty);
        }
      }

      if (whAllocations.length > 0) {
        allocationMap.set(wh.id, whAllocations);
      }
    }

    for (const [sku, neededQty] of remainingNeeds.entries()) {
      if (neededQty > 0) {
        unfulfilledItems.push({
          sku,
          quantity: neededQty,
          reason: 'Insufficient stock across all operational warehouses.',
        });
      }
    }

    const result: { warehouseId: string; items: { sku: string; quantity: number }[] }[] = [];
    for (const [warehouseId, items] of allocationMap.entries()) {
      result.push({ warehouseId, items });
    }
    return result;
  }

  private packItemsIntoContainers(
    allocItems: { sku: string; quantity: number }[],
    orderItems: OrderItem[],
    warehouse: Warehouse,
  ): PackageAllocation[] {
    const packages: PackageAllocation[] = [];

    const detailedItems: OrderItem[] = [];
    for (const alloc of allocItems) {
      const spec = orderItems.find((i) => i.sku === alloc.sku);
      if (spec) {
        for (let i = 0; i < alloc.quantity; i++) {
          detailedItems.push(spec);
        }
      }
    }

    const hazmatItems = detailedItems.filter((i) => i.isHazmat || i.category === ItemCategory.HAZMAT);
    const coldItems = detailedItems.filter((i) => i.requiresTemperatureControl);
    const regularItems = detailedItems.filter(
      (i) => !i.isHazmat && i.category !== ItemCategory.HAZMAT && !i.requiresTemperatureControl,
    );

    if (hazmatItems.length > 0) {
      packages.push(this.createSinglePackageGroup(hazmatItems, PackageType.MEDIUM_BOX, true, false));
    }

    if (coldItems.length > 0) {
      const isLargeCold = coldItems.length > 5;
      packages.push(
        this.createSinglePackageGroup(
          coldItems,
          isLargeCold ? PackageType.COLD_CONTAINER_LARGE : PackageType.COLD_CONTAINER_SMALL,
          false,
          true,
        ),
      );
    }

    if (regularItems.length > 0) {
      let currentGroup: OrderItem[] = [];
      let currentWeight = 0;
      let currentVolume = 0;

      for (const item of regularItems) {
        const itemVol = item.dimensions.lengthCm * item.dimensions.widthCm * item.dimensions.heightCm;
        if (currentWeight + item.unitWeightKg > 25 || currentVolume + itemVol > 100000) {
          packages.push(this.createStandardPackage(currentGroup));
          currentGroup = [];
          currentWeight = 0;
          currentVolume = 0;
        }
        currentGroup.push(item);
        currentWeight += item.unitWeightKg;
        currentVolume += itemVol;
      }

      if (currentGroup.length > 0) {
        packages.push(this.createStandardPackage(currentGroup));
      }
    }

    return packages;
  }

  private createSinglePackageGroup(
    items: OrderItem[],
    pkgType: PackageType,
    containsHazmat: boolean,
    containsPerishable: boolean,
  ): PackageAllocation {
    const itemMap = new Map<string, number>();
    let grossWeight = 0;
    let maxL = 0, maxW = 0, totalH = 0;

    for (const item of items) {
      itemMap.set(item.sku, (itemMap.get(item.sku) || 0) + 1);
      grossWeight += item.unitWeightKg;
      if (item.dimensions.lengthCm > maxL) maxL = item.dimensions.lengthCm;
      if (item.dimensions.widthCm > maxW) maxW = item.dimensions.widthCm;
      totalH += item.dimensions.heightCm;
    }

    if (containsPerishable) {
      grossWeight += 2.5;
    }

    const dimWeight = (maxL * maxW * totalH) / 5000;

    const packedItemsList: { sku: string; quantity: number }[] = [];
    for (const [sku, quantity] of itemMap.entries()) {
      packedItemsList.push({ sku, quantity });
    }

    return {
      packageType: pkgType,
      items: packedItemsList,
      grossWeightKg: grossWeight,
      dimensionalWeightKg: dimWeight,
      billableWeightKg: Math.max(grossWeight, dimWeight),
      dimensions: { lengthCm: maxL, widthCm: maxW, heightCm: totalH },
      containsHazmat,
      containsPerishable,
      requiresColdChain: containsPerishable,
    };
  }

  private determineStandardPackageType(grossWeight: number, totalVol: number): PackageType {
    if (grossWeight > 15 || totalVol > 60000) {
      return PackageType.LARGE_BOX;
    }
    if (grossWeight > 5 || totalVol > 20000) {
      return PackageType.MEDIUM_BOX;
    }
    if (grossWeight < 0.5 && totalVol < 2000) {
      return PackageType.POLY_MAILER;
    }
    return PackageType.SMALL_BOX;
  }

  private createStandardPackage(items: OrderItem[]): PackageAllocation {
    let grossWeight = 0;
    let totalVol = 0;
    let maxL = 0, maxW = 0, maxH = 0;
    const itemMap = new Map<string, number>();

    for (const item of items) {
      itemMap.set(item.sku, (itemMap.get(item.sku) || 0) + 1);
      grossWeight += item.unitWeightKg;
      totalVol += item.dimensions.lengthCm * item.dimensions.widthCm * item.dimensions.heightCm;
      maxL = Math.max(maxL, item.dimensions.lengthCm);
      maxW = Math.max(maxW, item.dimensions.widthCm);
      maxH = Math.max(maxH, item.dimensions.heightCm);
    }

    const pType = this.determineStandardPackageType(grossWeight, totalVol);
    const dimWeight = (maxL * maxW * maxH) / 5000;

    const packedItemsList: { sku: string; quantity: number }[] = [];
    for (const [sku, quantity] of itemMap.entries()) {
      packedItemsList.push({ sku, quantity });
    }

    return {
      packageType: pType,
      items: packedItemsList,
      grossWeightKg: grossWeight,
      dimensionalWeightKg: dimWeight,
      billableWeightKg: Math.max(grossWeight, dimWeight),
      dimensions: { lengthCm: maxL, widthCm: maxW, heightCm: maxH },
      containsHazmat: false,
      containsPerishable: false,
      requiresColdChain: false,
    };
  }

  private evaluateDestinationSuitability(
    service: CarrierServiceOption,
    destination: Address,
  ): string | null {
    if (destination.isPobox && !service.supportsPobox) {
      return 'Carrier service does not deliver to PO Box addresses.';
    }
    if (service.blacklistedPostalPrefixes.some((prefix) => destination.postalCode.startsWith(prefix))) {
      return 'Destination postal code is blacklisted for this service.';
    }
    if (
      service.whitelistedPostalPrefixes.length > 0 &&
      !service.whitelistedPostalPrefixes.some((prefix) => destination.postalCode.startsWith(prefix))
    ) {
      return 'Destination postal code is not in service whitelist.';
    }
    return null;
  }

  private evaluatePackageSuitability(
    service: CarrierServiceOption,
    pkg: PackageAllocation,
  ): string | null {
    if (pkg.billableWeightKg > service.maxWeightKg) {
      return `Package weight exceeds service max ${service.maxWeightKg}kg.`;
    }
    if (
      pkg.dimensions.lengthCm > service.maxDimensions.lengthCm ||
      pkg.dimensions.widthCm > service.maxDimensions.widthCm ||
      pkg.dimensions.heightCm > service.maxDimensions.heightCm
    ) {
      return 'Package dimensions exceed carrier limit.';
    }
    if (pkg.containsHazmat && !service.supportsHazmat) {
      return 'Carrier service does not support Hazmat.';
    }
    if (pkg.requiresColdChain && !service.supportsColdChain) {
      return 'Carrier service does not support Cold Chain transit.';
    }
    return null;
  }

  private evaluateCarrierServiceSuitability(
    service: CarrierServiceOption,
    destination: Address,
    packages: PackageAllocation[],
    slaTier: SLATier,
  ): { eligible: boolean; reason?: string } {
    const destError = this.evaluateDestinationSuitability(service, destination);
    if (destError) {
      return { eligible: false, reason: destError };
    }

    for (const pkg of packages) {
      const pkgError = this.evaluatePackageSuitability(service, pkg);
      if (pkgError) {
        return { eligible: false, reason: pkgError };
      }
    }

    return { eligible: true };
  }

  private calculateWarehouseDispatchDate(warehouse: Warehouse, currentTimestamp: Date): Date {
    const dispatchDate = new Date(currentTimestamp);
    const dayOfWeek = dispatchDate.getDay();

    const opHours = warehouse.operatingHours.find((h) => h.dayOfWeek === dayOfWeek);

    if (!opHours) {
      dispatchDate.setDate(dispatchDate.getDate() + 1);
      dispatchDate.setHours(8, 0, 0, 0);
      return this.calculateWarehouseDispatchDate(warehouse, dispatchDate);
    }

    const [cutoffHour, cutoffMinute] = opHours.cutoffTime.split(':').map(Number);
    const cutoffDate = new Date(dispatchDate);
    cutoffDate.setHours(cutoffHour, cutoffMinute, 0, 0);

    if (dispatchDate.getTime() > cutoffDate.getTime()) {
      dispatchDate.setDate(dispatchDate.getDate() + 1);
      dispatchDate.setHours(8, 0, 0, 0);
      return this.calculateWarehouseDispatchDate(warehouse, dispatchDate);
    }

    return dispatchDate;
  }

  private isDeliveryDay(date: Date, saturdayAvailable: boolean): boolean {
    const day = date.getDay();
    if (day === 0) return false;
    if (day === 6 && !saturdayAvailable) return false;
    return true;
  }

  private calculateDeliveryDate(
    dispatchDate: Date,
    service: CarrierServiceOption,
    destination: Address,
  ): Date {
    const estDate = new Date(dispatchDate);
    const baseDays = SLA_TRANSIT_DAYS[service.slaTierSupported] ?? 3;
    const transitDays = baseDays + (destination.isRemoteZone ? 2 : 0);

    let addedDays = 0;
    while (addedDays < transitDays) {
      estDate.setDate(estDate.getDate() + 1);
      if (this.isDeliveryDay(estDate, service.saturdayDeliveryAvailable)) {
        addedDays++;
      }
    }

    return estDate;
  }

  private calculateShipmentCost(
    service: CarrierServiceOption,
    packages: PackageAllocation[],
    destination: Address,
    declaredValue: number,
    estimatedDelivery: Date,
  ): { shippingCost: number; fuelSurcharge: number; specialHandlingFees: number; totalCost: number } {
    let baseShippingCost = 0;
    let specialHandlingFees = 0;

    for (const pkg of packages) {
      const pkgDimWeight = (pkg.dimensions.lengthCm * pkg.dimensions.widthCm * pkg.dimensions.heightCm) / service.dimensionalWeightDivisor;
      const billableWeight = Math.max(pkg.grossWeightKg, pkgDimWeight);

      let pkgCost = service.baseRate + billableWeight * service.perKgRate;
      baseShippingCost += pkgCost;

      if (pkg.containsHazmat) {
        specialHandlingFees += service.hazmatSurcharge;
      }
      if (pkg.requiresColdChain) {
        specialHandlingFees += service.coldChainSurcharge;
      }
    }

    if (destination.isRemoteZone) {
      specialHandlingFees += service.remoteZoneSurcharge;
    }

    if (declaredValue >= service.requiresSignatureThreshold) {
      specialHandlingFees += service.signatureFee;
    }

    if (estimatedDelivery.getDay() === 6 && service.saturdayDeliveryAvailable) {
      specialHandlingFees += service.saturdayDeliveryFee;
    }

    const fuelSurcharge = (baseShippingCost + specialHandlingFees) * (service.fuelSurchargePercentage / 100);
    const totalCost = baseShippingCost + specialHandlingFees + fuelSurcharge;

    return {
      shippingCost: Math.round(baseShippingCost * 100) / 100,
      fuelSurcharge: Math.round(fuelSurcharge * 100) / 100,
      specialHandlingFees: Math.round(specialHandlingFees * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
    };
  }

  private buildFailedPlan(order: Order, reason: string): FulfillmentPlan {
    return {
      orderId: order.orderId,
      isFullyFulfilled: false,
      totalSubShipments: 0,
      shipments: [],
      totalFulfillmentCost: 0,
      splitPenaltyCost: 0,
      grandTotalCost: 0,
      fulfillmentStatus: 'FAILED',
      unfulfilledItems: order.items.map((i) => ({
        sku: i.sku,
        quantity: i.quantity,
        reason,
      })),
      routingWarnings: [reason],
    };
  }
}