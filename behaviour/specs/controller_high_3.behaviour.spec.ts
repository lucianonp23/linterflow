import { defineSubject } from '../harness';

// Inventory and orders are module-level stores: every case starts from a fresh module.
defineSubject(
  'controller_high_3',
  (h) => {
    const skus = [
      ['SKU-DIGITAL-1', 'digital'], ['SKU-PHYSICAL-1', 'physical'], ['SKU-PHYSICAL-1', 'physical'], ['SKU-PHYSICAL-2', 'physical'],
      ['SKU-PERISHABLE-1', 'perishable'], ['SKU-HAZARDOUS-1', 'hazardous'], ['SKU-OUT-OF-STOCK', 'physical'], ['SKU-GHOST', 'physical'], ['SKU-PHYSICAL-2', 'perishable'],
    ];
    const countries = ['US', 'US', 'US', 'us', 'CA', 'DE', 'FR', 'IT', 'ES', 'SE', 'NL', 'BR'];
    const states = ['CA', 'NY', 'TX', 'OR', 'FL', 'ON', 'BC', 'AB', 'QC', 'xx'];
    const future = new Date(h.NOW + 86400000).toISOString();
    const past = new Date(h.NOW - 86400000).toISOString();
    const couponPool = [
      { code: 'TEN', discountType: 'percent', value: 10, canStack: true, expiresAt: future },
      { code: 'FIXED20', discountType: 'fixed', value: 20, canStack: true, expiresAt: future },
      { code: 'SOLO50', discountType: 'percent', value: 50, canStack: false, expiresAt: future },
      { code: 'OLD', discountType: 'percent', value: 90, canStack: true, expiresAt: past },
      { code: 'NOW', discountType: 'fixed', value: 5, canStack: true, expiresAt: new Date(h.NOW).toISOString() },
      { code: 'BIGSPEND', discountType: 'fixed', value: 75, minSubtotal: 500, canStack: true, expiresAt: future },
      { code: 'DIGI', discountType: 'percent', value: 25, categoryRestriction: 'digital', canStack: true, expiresAt: future },
      { code: 'FRESH', discountType: 'percent', value: 30, categoryRestriction: 'perishable', maxDiscountCap: 5, canStack: true, expiresAt: future },
      { code: 'CAPPED', discountType: 'percent', value: 80, maxDiscountCap: 15, canStack: true, expiresAt: future },
      { code: 'HUGE', discountType: 'fixed', value: 100000, canStack: true, expiresAt: future },
      { code: 'WEIRD', discountType: 'bogo', value: 1, canStack: true, expiresAt: future },
    ];

    const payloadFor = (r: ReturnType<typeof h.rng>) => {
      const items: any[] = [];
      const n = r.chance(0.05) ? 0 : 1 + r.int(4);
      for (let i = 0; i < n; i++) {
        const [sku, category] = r.pick(skus);
        items.push({
          sku,
          name: `Item ${i}`,
          quantity: r.pick([1, 1, 2, 3, 5, 6, 16, 0, -1, 100]),
          unitPrice: r.pick([5, 20, 49.99, 99.99, 150, 400, 1500]),
          weightKg: r.pick([0.1, 0.5, 1, 2, 5, 8, 25]),
          ...(r.chance(0.4) ? { lengthCm: r.pick([10, 60, 120]), widthCm: r.pick([10, 50]), heightCm: r.pick([5, 40, 0]) } : {}),
          category,
          isTaxExempt: r.pick([undefined, undefined, true, false]),
          maxAllowedPerOrder: r.pick([undefined, undefined, 2, 10]),
        });
      }
      const address = () => ({ street: '1 Main St', city: 'Town', state: r.pick(states), country: r.pick(countries), zipCode: r.pick(['10001', '10001', '94105']), isRemoteArea: r.pick([undefined, false, true]) });
      const shippingAddress = address();
      const billingAddress = r.chance(0.6) ? { ...shippingAddress } : address();
      const coupons: any[] = [];
      const c = r.pick([0, 0, 1, 1, 2, 3]);
      for (let i = 0; i < c; i++) coupons.push(r.pick(couponPool));
      return {
        items,
        customer: {
          id: 'cust-1',
          email: r.pick(['ana@example.com', 'ana@example.com', 'bot@TempMail.com', 'x@mailinator.com', 'no-at-sign']),
          ipAddress: '198.51.100.9',
          isVpn: r.pick([undefined, false, true]),
          recentOrderCount5Min: r.pick([undefined, 1, 3, 4, 9]),
          taxExemptId: r.pick([undefined, undefined, '', '  ', 'EXEMPT-77']),
          baseRiskScore: r.pick([undefined, 0, 10, 24, 25, 49, 50, 79, 80]),
        },
        billingAddress,
        shippingAddress,
        coupons: r.chance(0.1) ? undefined : coupons,
        shippingMethod: r.pick(['standard', 'standard', 'express', 'overnight', 'drone']),
        currency: 'USD',
      };
    };
    const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

    const cases: { label: string; run: (mod: any) => unknown }[] = [];

    for (let i = 0; i < 2500; i++) {
      const payload = payloadFor(h.rng(13000 + i));
      cases.push({
        label: `stateless/${i}`,
        run: (mod) => {
          const c = new mod.CheckoutController();
          return {
            validate: h.step(() => c.validateCheckout(clone(payload))),
            fraud: h.step(() => c.standaloneFraudCheck(clone(payload))),
            taxShipping: h.step(() => c.calculateTaxAndShippingOnly(clone(payload))),
            coupons: h.step(() => c.applyCoupons({ coupons: clone(payload.coupons), items: clone(payload.items) })),
          };
        },
      });
    }

    for (let i = 0; i < 900; i++) {
      const r = h.rng(13900 + i);
      const ops: any[] = [];
      const length = 2 + r.int(8);
      for (let k = 0; k < length; k++) {
        const kind = r.pick(['process', 'process', 'process', 'inventory', 'inventory', 'refund', 'validate']);
        if (kind === 'process') ops.push({ kind, key: r.pick(['key-1', 'key-1', 'key-2', 'key-3', '', undefined]), payload: payloadFor(r) });
        else if (kind === 'inventory') ops.push({ kind, sku: r.pick(skus)[0], quantity: r.pick([undefined, '1', '2', '3', '15', '16', '999', 'abc', '0']) });
        else if (kind === 'refund') {
          ops.push({
            kind,
            payload: {
              orderId: 'ORD-1',
              itemsToRefund: r.pick([[], [{ sku: 'SKU-PHYSICAL-1', quantity: 2 }], [{ sku: 'SKU-OUT-OF-STOCK', quantity: 5 }, { sku: 'SKU-GHOST', quantity: 1 }]]),
              reason: r.pick(['damaged', 'defective', 'buyer_remorse', 'buyer_remorse', 'fraud_chargeback', 'other']),
              isReturnedToInventory: r.chance(0.6),
              customerRiskRating: r.pick([undefined, 0, 50, 51, 90]),
            },
          });
        } else ops.push({ kind, payload: payloadFor(r) });
      }
      cases.push({
        label: `stateful/${i}`,
        run: (mod) => {
          const c = new mod.CheckoutController();
          return ops.map((op: any) => {
            if (op.kind === 'process') return h.step(() => c.processCheckout(clone(op.payload), op.key));
            if (op.kind === 'inventory') return h.step(() => c.checkInventorySku(op.sku, op.quantity));
            if (op.kind === 'refund') return h.step(() => c.processRefund(clone(op.payload)));
            return h.step(() => c.validateCheckout(clone(op.payload)));
          });
        },
      });
    }
    return cases;
  },
  { freshModule: true },
);
