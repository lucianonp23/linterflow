import { defineSubject } from '../harness';

defineSubject('service_high_2', (h) => {
  const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 0, day, hour, minute));
  const skuCatalog = [
    { sku: 'GEN-1', unitWeightKg: 0.2, dimensions: { lengthCm: 10, widthCm: 10, heightCm: 5 }, unitValue: 15, category: 'GENERAL', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'GEN-2', unitWeightKg: 6, dimensions: { lengthCm: 40, widthCm: 30, heightCm: 20 }, unitValue: 80, category: 'GENERAL', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'GEN-3', unitWeightKg: 14, dimensions: { lengthCm: 60, widthCm: 40, heightCm: 40 }, unitValue: 120, category: 'FRAGILE', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'HAZ-1', unitWeightKg: 3, dimensions: { lengthCm: 30, widthCm: 20, heightCm: 20 }, unitValue: 60, category: 'HAZMAT', requiresTemperatureControl: false, isHazmat: true, hazmatClass: '3' },
    { sku: 'HAZ-2', unitWeightKg: 1, dimensions: { lengthCm: 15, widthCm: 15, heightCm: 15 }, unitValue: 40, category: 'GENERAL', requiresTemperatureControl: false, isHazmat: true },
    { sku: 'COLD-1', unitWeightKg: 2, dimensions: { lengthCm: 25, widthCm: 20, heightCm: 15 }, unitValue: 30, category: 'PERISHABLE_COLD', requiresTemperatureControl: true, minTempCelsius: 2, maxTempCelsius: 8, isHazmat: false },
    { sku: 'FROZEN-1', unitWeightKg: 4, dimensions: { lengthCm: 30, widthCm: 25, heightCm: 20 }, unitValue: 55, category: 'PERISHABLE_FROZEN', requiresTemperatureControl: true, isHazmat: false },
    { sku: 'FROZEN-2', unitWeightKg: 4, dimensions: { lengthCm: 30, widthCm: 25, heightCm: 20 }, unitValue: 55, category: 'PERISHABLE_FROZEN', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'LUX-1', unitWeightKg: 0.3, dimensions: { lengthCm: 12, widthCm: 8, heightCm: 4 }, unitValue: 2400, category: 'HIGH_VALUE', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'LUX-2', unitWeightKg: 0.3, dimensions: { lengthCm: 12, widthCm: 8, heightCm: 4 }, unitValue: 500, category: 'GENERAL', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'BIG-1', unitWeightKg: 38, dimensions: { lengthCm: 150, widthCm: 70, heightCm: 60 }, unitValue: 300, category: 'OVERSIZED', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'BIG-2', unitWeightKg: 20, dimensions: { lengthCm: 100, widthCm: 85, heightCm: 85 }, unitValue: 90, category: 'GENERAL', requiresTemperatureControl: false, isHazmat: false },
    { sku: 'TINY-1', unitWeightKg: 0.05, dimensions: { lengthCm: 8, widthCm: 6, heightCm: 1 }, unitValue: 5, category: 'UNKNOWN', requiresTemperatureControl: false, isHazmat: false },
  ];
  const tiers = ['SAME_DAY', 'NEXT_DAY_EXPRESS', 'TWO_DAY_EXPEDITED', 'STANDARD_GROUND', 'ECONOMY'];
  const weekHours = (days: number[], cutoff: string) => days.map((dayOfWeek) => ({ dayOfWeek, openTime: '08:00', closeTime: '18:00', cutoffTime: cutoff }));

  const inputFor = (r: ReturnType<typeof h.rng>) => {
    const items = [];
    const itemCount = r.pick([0, 1, 1, 2, 2, 3, 4]);
    const pool = [...skuCatalog];
    for (let k = 0; k < itemCount && pool.length; k++) {
      const spec = pool.splice(r.int(pool.length), 1)[0];
      items.push({ ...spec, dimensions: { ...spec.dimensions }, quantity: r.pick([1, 1, 2, 3, 6, 9, 0, -1].slice(0, r.chance(0.95) ? 6 : 8)), unitWeightKg: r.chance(0.02) ? 0 : spec.unitWeightKg });
    }
    const order = {
      orderId: r.chance(0.02) ? '' : 'ORD-1',
      customerRef: 'C-1',
      createdAt: at(15, 9),
      slaTier: r.pick(tiers),
      targetDeliveryDate: r.pick([at(15, 23), at(16, 23), at(17, 23), at(20, 23), at(26, 23)]),
      shippingAddress: r.chance(0.02)
        ? (r.pick([undefined, { postalCode: '' }]) as any)
        : { street: '1 Rua', city: 'Porto', state: 'PT', postalCode: r.pick(['4000-001', '4000-001', '9000-100', '1000-200', '99501']), country: 'PT', isCommercial: r.chance(0.5), isRemoteZone: r.chance(0.2), isPobox: r.chance(0.12) },
      items,
      allowPartialFulfillment: r.chance(0.5),
      maxSplitShipments: r.pick([1, 1, 2, 3]),
      declaredValueTotal: r.pick([50, 400, 999, 1000, 5000]),
      customerPaidShipping: 9.9,
    };
    const warehouses = [];
    const whCount = r.pick([0, 1, 2, 2, 3]);
    for (let w = 0; w < whCount; w++) {
      const inventory: [string, any][] = [];
      for (const spec of skuCatalog) {
        if (r.chance(0.3)) continue;
        inventory.push([spec.sku, { sku: spec.sku, quantityOnHand: r.pick([0, 1, 2, 5, 50, 50]), quantityReserved: r.pick([0, 0, 1, 10]), isAwaitingReplenishment: false }]);
      }
      warehouses.push({
        id: `WH-${w}`,
        code: `W${w}`,
        name: `Warehouse ${w}`,
        address: { street: 's', city: 'c', state: 'PT', postalCode: '4400-000', country: 'PT', isCommercial: true, isRemoteZone: false, isPobox: false },
        isOperational: !r.chance(0.1),
        inventory,
        operatingHours: r.pick([weekHours([1, 2, 3, 4, 5], '15:00'), weekHours([1, 2, 3, 4, 5], '08:30'), weekHours([1, 2, 3, 4, 5, 6], '17:00'), weekHours([0, 1, 2, 3, 4, 5, 6], '23:59'), weekHours([2], '12:00')]),
        capabilities: { hazmatApproved: r.chance(0.7), coldStorageAvailable: r.chance(0.7), frozenStorageAvailable: r.chance(0.6), hasPalletJack: true, highValueVault: r.chance(0.7), maxDailyPackingCapacity: 100, currentDailyPackedCount: r.pick([0, 50, 100, 120]) },
        supportedCarrierIds: r.pick([['CR-0', 'CR-1'], ['CR-0', 'CR-1'], ['CR-0'], ['CR-1'], []]),
      });
    }
    const carriers = [];
    const carrierCount = r.pick([0, 1, 2, 2]);
    for (let c = 0; c < carrierCount; c++) {
      const services = [];
      const svcCount = 1 + r.int(3);
      for (let s = 0; s < svcCount; s++) {
        services.push({
          serviceId: `SVC-${c}-${s}`,
          serviceCode: `S${c}${s}`,
          serviceName: 'Service',
          slaTierSupported: r.pick([...tiers, 'FREIGHT']),
          maxWeightKg: r.pick([5, 30, 70, 1000]),
          maxDimensions: r.pick([{ lengthCm: 60, widthCm: 40, heightCm: 40 }, { lengthCm: 120, widthCm: 80, heightCm: 80 }, { lengthCm: 300, widthCm: 200, heightCm: 200 }, { lengthCm: 300, widthCm: 200, heightCm: 500 }]),
          supportsHazmat: r.chance(0.6),
          supportsColdChain: r.chance(0.6),
          supportsPobox: r.chance(0.5),
          requiresSignatureThreshold: r.pick([500, 1000, 100000]),
          baseRate: r.pick([4.5, 8, 19.9]),
          perKgRate: r.pick([0.6, 1.25, 3]),
          dimensionalWeightDivisor: r.pick([5000, 6000, 4000]),
          fuelSurchargePercentage: r.pick([0, 8.5, 14]),
          remoteZoneSurcharge: r.pick([6, 18]),
          hazmatSurcharge: 25,
          coldChainSurcharge: 12,
          signatureFee: 3.5,
          saturdayDeliveryAvailable: r.chance(0.4),
          saturdayDeliveryFee: 9,
          blacklistedPostalPrefixes: r.pick([[], [], ['9000'], ['99']]),
          whitelistedPostalPrefixes: r.pick([[], [], [], ['4000', '1000'], ['77']]),
        });
      }
      carriers.push({ id: `CR-${c}`, code: `C${c}`, name: `Carrier ${c}`, isOperational: !r.chance(0.1), dailyPackageCap: r.pick([1000, 1000, 2, 0]), currentDailyPackageCount: r.pick([0, 0, 1, 999]), services });
    }
    const now = r.pick([at(15, 9), at(15, 14, 59), at(15, 15, 1), at(15, 20), at(16, 16), at(17, 10), at(18, 10), at(19, 7), at(14, 12)]);
    return { order, warehouses, carriers, now };
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  for (let i = 0; i < 14000; i++) {
    const input = inputFor(h.rng(22000 + i));
    cases.push({
      label: `route-${i}`,
      run: (mod) => {
        // Warehouses carry a Map; rebuilt per run so no state leaks between cases or arms.
        const warehouses = input.warehouses.map((w) => ({ ...w, inventory: new Map(w.inventory.map(([k, v]) => [k, { ...v }])) }));
        return new mod.OrderFulfilmentRoutingService().calculateOptimalRouting(JSON.parse(JSON.stringify(input.order), (k, v) => (['createdAt', 'targetDeliveryDate'].includes(k) ? new Date(v) : v)), warehouses, JSON.parse(JSON.stringify(input.carriers)), new Date(input.now.getTime()));
      },
    });
  }
  for (const [i, order] of [null, undefined, {}, { orderId: 'X' }, { orderId: 'X', items: [] }].entries()) {
    cases.push({ label: `malformed-${i}`, run: (mod) => new mod.OrderFulfilmentRoutingService().calculateOptimalRouting(order, [], [], at(15, 9)) });
  }
  return cases;
});
