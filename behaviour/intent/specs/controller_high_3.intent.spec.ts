/**
 * controller_high_3 — e-commerce checkout controller.
 * Prompt: "an e-commerce checkout (tax, shipping, multiple coupons, inventory, fraud checks) ...
 * Implement every rule and edge case fully and explicitly".
 *
 * Divergence under study: the discount is now `discountType === 'percent' ? ... : value`, so a
 * type outside 'percent' | 'fixed' is treated as fixed. The original if/else-if gave 0.
 * CouponDto is a TypeScript interface (no class-validator), so nothing rejects the value at
 * run time: it is reachable through the HTTP body.
 */
import { load, freezeClock } from '../load';

const mod = load('controller_high_3');
freezeClock();

const items = () => [{ sku: 'SKU-PHYSICAL-1', name: 'Mug', quantity: 2, unitPrice: 50, weightKg: 1, category: 'physical' }];
const coupon = (o: Record<string, unknown>) => ({ code: 'C1', discountType: 'percent', value: 10, canStack: true, expiresAt: '2027-01-01T00:00:00.000Z', ...o });
const apply = (coupons: unknown[]) => new mod.CheckoutController().applyCoupons({ coupons, items: items() });

describe('controller_high_3', () => {
  test('[ANCHOR] (domain) a 10% coupon on a 100 subtotal gives 10 off', () => {
    const r = apply([coupon({})]);
    expect(r.totalDiscount).toBe(10);
    expect(r.discountedSubtotal).toBe(90);
  });

  test('[ANCHOR] (domain) a fixed coupon of 15 gives 15 off', () => {
    expect(apply([coupon({ discountType: 'fixed', value: 15 })]).totalDiscount).toBe(15);
  });

  test('[ANCHOR] (domain) an expired coupon is not applied and is reported', () => {
    const r = apply([coupon({ expiresAt: '2025-01-01T00:00:00.000Z' })]);
    expect(r.totalDiscount).toBe(0);
    expect(r.couponErrors.length).toBeGreaterThan(0);
  });

  test('[TARGET] (contract: discountType is "percent" | "fixed") a coupon of an undeclared type grants no discount', () => {
    expect(apply([coupon({ discountType: 'bogus', value: 15 })]).totalDiscount).toBe(0);
  });

  test('[IDEAL] (prompt: every edge case explicit) a coupon of an undeclared type is reported as an error, not listed as applied', () => {
    const r = apply([coupon({ discountType: 'bogus', value: 15 })]);
    expect(r.appliedCoupons).not.toContain('C1');
    expect(r.couponErrors.length).toBeGreaterThan(0);
  });
});
