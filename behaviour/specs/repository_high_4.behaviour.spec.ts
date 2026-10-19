import { defineSubject } from '../harness';

defineSubject('repository_high_4', (h) => {
  const at = (day: number, hour: number) => new Date(Date.UTC(2026, 0, day, hour, 30));
  const timestamps = [undefined, undefined, at(15, 12), at(15, 18), at(15, 21), at(15, 22), at(15, 2), at(15, 5), at(15, 6), at(17, 12), at(17, 20), at(17, 21), at(18, 11), at(19, 17)];
  const segments = ['RETAIL', 'RETAIL', 'VIP', 'WHOLESALE', 'NEW_USER', 'EMPLOYEE'];

  const scenarios = [];
  for (let i = 0; i < 5000; i++) {
    const r = h.rng(17000 + i);
    const product = (productId: string) => ({
      productId,
      sku: `SKU-${productId}`,
      basePrice: r.pick([19.9, 50, 120, 999]),
      costBasis: r.pick([5, 10, 30, 60, 1200]),
      msrp: r.pick([60, 150, 1500]),
      minMarginPercent: r.pick([5, 20, 60]),
      maxMarginPercent: r.pick([40, 150, 900]),
      currentStock: r.pick([0, 5, 10, 18, 20, 40, 100, 150, 400]),
      safetyStock: r.pick([5, 10]),
      reorderPoint: r.pick([20, 30]),
      overstockThreshold: r.pick([100, 150]),
      salesVelocityPerHour: 2,
      roundingMode: r.pick(['NEAREST_NINETY_NINE', 'STANDARD_TWO_DECIMALS', 'CEIL_INTEGER', 'FLOOR_INTEGER', 'BANKERS']),
      isPricingActive: !r.chance(0.07),
    });
    const ops: any[] = [{ kind: 'createProduct', config: product('P1') }];
    if (r.chance(0.3)) ops.push({ kind: 'createProduct', config: product(r.pick(['P1', 'P2'])) });
    const length = 3 + r.int(14);
    for (let k = 0; k < length; k++) {
      const pid = r.pick(['P1', 'P1', 'P1', 'P2', 'P9']);
      const kind = r.pick([
        'calculate', 'calculate', 'calculate', 'calculate', 'calculate', 'competitor', 'competitor', 'demand', 'demand', 'segmentRule', 'segmentRule',
        'pricingRule', 'pricingRule', 'pricingRule', 'updateProduct', 'deleteProduct', 'deleteSegmentRule', 'deletePricingRule', 'read', 'audit', 'clear',
      ]);
      if (kind === 'calculate') {
        ops.push({ kind, context: { productId: pid, segment: r.pick(segments), quantity: r.pick([1, 1, 3, 10, 50]), loyaltyTierLevel: r.pick([undefined, 1, 2, 4]), requestTimestamp: r.pick(timestamps), allowCompetitorMatching: r.pick([undefined, true, false]) } });
      } else if (kind === 'competitor') {
        ops.push({ kind, data: { id: r.pick(['c1', 'c2', 'c3']), productId: pid, competitorName: r.pick(['Alpha', 'Beta', 'Gamma']), price: r.pick([8, 18, 35, 49.5, 110, 2000]), reliabilityScore: r.pick([0.9, 0.6, 0.59, 0.2]), isPriceMatchAllowed: !r.chance(0.2), lastScrapedAt: at(14, 9) } });
      } else if (kind === 'demand') {
        ops.push({ kind, metric: { productId: pid, demandScore: r.pick([5, 19, 20, 49, 50, 79, 80, 95]), trend: r.pick(['RISING', 'FALLING', 'STABLE']), viewCountLastHour: r.pick([10, 100, 101, 5000]), cartAddCountLastHour: 3, conversionRate: r.pick([0.001, 0.019, 0.02, 0.2]), lastUpdatedAt: at(15, 11) } });
      } else if (kind === 'segmentRule') {
        ops.push({ kind, rule: { id: r.pick(['s1', 's2', 's3']), segment: r.pick(segments), discountPercent: r.pick([5, 10, 30]), priority: r.pick([1, 5, 9]), isStackable: r.chance(0.6), maxDiscountAmount: r.pick([0, 0, 2, 25]), minOrderQuantity: r.pick([1, 1, 5, 20]), loyaltyTierMultiplier: r.pick([0, 1.5]) } });
      } else if (kind === 'pricingRule') {
        ops.push({
          kind,
          rule: {
            id: r.pick(['r1', 'r2', 'r3', 'r4']),
            name: 'Rule',
            priority: r.pick([1, 3, 3, 8]),
            isActive: !r.chance(0.15),
            validFrom: r.pick([null, null, at(1, 0), at(16, 0)]),
            validTo: r.pick([null, null, at(31, 0), at(14, 0)]),
            minDemandScore: r.pick([undefined, undefined, 50, 90]),
            maxDemandScore: r.pick([undefined, undefined, 30, 85]),
            demandTrend: r.pick([undefined, undefined, 'RISING', 'FALLING']),
            minInventoryLevel: r.pick([undefined, undefined, 15, 200]),
            maxInventoryLevel: r.pick([undefined, undefined, 50, 5]),
            targetSegment: r.pick([undefined, undefined, 'VIP', 'RETAIL']),
            action: r.pick(['MARKUP_PERCENT', 'MARKUP_FLAT', 'DISCOUNT_PERCENT', 'DISCOUNT_FLAT', 'MATCH_COMPETITOR', 'SET_FIXED', 'NOPE']),
            actionValue: r.pick([5, 12.5, 40, 500]),
            stopProcessingFurtherRules: r.chance(0.2),
          },
        });
      } else if (kind === 'updateProduct') {
        ops.push({ kind, productId: pid, updates: r.pick([{ basePrice: 75 }, { costBasis: 500 }, { currentStock: 3 }, { currentStock: 500 }, { isPricingActive: true }, { isPricingActive: false }, { roundingMode: 'CEIL_INTEGER', msrp: 80 }, {}]) });
      } else if (kind === 'deleteProduct') ops.push({ kind, productId: pid });
      else if (kind === 'deleteSegmentRule') ops.push({ kind, ruleId: r.pick(['s1', 's2', 's9']) });
      else if (kind === 'deletePricingRule') ops.push({ kind, ruleId: r.pick(['r1', 'r2', 'r9']) });
      else if (kind === 'clear') { if (r.chance(0.15)) ops.push({ kind }); }
      else ops.push({ kind, productId: pid });
    }
    scenarios.push({ label: `scenario-${i}`, ops });
  }

  return scenarios.map(({ label, ops }) => ({
    label,
    run: (mod) => {
      const repo = new mod.DynamicPricingRepository();
      return ops.map((op: any) => {
        switch (op.kind) {
          case 'createProduct': return h.step(() => repo.createProduct({ ...op.config }));
          case 'calculate': return h.step(() => repo.calculateDynamicPrice({ ...op.context }));
          case 'competitor': return h.step(() => repo.upsertCompetitorPrice({ ...op.data }));
          case 'demand': return h.step(() => repo.updateDemandMetric({ ...op.metric }));
          case 'segmentRule': return h.step(() => repo.upsertCustomerSegmentRule({ ...op.rule }));
          case 'pricingRule': return h.step(() => repo.upsertPricingRule({ ...op.rule }));
          case 'updateProduct': return h.step(() => repo.updateProduct(op.productId, { ...op.updates }));
          case 'deleteProduct': return h.step(() => repo.deleteProduct(op.productId));
          case 'deleteSegmentRule': return h.step(() => repo.deleteCustomerSegmentRule(op.ruleId));
          case 'deletePricingRule': return h.step(() => repo.deletePricingRule(op.ruleId));
          case 'clear': return h.step(() => repo.clearAllData());
          case 'audit': return h.step(() => repo.getAuditLogs(op.productId));
          default: return h.step(() => ({ product: h.step(() => repo.getProductById(op.productId)), competitors: repo.getCompetitorPrices(op.productId), demand: repo.getDemandMetric(op.productId) }));
        }
      });
    },
  }));
});
