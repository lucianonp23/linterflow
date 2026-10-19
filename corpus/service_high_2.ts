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

    let inventoryAllocations = this.findSingleWarehouseAllocation(order, availableWarehouses);
    let splitRequired = false;

    if (!inventoryAllocations) {
      if (!order.allowPartialFulfillment && order.maxSplitShipments <= 1) {
        return this.buildFailedPlan(order, 'Single warehouse cannot fulfill order and splits are disabled.');
      }

      inventoryAllocations = this.findMultiWarehouseAllocation(order, availableWarehouses, unfulfilledItems);
      splitRequired = true;

      if (inventoryAllocations.length > order.maxSplitShipments) {
        if (!order.allowPartialFulfillment) {
          return this.buildFailedPlan(order, `Fulfillment requires ${inventoryAllocations.length} splits, max allowed is ${order.maxSplitShipments}.`);
        }
        warnings.push(`Exceeded maximum splits allowed (${order.maxSplitShipments}). Order will be partially fulfilled.`);
      }
    }

    const subPlans: ShipmentSubPlan[] = [];
    let grandTotalCost = 0;

    for (const alloc of inventoryAllocations) {
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

          if (!suitability.eligible) {
            continue;
          }

          const dispatchDate = this.calculateWarehouseDispatchDate(wh, currentTimestamp);
          const estimatedDelivery = this.calculateDeliveryDate(
            dispatchDate,
            service,
            order.shippingAddress,
          );

          const isSlaMet = estimatedDelivery.getTime() <= order.targetDeliveryDate.getTime();

          const costDetails = this.calculateShipmentCost(
            service,
            whPackages,
            order.shippingAddress,
            order.declaredValueTotal / inventoryAllocations.length,
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

      if (bestSubPlanForWh) {
        subPlans.push(bestSubPlanForWh);
        grandTotalCost += bestSubPlanForWh.totalCost;
      } else {
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

    const splitPenaltyCost = splitRequired ? (subPlans.length - 1) * 12.50 : 0;
    grandTotalCost += splitPenaltyCost;

    let overallStatus: 'OPTIMAL' | 'SUB_OPTIMAL' | 'PARTIAL' | 'FAILED' = 'OPTIMAL';
    if (unfulfilledItems.length > 0) {
      overallStatus = 'PARTIAL';
    } else if (splitRequired || subPlans.some((s) => !s.slaMet)) {
      overallStatus = 'SUB_OPTIMAL';
    }

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

      switch (item.category) {
        case ItemCategory.HAZMAT:
          hasHazmat = true;
          break;
        case ItemCategory.PERISHABLE_COLD:
          hasPerishable = true;
          break;
        case ItemCategory.PERISHABLE_FROZEN:
          hasPerishable = true;
          hasFrozen = true;
          break;
        case ItemCategory.FRAGILE:
          hasFragile = true;
          break;
        case ItemCategory.HIGH_VALUE:
          hasHighValue = true;
          break;
        case ItemCategory.OVERSIZED:
          hasOversized = true;
          break;
        default:
          break;
      }

      if (item.isHazmat) hasHazmat = true;
      if (item.requiresTemperatureControl) hasPerishable = true;
      if (item.unitValue >= 500) hasHighValue = true;
      if (
        item.dimensions.lengthCm > 120 ||
        item.dimensions.widthCm > 80 ||
        item.dimensions.heightCm > 80 ||
        item.unitWeightKg > 31.5
      ) {
        hasOversized = true;
      }
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
    return warehouses.filter((wh) => {
      if (!wh.isOperational) {
        warnings.push(`Warehouse ${wh.code} is non-operational.`);
        return false;
      }

      if (wh.capabilities.currentDailyPackedCount >= wh.capabilities.maxDailyPackingCapacity) {
        warnings.push(`Warehouse ${wh.code} has reached its daily packing capacity limit.`);
        return false;
      }

      if (analysis.hasHazmat && !wh.capabilities.hazmatApproved) {
        return false;
      }

      if (analysis.hasPerishable && !wh.capabilities.coldStorageAvailable) {
        return false;
      }

      if (analysis.hasFrozen && !wh.capabilities.frozenStorageAvailable) {
        return false;
      }

      if (analysis.hasHighValue && !wh.capabilities.highValueVault) {
        return false;
      }

      return true;
    });
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
      let aCount = 0;
      let bCount = 0;
      for (const [sku, qty] of remainingNeeds.entries()) {
        const aInv = a.inventory.get(sku);
        const bInv = b.inventory.get(sku);
        if (aInv && aInv.quantityOnHand - aInv.quantityReserved >= qty) aCount++;
        if (bInv && bInv.quantityOnHand - bInv.quantityReserved >= qty) bCount++;
      }
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

  private createStandardPackage(items: OrderItem[]): PackageAllocation {
    let grossWeight = 0;
    let totalVol = 0;
    let maxL = 0, maxW = 0, maxH = 0;
    const itemMap = new Map<string, number>();

    for (const item of items) {
      itemMap.set(item.sku, (itemMap.get(item.sku) || 0) + 1);
      grossWeight += item.unitWeightKg;
      totalVol += item.dimensions.lengthCm * item.dimensions.widthCm * item.dimensions.heightCm;
      if (item.dimensions.lengthCm > maxL) maxL = item.dimensions.lengthCm;
      if (item.dimensions.widthCm > maxW) maxW = item.dimensions.widthCm;
      if (item.dimensions.heightCm > maxH) maxH = item.dimensions.heightCm;
    }

    let pType = PackageType.SMALL_BOX;
    if (grossWeight > 15 || totalVol > 60000) {
      pType = PackageType.LARGE_BOX;
    } else if (grossWeight > 5 || totalVol > 20000) {
      pType = PackageType.MEDIUM_BOX;
    } else if (grossWeight < 0.5 && totalVol < 2000) {
      pType = PackageType.POLY_MAILER;
    }

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

  private evaluateCarrierServiceSuitability(
    service: CarrierServiceOption,
    destination: Address,
    packages: PackageAllocation[],
    slaTier: SLATier,
  ): { eligible: boolean; reason?: string } {
    if (destination.isPobox && !service.supportsPobox) {
      return { eligible: false, reason: 'Carrier service does not deliver to PO Box addresses.' };
    }

    if (service.blacklistedPostalPrefixes.some((prefix) => destination.postalCode.startsWith(prefix))) {
      return { eligible: false, reason: 'Destination postal code is blacklisted for this service.' };
    }

    if (
      service.whitelistedPostalPrefixes.length > 0 &&
      !service.whitelistedPostalPrefixes.some((prefix) => destination.postalCode.startsWith(prefix))
    ) {
      return { eligible: false, reason: 'Destination postal code is not in service whitelist.' };
    }

    for (const pkg of packages) {
      if (pkg.billableWeightKg > service.maxWeightKg) {
        return { eligible: false, reason: `Package weight exceeds service max ${service.maxWeightKg}kg.` };
      }

      if (
        pkg.dimensions.lengthCm > service.maxDimensions.lengthCm ||
        pkg.dimensions.widthCm > service.maxDimensions.widthCm ||
        pkg.dimensions.heightCm > service.maxDimensions.heightCm
      ) {
        return { eligible: false, reason: 'Package dimensions exceed carrier limit.' };
      }

      if (pkg.containsHazmat && !service.supportsHazmat) {
        return { eligible: false, reason: 'Carrier service does not support Hazmat.' };
      }

      if (pkg.requiresColdChain && !service.supportsColdChain) {
        return { eligible: false, reason: 'Carrier service does not support Cold Chain transit.' };
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

  private calculateDeliveryDate(
    dispatchDate: Date,
    service: CarrierServiceOption,
    destination: Address,
  ): Date {
    const estDate = new Date(dispatchDate);
    let transitDays = 3;

    switch (service.slaTierSupported) {
      case SLATier.SAME_DAY:
        transitDays = 0;
        break;
      case SLATier.NEXT_DAY_EXPRESS:
        transitDays = 1;
        break;
      case SLATier.TWO_DAY_EXPEDITED:
        transitDays = 2;
        break;
      case SLATier.STANDARD_GROUND:
        transitDays = 4;
        break;
      case SLATier.ECONOMY:
        transitDays = 6;
        break;
    }

    if (destination.isRemoteZone) {
      transitDays += 2;
    }

    let addedDays = 0;
    while (addedDays < transitDays) {
      estDate.setDate(estDate.getDate() + 1);
      const day = estDate.getDay();
      if (day === 0) {
        continue;
      }
      if (day === 6 && !service.saturdayDeliveryAvailable) {
        continue;
      }
      addedDays++;
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
