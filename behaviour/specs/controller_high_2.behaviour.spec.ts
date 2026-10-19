import { defineSubject } from '../harness';

defineSubject('controller_high_2', (h) => {
  const mark = (type: string, monthsAgo: number) => ({ type, monthsAgo });
  const col = (type: string, estimatedValue: number, encumbranceAmount = 0) => ({ id: `${type}-${estimatedValue}`, type, estimatedValue, encumbranceAmount });

  const baseApp = () => ({
    applicantId: 'app-1',
    requestedAmount: 20000,
    termMonths: 60,
    creditScore: 700,
    monthlyIncome: 6000,
    monthlyDebt: 1500,
    employmentType: 'FULL_TIME',
    yearsEmployed: 6,
    state: 'TX',
    industrySector: 'RETAIL',
    collateral: [] as unknown[],
    derogatoryMarks: [] as unknown[],
  });
  const appPools = {
    requestedAmount: [0, -5, 1000, 25000, 25001, 50000, 50001, 60000, 600000],
    creditScore: [299, 300, 500, 579, 580, 669, 670, 719, 720, 739, 740, 799, 800, 850, 851],
    monthlyIncome: [0, 2000, 4000, 20000, -100],
    monthlyDebt: [0, 2100, 2101, 2400, 2580, 2581, 3300, 3301, 5000],
    employmentType: ['PART_TIME', 'SELF_EMPLOYED', 'UNEMPLOYED', 'CONTRACTOR'],
    yearsEmployed: [0, 0.5, 1, 1.9, 2, 4.9, 5],
    state: ['NV', 'fl', 'CA', 'ny', '', undefined],
    industrySector: ['TECH', '', undefined],
    collateral: [
      [col('CASH', 50000)],
      [col('CASH', 30000)],
      [col('CASH', 2000000)],
      [col('CRYPTO', 80000)],
      [col('CRYPTO', 60000), col('CASH', 20000)],
      [col('CRYPTO', 20000), col('CASH', 20000)],
      [col('REAL_ESTATE', 300000, 350000)],
      [col('REAL_ESTATE', 300000, 270000), col('VEHICLE', 15000, 2000)],
      [col('EQUITY', 22000)],
      [col('ARTWORK', 40000)],
      [col('VEHICLE', 18000)],
      null,
    ],
    derogatoryMarks: [
      [mark('BANKRUPTCY', 12)],
      [mark('BANKRUPTCY', 24)],
      [mark('BANKRUPTCY', 25)],
      [mark('BANKRUPTCY', 60)],
      [mark('BANKRUPTCY', 61)],
      [mark('FORECLOSURE', 36)],
      [mark('FORECLOSURE', 37)],
      [mark('90_DAY_LATE', 3), mark('90_DAY_LATE', 12), mark('90_DAY_LATE', 1)],
      [mark('90_DAY_LATE', 12), mark('90_DAY_LATE', 13), mark('90_DAY_LATE', 24), mark('90_DAY_LATE', 25)],
      [mark('60_DAY_LATE', 12), mark('60_DAY_LATE', 13)],
      [mark('30_DAY_LATE', 6), mark('30_DAY_LATE', 7)],
      [mark('FORECLOSURE', 10), mark('90_DAY_LATE', 2), mark('60_DAY_LATE', 2), mark('30_DAY_LATE', 2), mark('BANKRUPTCY', 40)],
      [mark('UNKNOWN', 1)],
      null,
    ],
    coSigner: [
      { creditScore: 720, monthlyIncome: 3000, monthlyDebt: 500, yearsEmployed: 5 },
      { creditScore: 719, monthlyIncome: 3000, monthlyDebt: 2500, yearsEmployed: 5 },
      { creditScore: 780, monthlyIncome: 0, monthlyDebt: 0, yearsEmployed: 1 },
      { creditScore: 850, monthlyIncome: 30000, monthlyDebt: 100, yearsEmployed: 20 },
      { creditScore: 779, monthlyIncome: 1000, monthlyDebt: 0, yearsEmployed: 2 },
    ],
    promotionalCode: ['SUPERPROMO2025', 'superpromo2025', 'OTHER'],
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  const ctrl = (mod: any) => new mod.LoanApprovalController();

  for (const { label, input } of h.variants(baseApp, appPools, { random: 2500, maxK: 8, seed: 61 })) {
    cases.push({ label: `evaluate/${label}`, run: (mod) => ctrl(mod).evaluateLoan(input) });
  }
  for (const [i, body] of [null, undefined, {}, { requestedAmount: 100 }].entries()) {
    cases.push({ label: `evaluate/malformed-${i}`, run: (mod) => ctrl(mod).evaluateLoan(body) });
  }

  for (let i = 0; i < 400; i++) {
    const r = h.rng(6100 + i);
    const applications = [];
    const n = r.int(7);
    for (let k = 0; k < n; k++) {
      const app: any = h.mutated(baseApp, appPools, r, 4);
      app.applicantId = `app-${k}`;
      if (r.chance(0.5)) {
        // Large, well-secured loans: the only way to push a sector past the 1M exposure line.
        Object.assign(app, { requestedAmount: 600000, creditScore: 810, monthlyIncome: 50000, monthlyDebt: 1000, collateral: [col('CASH', 2000000)], derogatoryMarks: [], employmentType: 'FULL_TIME' });
        if (r.chance(0.7)) app.industrySector = 'TECH';
      }
      applications.push(app);
    }
    cases.push({ label: `batch/${i}`, run: (mod) => ctrl(mod).evaluateBatch({ batchId: `b-${i}`, applications }) });
  }
  for (const [i, body] of [null, {}, { applications: 'nope' }, { batchId: 'b', applications: [] }, { batchId: 'b', applications: [{ requestedAmount: 0 }] }].entries()) {
    cases.push({ label: `batch/malformed-${i}`, run: (mod) => ctrl(mod).evaluateBatch(body) });
  }

  const updatePools = {
    updatedIncome: [0, 1000, 15000],
    updatedDebt: [0, 4000],
    updatedCreditScore: [300, 640, 810, 900],
    additionalCollateral: [[col('CASH', 40000)], [col('CRYPTO', 90000)], 'not-an-array', []],
  };
  for (let i = 0; i < 500; i++) {
    const r = h.rng(6600 + i);
    const body: any = { ...(h.mutated(baseApp, appPools, r, 4) as any), ...(h.mutated(() => ({}), updatePools, r, 4) as any) };
    const id = r.chance(0.1) ? '' : `loan-${i}`;
    cases.push({ label: `re-evaluate/${i}`, run: (mod) => ctrl(mod).reEvaluateLoan(id, body) });
  }

  for (const { label, input } of h.grid(() => ({} as Record<string, unknown>), {
    inflationRate: [h.DEL, '', '2.5', 'abc'],
    primeRate: [h.DEL, '7', '0', 'x'],
    marketStressIndex: [h.DEL, '1.5', '1.51', '2.5', '2.51', 'bad', '0'],
  })) {
    cases.push({ label: `risk-matrix/${label}`, run: (mod) => ctrl(mod).getRiskMatrix(input) });
  }

  const baseOverride = () => ({
    id: 'loan-9',
    body: { executiveId: 'exec-1', overrideCode: 'EXEC_OVERRIDE_LEVEL_3', justification: 'Long-standing client with assets', maxApprovedAmount: 15000 } as any,
  });
  for (const { label, input } of h.variants(
    baseOverride,
    {
      id: ['', undefined],
      body: [null, undefined, {}],
      'body.executiveId': ['', h.DEL],
      'body.overrideCode': ['EXEC_OVERRIDE_LEVEL_2', '', h.DEL],
      'body.justification': ['too short', '12345678901234567890', '1234567890123456789', '', h.DEL],
      'body.maxApprovedAmount': [0, h.DEL, 25000, 25001, 9999, -5],
    },
    { random: 200, seed: 62 },
  )) {
    cases.push({ label: `override/${label}`, run: (mod) => ctrl(mod).overrideRejection(input.id, input.body) });
  }

  return cases;
});
