import { defineSubject } from '../harness';

defineSubject('dto_high_2', (h) => {
  const tier = (tierNumber: number, minKwh: unknown, maxKwh: unknown, ratePerKwh = 0.1 * tierNumber) => ({ tierNumber, minKwh, maxKwh, ratePerKwh });
  const tierSets: unknown[] = [
    undefined,
    [],
    [tier(1, 0, null)],
    [tier(1, 0, 100), tier(2, 100, 500), tier(3, 500, null)],
    [tier(3, 500, undefined), tier(1, 0, 100), tier(2, 100, 500)],
    [tier(1, 0, 100), tier(2, 100, 400)],
    [tier(1, 10, 100)],
    [tier(1, 0, 100), tier(2, 150, null)],
    [tier(1, 0, 100), tier(2, 100, 50)],
    [tier(1, 0, undefined), tier(2, 100, null)],
    [tier(1, 0, '100'), tier(2, 100, null)],
    [tier(1, 0, 100), tier(2, '100', null)],
    [tier(1, undefined, 100), tier(2, 100, null)],
    [tier(1, 0, 0)],
    [tier(1, -5, null)],
    'not-an-array',
  ];
  const tou = (name: string, windows: [string, string][], days: unknown = ['WEEKDAY', 'WEEKEND', 'HOLIDAY'], seasons: unknown = ['SUMMER', 'WINTER', 'SHOULDER'], ratePerKwh = 0.2, rateType = 'PEAK') => ({
    name, rateType, ratePerKwh, timeWindows: windows.map(([startTime, endTime]) => ({ startTime, endTime })), applicableDays: days, applicableSeasons: seasons,
  });
  const touSets: unknown[] = [
    undefined,
    [],
    [tou('Peak', [['17:00', '21:00']]), tou('Off', [['21:00', '17:00']], undefined, undefined, 0.08, 'OFF_PEAK')],
    [tou('Peak', [['17:00', '21:00']]), tou('Overlap', [['20:00', '23:00']])],
    [tou('Night', [['22:00', '06:00']]), tou('Early', [['05:00', '09:00']])],
    [tou('WeekdayPeak', [['08:00', '20:00']], ['WEEKDAY']), tou('WeekendAll', [['08:00', '20:00']], ['WEEKEND'], undefined, 0.05, 'OFF_PEAK')],
    [tou('Summer', [['12:00', '18:00']], undefined, ['SUMMER'], 0.4, 'CRITICAL_PEAK'), tou('Winter', [['12:00', '18:00']], undefined, ['WINTER'], 0.15, 'SHOULDER')],
    [tou('Same', [['10:00', '10:00']])],
    [tou('Two', [['00:00', '06:00'], ['06:00', '12:00']]), tou('Rest', [['12:00', '00:00']])],
    [tou('NoWindows', [], undefined, undefined), tou('Bad', [['', '']])],
    [{ name: 'Broken', rateType: 'PEAK', ratePerKwh: 0.1, timeWindows: 'x', applicableDays: 'WEEKDAY', applicableSeasons: null }],
    [tou('Fmt', [['7:5', '25:99']], ['FUNDAY'], ['MONSOON'], -1, 'NOPE')],
    'not-an-array',
  ];
  const surchargePool = [
    { name: 'Grid fee', surchargeType: 'FIXED_MONTHLY', value: 12 },
    { name: 'Per kWh levy', surchargeType: 'PER_KWH', value: 0.01 },
    { name: 'City %', surchargeType: 'PERCENTAGE', value: 5 },
    { name: 'Peak demand', surchargeType: 'PEAK_DEMAND', value: 2, applicableCustomerTypes: ['COMMERCIAL', 'INDUSTRIAL'] },
    { name: 'Green', surchargeType: 'RENEWABLE_ENERGY', value: 0.004, minUsageThresholdKwh: 300 },
    { name: 'Resi only', surchargeType: 'FIXED_MONTHLY', value: 3, applicableCustomerTypes: ['RESIDENTIAL'] },
    { name: 'Empty types', surchargeType: 'FIXED_MONTHLY', value: 1, applicableCustomerTypes: [] },
    { name: 'Unknown', surchargeType: 'MYSTERY', value: 9 },
  ];
  const rebatePool = [
    { name: 'Solar', rebateType: 'SOLAR_FEED_IN', value: 0.05 },
    { name: 'Solar capped', rebateType: 'SOLAR_FEED_IN', value: 0.5, capAmount: 20, minGenerationKwh: 200 },
    { name: 'Low income', rebateType: 'LOW_INCOME', value: 25 },
    { name: 'EV', rebateType: 'EV_INCENTIVE', value: 15, capAmount: 10 },
    { name: 'Efficient', rebateType: 'HIGH_EFFICIENCY_EQUIPMENT', value: 1000 },
  ];
  const timestamps = [
    '2026-01-15T18:00:00.000Z', '2026-01-17T10:30:00.000Z', '2026-07-08T19:59:00.000Z', '2026-07-12T03:00:00.000Z', '2026-04-22T12:00:00.000Z',
    '2026-12-25T23:30:00.000Z', '2026-06-01T00:00:00.000Z', '2026-09-30T21:00:00.000Z', '2026-02-28T05:30:00.000Z', '2026-08-31T17:00:00.000Z',
  ];

  const cases: { label: string; run: (mod: any) => unknown }[] = [];

  // 1. The billing engine.
  for (let i = 0; i < 7000; i++) {
    const r = h.rng(15000 + i);
    const readings = [];
    const n = 1 + r.int(6);
    for (let k = 0; k < n; k++) readings.push({ timestamp: r.pick(timestamps), kwhConsumption: r.pick([0, 12.5, 80, 150, 420, 1000]), kwPeakDemand: r.pick([0, 3.2, 9, 25, 140]) });
    const pickSome = <T,>(pool: T[]) => (r.chance(0.15) ? undefined : pool.filter(() => r.chance(0.3)));
    const request = {
      tariffId: 'T-1',
      customerProfile: {
        type: r.pick(['RESIDENTIAL', 'RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'AGRICULTURAL']),
        voltageLevel: 'LOW',
        isLowIncome: r.chance(0.3),
        hasSolar: r.chance(0.4),
        solarCapacityKw: 5,
        phaseCount: 1,
        contractDemandKw: 10,
      },
      meterType: r.pick(['SINGLE_RATE', 'SINGLE_RATE', 'DUAL_RATE', 'SMART_TIME_OF_USE', 'PREPAID']),
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      tiers: r.pick(tierSets.slice(0, 6)),
      touRates: r.pick(touSets.slice(0, 9)),
      demandCharge: r.pick([undefined, undefined, { ratePerKw: 8, thresholdKw: 5, peakOnly: true, minBilledDemandKw: 0 }, { ratePerKw: 8, thresholdKw: 500, peakOnly: false, minBilledDemandKw: 2 }, { ratePerKw: 3, thresholdKw: 1000, peakOnly: false, minBilledDemandKw: 0 }]),
      surcharges: pickSome(surchargePool),
      rebates: pickSome(rebatePool),
      intervalReadings: readings,
      taxRatePercent: r.pick([0, 6, 23]),
    };
    cases.push({ label: `engine/${i}`, run: (mod) => new mod.EnergyTariffEngine().calculateBill(JSON.parse(JSON.stringify(request))) });
  }

  // 2. The request DTO.
  const basePlain = () => ({
    tariffId: 'T-1',
    customerProfile: { type: 'RESIDENTIAL', voltageLevel: 'LOW', isLowIncome: false, hasSolar: true, solarCapacityKw: 5, phaseCount: 1, contractDemandKw: 10 } as any,
    meterType: 'SINGLE_RATE',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    tiers: tierSets[3],
    touRates: touSets[2],
    demandCharge: { ratePerKw: 8, thresholdKw: 5, peakOnly: true, minBilledDemandKw: 0 } as any,
    surcharges: surchargePool.slice(0, 3) as any,
    rebates: rebatePool.slice(0, 2) as any,
    intervalReadings: [{ timestamp: timestamps[0], kwhConsumption: 120, kwPeakDemand: 4 }] as any,
    taxRatePercent: 23,
  });
  for (const { label, input } of h.variants(
    basePlain,
    {
      tariffId: [7, h.DEL],
      customerProfile: [undefined, null, {}],
      'customerProfile.type': ['HOSPITAL'],
      'customerProfile.phaseCount': [0, '3'],
      'customerProfile.hasSolar': ['yes'],
      meterType: ['DUAL_RATE', 'ANALOG'],
      effectiveFrom: ['2027-01-01', 'garbage', h.DEL],
      effectiveTo: ['2026-01-01', '2025-06-01', 'garbage', '', h.DEL],
      tiers: tierSets,
      touRates: touSets,
      demandCharge: [undefined, { ratePerKw: -1, thresholdKw: 'x', peakOnly: 'no' }, 'x'],
      surcharges: [undefined, [], surchargePool, 'x', [{ name: 5, surchargeType: 'X', value: -1, minUsageThresholdKwh: -2, applicableCustomerTypes: ['MARS'] }]],
      rebates: [undefined, [], rebatePool, [{ name: null, rebateType: 'X', value: -1, capAmount: -1, minGenerationKwh: 'a' }]],
      intervalReadings: [[], undefined, [{ timestamp: 'nope', kwhConsumption: -1, kwPeakDemand: 'x' }], 'x'],
      taxRatePercent: [-1, 100, 101, '23', h.DEL],
    },
    { random: 2500, maxK: 6, seed: 151 },
  )) {
    cases.push({ label: `dto/${label}`, run: (mod) => h.validateDto(mod.TariffCalculationRequestDto, input) });
  }
  for (const cls of ['TimeWindowDto', 'TouRateDto', 'ConsumptionTierDto', 'DemandChargeConfigDto', 'SurchargeConfigDto', 'RebateConfigDto', 'IntervalReadingDto', 'CustomerProfileDto']) {
    cases.push({ label: `nested/${cls}/empty`, run: (mod) => h.validateDto(mod[cls], {}) });
  }

  // 3. The custom constraints, called directly.
  const args = (object: unknown) => ({ object, constraints: [], property: 'p', value: undefined, targetName: 'TariffCalculationRequestDto' });
  tierSets.forEach((tiers, i) =>
    cases.push({ label: `continuous-tiers/${i}`, run: (mod) => { const c = new mod.IsContinuousTiersConstraint(); return { valid: c.validate(tiers, args({})), message: c.defaultMessage(args({})) }; } }),
  );
  touSets.forEach((rates, i) =>
    cases.push({ label: `tou-windows/${i}`, run: (mod) => { const c = new mod.IsNonOverlappingTouWindowsConstraint(); return { valid: c.validate(rates, args({})), message: c.defaultMessage(args({})) }; } }),
  );
  const dates = ['2026-01-01', '2026-12-31', '2026-01-01T00:00:00.001Z', '', undefined, null, 'garbage'];
  dates.forEach((from, i) =>
    dates.forEach((to, j) =>
      cases.push({ label: `effective-dates/${i}-${j}`, run: (mod) => { const c = new mod.IsValidTariffEffectiveDatesConstraint(); return { valid: c.validate(to, args({ effectiveFrom: from })), message: c.defaultMessage(args({})) }; } }),
    ),
  );
  // The exported decorator factories themselves.
  cases.push({ label: 'decorator-factories', run: (mod) => ({ tiers: typeof mod.IsContinuousTiers(), tou: typeof mod.IsNonOverlappingTouWindows({ message: 'm' }) }) });
  return cases;
});
