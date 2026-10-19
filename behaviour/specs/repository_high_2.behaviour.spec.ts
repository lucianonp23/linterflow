import { defineSubject } from '../harness';

defineSubject('repository_high_2', (h) => {
  const base = () => ({
    applicantId: 'AP-1',
    applicantName: 'Ana Silva',
    creditScore: 720 as unknown,
    grossMonthlyIncome: 9000 as unknown,
    additionalIncomes: undefined as unknown,
    monthlyDebts: 600,
    detailedLiabilities: undefined as unknown,
    loanAmount: 300000 as unknown,
    propertyValue: 400000 as unknown,
    downPaymentAmount: 100000,
    loanTermYears: 30 as unknown,
    loanType: 'CONVENTIONAL',
    propertyType: 'SINGLE_FAMILY',
    occupancyType: 'PRIMARY_RESIDENCE',
    employmentStatus: 'FULL_TIME',
    employmentDurationMonths: 60,
    isFirstTimeHomebuyer: false,
    isVeteran: false,
    bankruptcyType: 'NONE' as unknown,
    hasForeclosureHistory: false,
    liquidAssets: 60000 as unknown,
  });
  const pools = {
    creditScore: [299, 300, 499, 500, 579, 580, 619, 620, 639, 640, 679, 680, 719, 739, 740, 759, 760, 850, 851, h.DEL],
    grossMonthlyIncome: [0, -1, 2500, 4000, 6000, 25000, h.DEL],
    additionalIncomes: [
      [{ type: 'rental', monthlyAmount: 1500, isGuaranteed: true, yearsReceived: 3 }],
      [{ type: 'bonus', monthlyAmount: 800, isGuaranteed: true, yearsReceived: 1 }, { type: 'gig', monthlyAmount: 400, isGuaranteed: false, yearsReceived: 5 }],
      [],
    ],
    monthlyDebts: [0, 1500, 3500],
    detailedLiabilities: [
      [{ name: 'CAR', monthlyPayment: 450, remainingMonths: 8, isRealEstateLiability: false }, { name: 'HELOC', monthlyPayment: 300, remainingMonths: 6, isRealEstateLiability: true }],
      [{ name: 'STUDENT', monthlyPayment: 900, remainingMonths: 120, isRealEstateLiability: false }, { name: 'CARD', monthlyPayment: 400, remainingMonths: 11, isRealEstateLiability: false }],
      [],
    ],
    loanAmount: [0, -5, 200000, 280000, 300001, 320000, 340000, 360000, 380000, 388000, 390000, 726200, 726201, 900000],
    propertyValue: [0, 300000, 500000, 1000000],
    downPaymentAmount: [0, 20000, 400000],
    loanTermYears: [15, 20, 0, h.DEL],
    loanType: ['FHA', 'VA', 'USDA', 'JUMBO'],
    propertyType: ['MULTI_FAMILY', 'CONDO', 'MANUFACTURED', 'COMMERCIAL', 'TINY_HOUSE'],
    occupancyType: ['SECONDARY_HOME', 'INVESTMENT_PROPERTY', 'VACATION'],
    employmentStatus: ['PART_TIME', 'SELF_EMPLOYED', 'RETIRED', 'UNEMPLOYED', 'STUDENT'],
    employmentDurationMonths: [0, 5, 6, 11, 12, 23, 24],
    isFirstTimeHomebuyer: [true],
    isVeteran: [true],
    bankruptcyType: ['CHAPTER_7', 'CHAPTER_13', h.DEL],
    monthsSinceBankruptcy: [0, 11, 12, 23, 24, 35, 36, 47, 48, 100],
    hasForeclosureHistory: [true],
    monthsSinceForeclosure: [0, 23, 24, 35, 36, 83, 84],
    liquidAssets: [0, 3000, 8000, 20000, 500000, h.DEL],
    isUsdaEligibleRuralArea: [true, false],
    monthlyHoaFee: [0, 350, -10],
    numberOfUnits: [1, 2, 4, 5],
    hasCoSigner: [true],
    coSignerCreditScore: [299, 300, 600, 700, 800, 851],
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  for (const { label, input } of h.variants(base, pools, { random: 9000, maxK: 9, seed: 191 })) {
    cases.push({ label: `create/${label}`, run: async (mod) => new mod.MortgageEligibilityRepository().create(input) });
  }
  for (const { label, input } of h.grid(base, {
    loanType: ['CONVENTIONAL', 'FHA', 'VA', 'USDA'],
    propertyType: ['SINGLE_FAMILY', 'CONDO', 'MULTI_FAMILY', 'MANUFACTURED'],
    occupancyType: ['PRIMARY_RESIDENCE', 'SECONDARY_HOME', 'INVESTMENT_PROPERTY'],
    loanAmount: [280000, 304000, 324000, 344000, 364000, 384000, 392000],
    isFirstTimeHomebuyer: [true, false],
  }, 'ltv')) {
    cases.push({ label: `create/${label}`, run: async (mod) => new mod.MortgageEligibilityRepository().create(input) });
  }
  for (const { label, input } of h.grid(base, {
    loanType: ['CONVENTIONAL', 'FHA', 'VA', 'USDA'],
    bankruptcyType: ['CHAPTER_7', 'CHAPTER_13'],
    monthsSinceBankruptcy: [10, 12, 23, 24, 35, 36, 47, 48],
    creditScore: [650, 730],
    isVeteran: [true],
    isUsdaEligibleRuralArea: [true],
  }, 'bankruptcy')) {
    cases.push({ label: `create/${label}`, run: async (mod) => new mod.MortgageEligibilityRepository().create(input) });
  }
  for (const { label, input } of h.grid(base, {
    loanType: ['CONVENTIONAL', 'VA', 'FHA'],
    grossMonthlyIncome: [4200, 4700, 5000, 5300, 5600, 6000, 7000],
    creditScore: [650, 690, 725, 745],
    liquidAssets: [5000, 14000, 20000, 80000],
    isVeteran: [true],
  }, 'dti')) {
    cases.push({ label: `create/${label}`, run: async (mod) => new mod.MortgageEligibilityRepository().create(input) });
  }

  for (let i = 0; i < 1500; i++) {
    const r = h.rng(19000 + i);
    const ops: any[] = [];
    const length = 3 + r.int(10);
    for (let k = 0; k < length; k++) {
      const kind = r.pick(['create', 'create', 'create', 'update', 'update', 'reevaluate', 'findById', 'findAll', 'findAll', 'findByApplicant', 'delete', 'advance']);
      if (kind === 'create') ops.push({ kind, dto: { ...(h.mutated(base, pools, r, 4) as any), applicantId: r.pick(['AP-1', 'AP-2']) } });
      else if (kind === 'update') ops.push({ kind, ref: r.int(4), dto: h.mutated(() => ({}), pools, r, 3) });
      else if (kind === 'findAll') {
        const filter: any = {};
        if (r.chance(0.3)) filter.applicantId = r.pick(['AP-1', 'AP-2']);
        if (r.chance(0.3)) filter.loanType = r.pick(['CONVENTIONAL', 'FHA', 'VA']);
        if (r.chance(0.3)) filter.propertyType = r.pick(['SINGLE_FAMILY', 'CONDO']);
        if (r.chance(0.3)) filter.status = r.pick(['APPROVED', 'CONDITIONAL_APPROVAL', 'MANUAL_UNDERWRITING_REQUIRED', 'DECLINED']);
        if (r.chance(0.3)) filter.minCreditScore = r.pick([0, 650, 700, 760]);
        if (r.chance(0.3)) filter.maxDti = r.pick([30, 43, 50]);
        if (r.chance(0.3)) filter.maxLtv = r.pick([70, 80, 95]);
        ops.push({ kind, filter: r.chance(0.15) ? undefined : filter });
      } else if (kind === 'findByApplicant') ops.push({ kind, applicantId: r.pick(['AP-1', 'AP-2', 'AP-9']) });
      else if (kind === 'advance') ops.push({ kind, ms: 60000 });
      else ops.push({ kind, ref: r.int(4) });
    }
    cases.push({
      label: `scenario/${i}`,
      run: async (mod) => {
        const repo = new mod.MortgageEligibilityRepository();
        const ids: string[] = [];
        const idFor = (ref: number) => (ref === 3 || ids.length === 0 ? 'app_missing' : ids[ref % ids.length]);
        const out: unknown[] = [];
        for (const op of ops) {
          if (op.kind === 'create') {
            const res: any = await h.stepAsync(() => repo.create(JSON.parse(JSON.stringify(op.dto))));
            if (res.ok?.id) ids.push(res.ok.id);
            out.push(res);
          } else if (op.kind === 'update') out.push(await h.stepAsync(() => repo.update(idFor(op.ref), JSON.parse(JSON.stringify(op.dto)))));
          else if (op.kind === 'reevaluate') out.push(await h.stepAsync(() => repo.reevaluate(idFor(op.ref))));
          else if (op.kind === 'findById') out.push(await h.stepAsync(() => repo.findById(idFor(op.ref))));
          else if (op.kind === 'findAll') out.push(await h.stepAsync(() => repo.findAll(op.filter)));
          else if (op.kind === 'findByApplicant') out.push(await h.stepAsync(() => repo.findByApplicant(op.applicantId)));
          else if (op.kind === 'delete') out.push(await h.stepAsync(() => repo.delete(idFor(op.ref))));
          else { h.advance(op.ms); out.push({ advanced: op.ms }); }
        }
        return out;
      },
    });
  }
  return cases;
});
