/**
 * middleware_high_3 — supply-chain reorder planner middleware.
 * Prompt: "a supply-chain reorder planner (lead times, safety stock, seasonality) ... Implement
 * every rule and edge case fully and explicitly".
 *
 * Divergence under study: the refactored version gained `if (orderEval.rawQty <= 0) return;`,
 * which drops an item whose final quantity came out as 0. The original kept it in the plan
 * with quantity 0.
 */
import { http } from '../../harness';
import { load, freezeClock } from '../load';

const mod = load('middleware_high_3');
freezeClock();

const item = (o: Record<string, unknown> = {}) => ({
  sku: 'SKU-1', category: 'STANDARD', currentStock: 0, onOrderStock: 0, allocatedStock: 0, backorders: 0,
  avgDailyDemand: 10, demandStdDev: 2, unitCost: 10, unitVolumeCBM: 0.01, unitWeightKG: 1,
  moq: 0, maxOq: 0, packSize: 1, targetServiceLevel: 0.95, storageZone: 'AMBIENT', ...o,
});
const zone = { maxCBM: 1000, currentCBM: 0 };
const payload = (items: unknown[], params: Record<string, unknown> = {}) => ({
  supplier: { id: 'S1', name: 'Acme', tier: 'PREFERRED', reliabilityScore: 90, baseLeadTimeDays: 10, leadTimeVarianceDays: 0, minOrderValue: 0, operationalDaysMask: [1, 2, 3, 4, 5], blackoutDates: [] },
  warehouse: { id: 'W1', maxVolumeCBM: 1000, maxWeightKG: 100000, availableVolumeCBM: 1000, availableWeightKG: 100000, zoneCapacities: { AMBIENT: zone, COLD: zone, FROZEN: zone, HAZARDOUS: zone } },
  items,
  seasonalityRules: [],
  params: { planningHorizonDays: 30, budgetLimit: 0, allowPartialOrders: true, emergencyProcurementMode: false, targetDate: '2026-01-15T00:00:00.000Z', ...params },
});
const plan = (body: unknown) => {
  const { req, res, next } = http({ method: 'POST', path: '/reorder-planner', url: '/reorder-planner', body });
  new mod.ReorderPlannerMiddleware().use(req, res, next);
  return req.reorderPlanContext;
};

// Budget 5 with unit cost 10 and MOQ 0: the affordable quantity is 0.
const zeroQtyCase = () => payload([item()], { budgetLimit: 5 });

describe('middleware_high_3', () => {
  test('[ANCHOR] (domain) an item below its reorder point, with ample budget, is ordered (quantity > 0, cost = qty x unit cost)', () => {
    const c = plan(payload([item()]));
    expect(c.processedItems).toHaveLength(1);
    const p = c.processedItems[0];
    expect(p.finalOrderQuantity).toBeGreaterThan(0);
    expect(p.totalCost).toBeCloseTo(p.finalOrderQuantity * 10, 6);
  });

  test('[ANCHOR] (domain) an item with stock well above its reorder point is not ordered', () => {
    const c = plan(payload([item({ currentStock: 100000 })]));
    expect(c.processedItems).toHaveLength(0);
  });

  test('[TARGET] (domain) the plan never contains an order line with quantity 0', () => {
    const c = plan(zeroQtyCase());
    expect(c.processedItems.filter((p: any) => p.finalOrderQuantity === 0)).toEqual([]);
  });

  test('[TARGET] (prompt: every edge case explicit) an item that needs stock but cannot be ordered is reported, not silently dropped', () => {
    const c = plan(zeroQtyCase());
    const reported = [...c.processedItems, ...c.rejectedItems].map((p: any) => p.sku);
    expect(reported).toContain('SKU-1');
  });
});
