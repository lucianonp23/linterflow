/**
 * dto_high_2 — energy tariff calculator DTOs and billing engine.
 * Prompt: "an energy tariff calculator (time-of-use, tiers, surcharges, rebates) ... Implement
 * every rule and edge case fully and explicitly".
 *
 * Divergence under study: surcharges are now computed by SURCHARGE_STRATEGIES[type]; for a
 * type outside the SurchargeType enum the lookup is undefined and the engine throws a
 * TypeError. The original switch had no default, so the surcharge produced a 0 line.
 * Note: SurchargeConfigDto declares @IsEnum(SurchargeType), so through a ValidationPipe the
 * unknown type never reaches the engine.
 */
import { validateDto } from '../../harness';
import { load, freezeClock, thrown } from '../load';

const mod = load('dto_high_2');
freezeClock();

const request = (surcharges: unknown[]) => ({
  tariffId: 'T-1',
  customerProfile: { type: 'RESIDENTIAL', voltageLevel: 'LOW', isLowIncome: false, hasSolar: false, solarCapacityKw: 0, phaseCount: 1, contractDemandKw: 10 },
  meterType: 'SINGLE_RATE',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  tiers: [
    { tierNumber: 1, minKwh: 0, maxKwh: 100, ratePerKwh: 0.1 },
    { tierNumber: 2, minKwh: 100, maxKwh: 500, ratePerKwh: 0.2 },
    { tierNumber: 3, minKwh: 500, maxKwh: null, ratePerKwh: 0.3 },
  ],
  surcharges,
  rebates: [],
  intervalReadings: [{ timestamp: '2026-01-15T18:00:00.000Z', kwhConsumption: 80, kwPeakDemand: 3.2 }],
  taxRatePercent: 0,
});
const bill = (surcharges: unknown[]) => new mod.EnergyTariffEngine().calculateBill(JSON.parse(JSON.stringify(request(surcharges))));
const GRID_FEE = { name: 'Grid fee', surchargeType: 'FIXED_MONTHLY', value: 12 };
const UNKNOWN = { name: 'Unknown', surchargeType: 'MYSTERY', value: 9 };
const surchargeErrors = (plain: unknown) => (validateDto(mod.SurchargeConfigDto, plain) as any).errors.filter((e: any) => e.property === 'surchargeType');

describe('dto_high_2', () => {
  test('[ANCHOR] (contract: @IsEnum) DTO validation rejects a surcharge type outside SurchargeType', () => {
    expect(surchargeErrors(UNKNOWN).length).toBeGreaterThan(0);
  });

  test('[ANCHOR] (contract: @IsEnum) DTO validation accepts a declared surcharge type', () => {
    expect(surchargeErrors(GRID_FEE)).toEqual([]);
  });

  test('[ANCHOR] (domain) a fixed monthly surcharge of 12 adds exactly 12 to the bill', () => {
    const without = bill([]);
    const withFee = bill([GRID_FEE]);
    expect(withFee.subtotalSurcharges - without.subtotalSurcharges).toBeCloseTo(12, 6);
  });

  test('[TARGET] (prompt: every edge case explicit) the engine does not crash with an engine TypeError on an unknown surcharge type', () => {
    const e = thrown(() => bill([GRID_FEE, UNKNOWN]));
    expect(e?.constructor?.name).not.toBe('TypeError');
  });

  test('[TARGET] (domain) an unknown surcharge type adds no charge to the bill', () => {
    const e = thrown(() => bill([GRID_FEE, UNKNOWN]));
    expect(e).toBeUndefined();
    expect(bill([GRID_FEE, UNKNOWN]).totalBillAmount).toBeCloseTo(bill([GRID_FEE]).totalBillAmount, 6);
  });
});
