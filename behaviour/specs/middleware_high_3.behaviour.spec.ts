import { defineSubject } from '../harness';

defineSubject('middleware_high_3', (h) => {
  const baseItem = () => ({
    sku: 'SKU-1',
    category: 'STANDARD',
    currentStock: 20,
    onOrderStock: 0,
    allocatedStock: 0,
    backorders: 0,
    avgDailyDemand: 10,
    demandStdDev: 2,
    unitCost: 10,
    unitVolumeCBM: 0.05,
    unitWeightKG: 1,
    moq: 10,
    maxOq: 0,
    packSize: 1,
    targetServiceLevel: 0.95,
    storageZone: 'AMBIENT',
  });
  const itemPools = {
    category: ['PERISHABLE', 'HAZMAT', 'BULK', 'COLD_STORAGE', 'OTHER'],
    expiryDate: ['2026-01-10', '2026-01-15T12:00:00.000Z', '2026-01-18', '2026-06-01', 'garbage'],
    shelfLifeDays: [0, 1, 2, 30, 365],
    currentStock: [0, 50, 200, 5000],
    onOrderStock: [30, 500],
    allocatedStock: [15, 400],
    backorders: [5, 300],
    avgDailyDemand: [0, 1, 40, 250],
    demandStdDev: [0, 8, 60],
    unitCost: [0.5, 75, 900],
    unitVolumeCBM: [0.001, 0.8, 6],
    unitWeightKG: [0.2, 30],
    moq: [1, 60, 150, 400, 5000],
    maxOq: [15, 60, 100000],
    packSize: [6, 24, 100],
    targetServiceLevel: [0.999, 0.99, 0.98, 0.9, 0.85, 0.8, 0.5],
    storageZone: ['COLD', 'FROZEN', 'HAZARDOUS', 'MEZZANINE'],
  };
  const base = () => ({
    method: 'POST',
    path: '/api/reorder-planner/run',
    item: baseItem() as any,
    supplier: {
      id: 'sup-1',
      name: 'Acme Supply',
      tier: 'PREFERRED',
      reliabilityScore: 90,
      baseLeadTimeDays: 7,
      leadTimeVarianceDays: 2,
      minOrderValue: 100,
      operationalDaysMask: [1, 2, 3, 4, 5],
      blackoutDates: [],
    } as any,
    warehouse: {
      id: 'wh-1',
      maxVolumeCBM: 1000,
      maxWeightKG: 50000,
      availableVolumeCBM: 600,
      availableWeightKG: 30000,
      zoneCapacities: {
        AMBIENT: { maxCBM: 500, currentCBM: 100 },
        COLD: { maxCBM: 200, currentCBM: 50 },
        FROZEN: { maxCBM: 100, currentCBM: 95 },
        HAZARDOUS: { maxCBM: 50, currentCBM: 49.9 },
      },
    } as any,
    seasonalityRules: [] as any,
    params: {
      planningHorizonDays: 30,
      budgetLimit: 100000,
      allowPartialOrders: true,
      emergencyProcurementMode: false,
      targetDate: '2026-01-15T12:00:00.000Z',
    } as any,
  });
  const payloadPools = {
    method: ['PUT', 'GET', 'DELETE'],
    path: ['/other', '', '/v2/reorder-planner'],
    supplier: [null],
    warehouse: [undefined],
    params: [null],
    'supplier.tier': ['SECONDARY', 'SPOT_MARKET', 'RESTRICTED'],
    'supplier.reliabilityScore': [70, 69, 45, 0],
    'supplier.baseLeadTimeDays': [1, 3, 30],
    'supplier.leadTimeVarianceDays': [0, 5],
    'supplier.minOrderValue': [0, 5000, 1000000],
    'warehouse.maxVolumeCBM': [0, 5],
    'warehouse.zoneCapacities.AMBIENT.maxCBM': [100, 101, 110],
    'warehouse.zoneCapacities.AMBIENT.currentCBM': [0, 499.9, 600],
    'warehouse.zoneCapacities.COLD': [undefined],
    seasonalityRules: [
      [{ month: 1, demandMultiplier: 1.5 }],
      [{ month: 1, demandMultiplier: 0, peakMultiplier: 2, peakEventName: 'New Year' }],
      [{ month: 1, demandMultiplier: 2, peakMultiplier: 1.5 }],
      [{ month: 3, demandMultiplier: 3, peakMultiplier: 3 }, { month: 12, demandMultiplier: 0.5 }, { month: 1, demandMultiplier: 0.25 }],
      [{ month: 1, demandMultiplier: 1.2 }, { month: 1, demandMultiplier: 9, peakMultiplier: 9 }],
    ],
    'params.budgetLimit': [0, -1, 40, 300, 2500],
    'params.allowPartialOrders': [false],
    'params.emergencyProcurementMode': [true],
    'params.targetDate': ['', '2026-03-10', '2026-12-05T00:00:00Z'],
  };

  const prefixed = Object.fromEntries(Object.entries(itemPools).map(([k, v]) => [`item.${k}`, v]));
  const single = h.variants(base, { ...payloadPools, ...prefixed, 'item': [null] }, { random: 1200, maxK: 7, seed: 51 });

  const cases = single.map(({ label, input }) => ({ label, payload: { ...input, items: input.item === null ? undefined : [input.item] } }));
  cases.push({ label: 'no-items-array', payload: { ...base(), items: [] } as any });
  for (let i = 0; i < 900; i++) {
    const r = h.rng(5100 + i);
    const input: any = h.mutated(base, payloadPools, r, 4);
    const items = [];
    const n = 2 + r.int(5);
    for (let k = 0; k < n; k++) items.push({ ...(h.mutated(baseItem, itemPools, r, 5) as any), sku: `SKU-${k}` });
    cases.push({ label: `multi-${i}`, payload: { ...input, items } });
  }

  return cases.map(({ label, payload }) => ({
    label,
    run: (mod) => {
      const { method, path, item, ...body } = payload as any;
      const { req, res, next, trace } = h.http({ method, path, headers: {}, body });
      const returned = new mod.ReorderPlannerMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
