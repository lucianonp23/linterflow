import { defineSubject } from '../harness';

defineSubject('controller_high_4', (h) => {
  const shift = (hoursWorked: number, o: Record<string, unknown> = {}) => ({ date: '2026-01-05', hoursWorked, ...o });
  const shiftSets = [
    undefined,
    [],
    [8, 8, 8, 8, 8].map((x) => shift(x)),
    [8, 8, 8, 8, 8, 8, 9].map((x) => shift(x)),
    [8, 8, 8, 8, 8, 8, 6].map((x) => shift(x)),
    [13, 10, 8, 4, 12.5].map((x) => shift(x)),
    [10, 10, 10, 10, 10, 5].map((x) => shift(x)),
    [8, 8, 0, 8, 8, 8, 8, 8, 8, 8].map((x) => shift(x)),
    [shift(8, { isHoliday: true }), shift(10, { isNightShift: true }), shift(6, { isOnCall: true }), shift(14, { isNightShift: true, isOnCall: true })],
    [shift(12, { isHoliday: true, isNightShift: true }), shift(8), shift(8), shift(8), shift(8), shift(9)],
    [shift(40), shift(1), shift(2)],
    [shift(39), shift(2), shift(-1)],
  ];
  const base = () => ({
    employeeId: 'E-1' as unknown,
    age: 35,
    employmentType: 'FULL_TIME',
    isExempt: false,
    payFrequency: 'BIWEEKLY',
    hourlyRate: 40 as unknown,
    annualSalary: undefined as unknown,
    filingStatus: 'SINGLE',
    state: 'TX',
    dependentsCount: 0,
    dailyShifts: undefined as unknown,
    regularHours: 80 as unknown,
    overtimeHours: 0 as unknown,
    doubleTimeHours: 0,
    holidayHours: 0,
    nightShiftHours: 0,
    onCallHours: 0,
    ytdGrossPay: 20000,
    ytdSocialSecurityTax: 1240,
    ytdMedicareTax: 290,
    ytd401kContribution: 0,
    ytdHsaContribution: 0,
    percent401k: 0,
    flatRoth401k: 0,
    hsaContribution: 0,
    healthInsurancePremium: 120,
    dentalInsurancePremium: 15,
    visionInsurancePremium: 5,
    fsaContribution: 0,
    isUnionMember: false,
  });
  const pools = {
    employeeId: ['', h.DEL],
    age: [13, 14, 49, 50, 100, 101],
    employmentType: ['PART_TIME', 'CONTRACTOR', 'INTERN'],
    isExempt: [true],
    payFrequency: ['WEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'DAILY'],
    hourlyRate: [0, 7.25, 15, 95, 400, h.DEL],
    annualSalary: [0, 30000, 52000, 98000, 150000, 240000, 420000, 900000, 3000000, 9000000],
    filingStatus: ['MARRIED_JOINT', 'MARRIED_SEPARATE', 'HEAD_OF_HOUSEHOLD'],
    state: ['CA', 'NY', 'FL', 'WA', 'IL', 'PA'],
    dependentsCount: [1, 3, 8],
    dailyShifts: shiftSets.slice(1),
    regularHours: [0, 20, 40, 86.5, h.DEL],
    overtimeHours: [5, 30],
    doubleTimeHours: [4],
    holidayHours: [8],
    nightShiftHours: [16],
    onCallHours: [24],
    ytdGrossPay: [0, 5000, 6900, 6999, 8900, 12000, 12200, 150000, 153000, 160000, 160200, 199000, 249000, 300000],
    ytd401kContribution: [22000, 22500, 29500, 30000, 40000],
    ytdHsaContribution: [3800, 3850, 7700, 9000],
    percent401k: [1, 3, 4, 5, 6, 15, 100],
    flatRoth401k: [100, 5000, 50000],
    hsaContribution: [50, 500, 10000],
    healthInsurancePremium: [0, 900, 5000],
    dentalInsurancePremium: [0, 60],
    visionInsurancePremium: [0, 25],
    fsaContribution: [50, 117.3, 117.31, 500, 5000],
    isUnionMember: [true],
    garnishmentType: ['CHILD_SUPPORT', 'CREDITOR_GARNISHMENT', 'FEDERAL_TAX_LEVY', 'OTHER'],
    garnishmentAmount: [0, 50, 400, 1500, 100000],
    hasOtherDependentsForGarnishment: [true],
    hasRelocationBonus: [true],
    relocationBonusAmount: [0, 5000, 250000],
    gymStipend: [50],
    cellPhoneStipend: [75],
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  for (const { label, input } of h.variants(base, pools, { random: 9000, maxK: 9, seed: 141 })) {
    cases.push({ label: `calculate/${label}`, run: (mod) => new mod.PayrollController().calculatePaystub(input) });
  }
  // Garnishments only matter in combination with pay level and frequency.
  for (const { label, input } of h.grid(base, {
    garnishmentType: ['CHILD_SUPPORT', 'CREDITOR_GARNISHMENT', 'FEDERAL_TAX_LEVY'],
    garnishmentAmount: [50, 800, 100000],
    hourlyRate: [7.25, 40, 400],
    payFrequency: ['WEEKLY', 'MONTHLY'],
    dependentsCount: [0, 3],
    hasOtherDependentsForGarnishment: [true, false],
  }, 'garnish')) {
    cases.push({ label: `calculate/${label}`, run: (mod) => new mod.PayrollController().calculatePaystub(input) });
  }
  for (const { label, input } of h.grid(base, {
    state: ['CA', 'NY', 'TX', 'IL'],
    annualSalary: [9000, 15000, 30000, 45000, 58000, 72000, 110000, 200000, 360000, 450000, 800000, 1500000, 6000000],
    filingStatus: ['SINGLE', 'MARRIED_JOINT'],
  }, 'brackets')) {
    cases.push({ label: `calculate/${label}`, run: (mod) => new mod.PayrollController().calculatePaystub(input) });
  }

  for (const region of ['federal', 'FEDERAL', 'ca', 'NY', 'tx', 'FL', 'wa', 'IL', 'zz', '']) {
    cases.push({ label: `tax-brackets/${region || 'empty'}`, run: (mod) => new mod.PayrollController().getTaxBrackets(region) });
  }
  cases.push({ label: 'tax-brackets/undefined', run: (mod) => new mod.PayrollController().getTaxBrackets(undefined) });

  for (let i = 0; i < 800; i++) {
    const r = h.rng(14000 + i);
    const ops: any[] = [];
    const length = 1 + r.int(7);
    for (let k = 0; k < length; k++) {
      const kind = r.pick(['batch', 'batch', 'batch', 'adjust', 'adjust', 'delete', 'delete']);
      if (kind === 'batch') {
        const employees: any[] = [];
        const n = r.int(5);
        for (let e = 0; e < n; e++) employees.push({ ...(h.mutated(base, pools, r, 5) as any) });
        ops.push({ kind, dto: { batchId: r.pick(['B-1', 'B-1', 'B-2']), payPeriodStart: '2026-01-01', payPeriodEnd: '2026-01-14', employees: r.chance(0.05) ? undefined : employees } });
      } else if (kind === 'adjust') {
        ops.push({ kind, employeeId: r.pick(['E-1', 'E-1', 'E-2', '']), dto: { adjustmentId: `A-${k}`, employeeId: 'ignored', manualGrossBonus: r.pick([undefined, 500]), discretionaryDeduction: r.pick([undefined, 20]), taxExemptionOverride: r.pick([undefined, true]), notes: 'n' } });
      } else ops.push({ kind, draftId: r.pick(['B-1', 'B-2', 'B-9']) });
    }
    cases.push({
      label: `stateful/${i}`,
      run: (mod) => {
        const c = new mod.PayrollController();
        return ops.map((op: any) => {
          if (op.kind === 'batch') return h.step(() => c.batchCalculate(JSON.parse(JSON.stringify(op.dto))));
          if (op.kind === 'adjust') return h.step(() => c.applyAdjustment(op.employeeId, { ...op.dto }));
          return h.step(() => c.deleteDraft(op.draftId));
        });
      },
    });
  }
  return cases;
});
