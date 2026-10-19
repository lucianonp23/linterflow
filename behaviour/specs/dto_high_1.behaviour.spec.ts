import { defineSubject } from '../harness';

const DAY = 86400000;

defineSubject('dto_high_1', (h) => {
  const catalog = [
    { productId: 'p1', categoryId: 'cat-a', brandId: 'brand-x' },
    { productId: 'p2', categoryId: 'cat-a', brandId: 'brand-y' },
    { productId: 'p3', categoryId: 'cat-b', brandId: 'brand-x' },
    { productId: 'p4', categoryId: 'cat-c', brandId: 'brand-z' },
  ];
  const conditionPool = [
    { field: 'lifetimeSpend', operator: 'GREATER_THAN', value: 500 },
    { field: 'lifetimeSpend', operator: 'LESS_THAN', value: '500' },
    { field: 'attributes.country', operator: 'EQUALS', value: 'PT' },
    { field: 'attributes.country', operator: 'NOT_EQUALS', value: 'PT' },
    { field: 'attributes.email', operator: 'CONTAINS', value: '@example.com' },
    { field: 'orderCount', operator: 'CONTAINS', value: 1 },
    { field: 'attributes.tier', operator: 'IN', value: ['gold', 'silver'] },
    { field: 'attributes.tier', operator: 'NOT_IN', value: ['gold'] },
    { field: 'attributes.tier', operator: 'IN', value: 'gold' },
    { field: 'attributes.missing.deep', operator: 'EQUALS', value: undefined },
    { field: 'id', operator: 'MATCHES', value: 'x' },
  ];
  const exclusionPool = [
    { type: 'PRODUCT', value: 'p1' }, { type: 'PRODUCT', value: 'p4' }, { type: 'CATEGORY', value: 'cat-a' }, { type: 'CATEGORY', value: 'cat-b' },
    { type: 'BRAND', value: 'brand-x' }, { type: 'BRAND', value: 'brand-z' }, { type: 'PAYMENT_METHOD', value: 'PAYPAL' }, { type: 'PAYMENT_METHOD', value: 'CARD' },
    { type: 'SHIPPING_METHOD', value: 'EXPRESS' }, { type: 'PROMOTION_CODE', value: 'R0' }, { type: 'OTHER', value: 'x' },
  ];

  const requestFor = (r: ReturnType<typeof h.rng>) => {
    const items = catalog.filter(() => r.chance(0.6)).map((p) => ({ ...p, unitPrice: r.pick([4.99, 20, 75, 300]), quantity: r.pick([1, 1, 2, 3, 5]) }));
    if (r.chance(0.15) && items.length) items.push({ ...items[0], quantity: 2 });
    const segments: any[] = [];
    for (const type of ['VIP', 'NEW_USER', 'INACTIVE', 'HIGH_SPENDER', 'CUSTOM', 'CUSTOM', 'ALIEN']) {
      if (!r.chance(0.5)) continue;
      const seg: any = { id: `seg-${type.toLowerCase()}-${segments.length}`, type };
      if (type === 'CUSTOM') seg.conditions = r.pick([undefined, [], [r.pick(conditionPool)], [r.pick(conditionPool), r.pick(conditionPool)]]);
      segments.push(seg);
    }
    const orders: any[] = [];
    const orderCount = r.int(4);
    for (let o = 0; o < orderCount; o++) orders.push({ orderId: `o-${o}`, orderDate: new Date(h.NOW - r.pick([1, 30, 59, 60, 61, 200]) * DAY), totalSpent: r.pick([50, 250, 499, 500, 1200]), itemIds: ['p1'], categoryIds: ['cat-a'] });
    const rules: any[] = [];
    const ruleCount = r.int(5);
    for (let k = 0; k < ruleCount; k++) {
      const discountType = r.pick(['PERCENTAGE', 'PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y', 'FREE_SHIPPING', 'MYSTERY']);
      rules.push({
        id: `rule-${k}`,
        code: r.chance(0.1) ? 'R0' : `R${k}`,
        discountType,
        discountValue: r.pick([5, 10, 25, 50, 150, 1000]),
        maxDiscountAmount: r.pick([undefined, undefined, 0, 15, 40]),
        minCartSubtotal: r.pick([0, 0, 50, 400, 5000]),
        eligibleSegmentIds: r.pick([[], [], undefined, segments.length ? [r.pick(segments).id] : ['seg-none'], ['seg-none'], segments.map((s) => s.id)]),
        requiredProductIds: r.pick([undefined, [], ['p1'], ['p1', 'p3'], ['p9']]),
        exclusions: r.pick([undefined, [], [r.pick(exclusionPool)], [r.pick(exclusionPool), r.pick(exclusionPool)], exclusionPool.slice(0, 6)]),
        stackingMode: r.pick(['NO_STACKING', 'STACK_WITH_ALL', 'STACK_WITH_ALL', 'EXCLUSIVE_CATEGORY', 'EXCLUSIVE_CATEGORY', 'EXCLUSIVE_PROMOTION', 'MAX_DISCOUNT_CAP']),
        priority: r.pick([1, 1, 5, 10]),
        validFrom: new Date(h.NOW + r.pick([-30, -30, -30, 0, 1]) * DAY),
        validTo: new Date(h.NOW + r.pick([30, 30, 30, 0, -1]) * DAY),
        usageLimitTotal: r.pick([100, 100, 5]),
        usageLimitPerCustomer: r.pick([1, 1, 0]),
        currentTotalUsage: r.pick([0, 4, 5, 100]),
        buyXGetYConfig: discountType === 'BUY_X_GET_Y' || r.chance(0.1) ? r.pick([undefined, { buyProductId: 'p1', buyQuantity: r.pick([1, 2, 4]), getFreeProductId: r.pick(['p2', 'p3', 'p9']), getFreeQuantity: r.pick([1, 3]), discountPercentageForY: r.pick([100, 50, 0]) }]) : undefined,
      });
    }
    const requested = rules.filter(() => r.chance(0.8)).map((x) => x.code);
    if (r.chance(0.2)) requested.push('GHOST');
    if (r.chance(0.3)) requested.reverse();
    return {
      cart: { cartId: 'cart-1', items, currency: 'EUR', paymentMethod: r.pick(['CARD', 'PAYPAL', 'MBWAY']), shippingMethod: r.pick(['STANDARD', 'EXPRESS']), shippingFee: r.pick([0, 4.99, 12]) },
      customer: {
        id: 'cust-1',
        segments,
        lifetimeSpend: r.pick([0, 499, 500, 999, 1000, 4000]),
        orderCount: r.pick([0, 1, 2, 9, 10]),
        lastPurchaseDate: r.pick([undefined, new Date(h.NOW - 10 * DAY), new Date(h.NOW - 90 * DAY), new Date(h.NOW - 91 * DAY)]),
        createdDate: new Date(h.NOW - r.pick([1, 29, 30, 31, 400]) * DAY),
        attributes: r.pick([undefined, {}, { country: 'PT', tier: 'gold', email: 'ana@example.com' }, { country: 'ES', tier: 'bronze', email: 'x@other.org' }]),
      },
      purchaseHistory: { orders },
      requestedPromotionCodes: requested,
      activeRules: rules,
      evaluationTimestamp: r.pick([undefined, undefined, new Date(h.NOW), new Date(h.NOW + 40 * DAY), new Date(h.NOW - 40 * DAY)]),
    };
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  for (let i = 0; i < 9000; i++) {
    const request = requestFor(h.rng(16000 + i));
    cases.push({ label: `engine/${i}`, run: (mod) => new mod.PromotionEligibilityEngine().evaluatePromotions(request) });
  }

  // The request DTO, from plain JSON (dates as strings), through transformation + validation.
  const plain = (seed: number) => JSON.parse(JSON.stringify(requestFor(h.rng(seed))));
  for (let i = 0; i < 1500; i++) {
    cases.push({ label: `dto/generated-${i}`, run: (mod) => h.validateDto(mod.EvaluatePromotionRequestDto, plain(16000 + i)) });
  }
  const basePlain = () => {
    const p = plain(16003);
    p.requestedPromotionCodes = ['R0'];
    p.cart.items = [{ productId: 'p1', categoryId: 'cat-a', brandId: 'brand-x', unitPrice: 20, quantity: 1 }];
    return p;
  };
  for (const { label, input } of h.variants(
    basePlain,
    {
      cart: [undefined, null, {}],
      'cart.cartId': ['', 5],
      'cart.items': [[], 'x', [{ productId: '', categoryId: 1, brandId: null, unitPrice: 0, quantity: 0, tags: [1] }]],
      'cart.shippingFee': [-1, '5'],
      'cart.currency': [''],
      customer: [undefined, {}],
      'customer.segments': ['x', [{ id: '', type: 'NOPE', conditions: [{ field: '', operator: 'LIKE' }] }]],
      'customer.lifetimeSpend': [-1],
      'customer.createdDate': ['garbage', h.DEL],
      'customer.lastPurchaseDate': ['garbage'],
      purchaseHistory: [undefined, { orders: 'x' }, { orders: [{ orderId: '', orderDate: 'bad', totalSpent: -1, itemIds: [1], categoryIds: 'x' }] }],
      requestedPromotionCodes: [[], ['R0', 'R0'], ['R0', 5], 'R0', h.DEL],
      activeRules: [
        'x',
        [{ id: '', code: '', discountType: 'X', discountValue: -1, minCartSubtotal: -1, eligibleSegmentIds: 'x', stackingMode: 'X', priority: 'p', validFrom: '2026-02-01', validTo: '2026-01-01', usageLimitTotal: 0, usageLimitPerCustomer: 0, currentTotalUsage: -1, buyXGetYConfig: { buyProductId: '', buyQuantity: 0, getFreeProductId: '', getFreeQuantity: 0, discountPercentageForY: 101 }, exclusions: [{ type: 'X', value: '' }] }],
        [{ id: 'r', code: 'R0', discountType: 'PERCENTAGE', discountValue: 10, minCartSubtotal: 0, eligibleSegmentIds: [], stackingMode: 'NO_STACKING', priority: 1, validFrom: '2026-01-01', validTo: '2026-01-01', usageLimitTotal: 1, usageLimitPerCustomer: 1, currentTotalUsage: 0 }],
      ],
      evaluationTimestamp: ['garbage', '2026-01-15T00:00:00.000Z'],
    },
    { random: 600, maxK: 5, seed: 161 },
  )) {
    cases.push({ label: `dto/${label}`, run: (mod) => h.validateDto(mod.EvaluatePromotionRequestDto, input) });
  }
  for (const cls of ['SegmentConditionDto', 'CustomerSegmentDto', 'CartItemDto', 'CartDto', 'PurchaseHistoryItemDto', 'CustomerPurchaseHistoryDto', 'CustomerProfileDto', 'ExclusionRuleDto', 'BuyXGetYConfigDto', 'PromotionRuleDto', 'PromotionEvaluationResultDto', 'EngineEvaluationResponseDto']) {
    cases.push({ label: `nested/${cls}/empty`, run: (mod) => h.validateDto(mod[cls], {}) });
  }

  const args = (object: unknown, constraints: unknown[] = []) => ({ object, constraints, property: 'validTo', value: undefined, targetName: 'PromotionRuleDto' });
  const dates: unknown[] = [new Date('2026-01-01T10:00:00Z'), new Date('2026-01-01T10:00:00.001Z'), new Date('2025-01-01T00:00:00Z'), '2026-01-02', null, undefined];
  dates.forEach((a, i) =>
    dates.forEach((b, j) =>
      cases.push({ label: `after-date/${i}-${j}`, run: (mod) => { const c = new mod.IsAfterDateConstraint(); const ctx = args({ validFrom: b }, ['validFrom']); return { valid: c.validate(a, ctx), message: c.defaultMessage(ctx) }; } }),
    ),
  );
  [[], ['a'], ['a', 'b'], ['a', 'a'], [1, '1'], 'aa', null, undefined, [null, null]].forEach((value, i) =>
    cases.push({ label: `unique-array/${i}`, run: (mod) => { const c = new mod.UniqueArrayConstraint(); return { valid: c.validate(value), message: c.defaultMessage(args({})) }; } }),
  );
  cases.push({ label: 'decorator-factories', run: (mod) => ({ after: typeof mod.IsAfterDate('validFrom'), unique: typeof mod.IsUniqueArray({ message: 'm' }) }) });
  return cases;
});
