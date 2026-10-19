import { defineSubject } from '../harness';

defineSubject('service_high_1', (h) => {
  const statuses = ['SINGLE', 'SINGLE', 'MARRIED_FILING_JOINTLY', 'MARRIED_FILING_JOINTLY', 'MARRIED_FILING_SEPARATELY', 'HEAD_OF_HOUSEHOLD', 'QUALIFYING_SURVIVING_SPOUSE', 'OTHER'];
  const wages = [0, 0, 3000, 9000, 14000, 18500, 22000, 26000, 30000, 34000, 38000, 42000, 46000, 52000, 60000, 74000, 80000, 88000, 96000, 120000, 135000, 160000, 190000, 210000, 240000, 330000, 420000, 600000, 720000, 1300000];

  const submissionFor = (r: ReturnType<typeof h.rng>) => {
    const w2s = [];
    const w2Count = r.pick([0, 1, 1, 1, 2]);
    for (let k = 0; k < w2Count; k++) {
      const w = r.pick(wages);
      w2s.push({ wages: w, federalTaxWithheld: Math.round(w * r.pick([0, 0.05, 0.12, 0.22, 0.4])), socialSecurityWages: w, socialSecurityTaxWithheld: w * 0.062, medicareWages: r.pick([w, w, w * 1.5]), medicareTaxWithheld: w * 0.0145 });
    }
    const selfEmployment = [];
    const seCount = r.pick([0, 0, 0, 1, 2]);
    for (let k = 0; k < seCount; k++) selfEmployment.push({ grossIncome: r.pick([300, 800, 12000, 60000, 250000]), expenses: r.pick([0, 400, 5000, 90000]) });
    const rentalIncome = [];
    const rentCount = r.pick([0, 0, 0, 1, 2]);
    for (let k = 0; k < rentCount; k++) rentalIncome.push({ grossRent: r.pick([0, 9000, 24000]), expenses: r.pick([2000, 12000, 60000]), activeParticipant: r.chance(0.6) });
    const dependents = [];
    const depCount = r.pick([0, 0, 0, 1, 2, 3, 4]);
    for (let k = 0; k < depCount; k++) {
      dependents.push({ age: r.pick([1, 5, 12, 16, 17, 18, 20, 23, 24, 45, 70]), isStudent: r.chance(0.3), isDisabled: r.chance(0.1), relationship: r.pick(['CHILD', 'STEPCHILD', 'FOSTER', 'SIBLING', 'PARENT', 'OTHER']), monthsLivedWithTaxpayer: r.pick([12, 12, 7, 6, 5, 0]), providedMoreThanHalfOwnSupport: r.chance(0.15), hasSsn: !r.chance(0.15), earnedIncome: r.pick([0, 0, 5000]) });
    }
    return {
      taxYear: r.pick([2023, 2023, 2024, 2024, 2022, 2025]),
      filingStatus: r.pick(statuses),
      profile: {
        age: r.pick([24, 30, 49, 50, 54, 55, 64, 65, 80]),
        isBlind: r.chance(0.08),
        spouseAge: r.pick([undefined, 40, 64, 65, 70]),
        spouseIsBlind: r.pick([undefined, false, true]),
        spouseItemizesSeparately: r.pick([undefined, false, true]),
        spouseLivingApartAllYear: r.pick([undefined, false, true]),
        hasEmployerRetirementPlan: r.chance(0.5),
        spouseHasEmployerRetirementPlan: r.pick([undefined, false, true]),
        hsaCoverageType: r.pick(['NONE', 'NONE', 'SELF_ONLY', 'FAMILY']),
        hsaContribution: r.pick([0, 2000, 3850, 4150, 5000, 7750, 9500]),
        iraContribution: r.pick([0, 0, 2000, 6500, 7000, 8000, 9000]),
        studentLoanInterestPaid: r.pick([0, 0, 900, 2500, 4000]),
        taxExemptInterest: r.pick([0, 0, 1500, 40000]),
        socialSecurityBenefits: r.pick([0, 0, 0, 12000, 30000, 48000]),
        estimatedTaxPayments: r.pick([0, 0, 2000, 15000, 90000]),
        foreignTaxesPaid: r.pick([0, 0, 150, 3000]),
        qualifyingEducationExpensesAotc: r.pick([0, 0, 1500, 2000, 3000, 4000, 9000]),
        qualifyingEducationExpensesLlc: r.pick([0, 0, 3000, 10000, 15000]),
        energyEfficientHomeExpenses: r.pick([0, 0, 2000, 12000]),
        childAndDependentCareExpenses: r.pick([0, 0, 2500, 3000, 5000, 9000]),
        priorYearAgi: r.pick([40000, 150000, 150001, 400000]),
        priorYearTotalTax: r.pick([0, 3000, 25000, 120000]),
      },
      w2s,
      selfEmployment,
      capitalGains: { shortTermGains: r.pick([0, 0, 2000, 15000]), shortTermLosses: r.pick([0, 0, 1000, 5000, 30000]), longTermGains: r.pick([0, 0, 4000, 60000, 700000]), longTermLosses: r.pick([0, 0, 2500, 9000, 80000]) },
      dividends: { ordinaryDividends: r.pick([0, 0, 800, 12000, 300000]), qualifiedDividends: r.pick([0, 0, 500, 9000, 400000]) },
      taxableInterest: r.pick([0, 0, 300, 11500, 90000]),
      rentalIncome,
      dependents,
      itemizedDeductions: r.chance(0.55)
        ? undefined
        : {
            stateAndLocalIncomeTax: r.pick([0, 3000, 9000, 30000]),
            stateAndLocalSalesTax: r.pick([0, 1200, 12000]),
            realEstateTax: r.pick([0, 2500, 8000]),
            personalPropertyTax: r.pick([0, 400]),
            mortgageInterest: r.pick([0, 6000, 22000, 60000]),
            mortgagePrincipalBalance: r.pick([0, 300000, 375000, 375001, 750000, 750001, 1500000]),
            charitableCash: r.pick([0, 500, 15000, 400000]),
            charitableNonCash: r.pick([0, 200, 8000, 250000]),
            medicalExpenses: r.pick([0, 1500, 20000, 120000]),
            casualtyLosses: r.pick([0, 0, 7000]),
          },
    };
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  for (let i = 0; i < 20000; i++) {
    const submission = submissionFor(h.rng(21000 + i));
    cases.push({ label: `return-${i}`, run: (mod) => new mod.TaxAssessmentService().assessTaxReturn(submission) });
  }
  // Low-income households with children: the refundable-credit region.
  for (let i = 0; i < 4000; i++) {
    const r = h.rng(41000 + i);
    const submission: any = submissionFor(r);
    submission.taxYear = r.pick([2023, 2024]);
    submission.filingStatus = r.pick(['SINGLE', 'MARRIED_FILING_JOINTLY', 'HEAD_OF_HOUSEHOLD']);
    const w = r.pick([1000, 6000, 9500, 12000, 16000, 19000, 21000, 24000, 28000, 33000, 37000, 41000, 44000, 47000, 52000, 58000, 64000]);
    submission.w2s = [{ wages: w, federalTaxWithheld: r.pick([0, 500, 2500]), socialSecurityWages: w, socialSecurityTaxWithheld: w * 0.062, medicareWages: w, medicareTaxWithheld: w * 0.0145 }];
    submission.selfEmployment = [];
    submission.rentalIncome = [];
    submission.capitalGains = { shortTermGains: 0, shortTermLosses: 0, longTermGains: r.pick([0, 0, 500]), longTermLosses: 0 };
    submission.dividends = { ordinaryDividends: r.pick([0, 0, 200]), qualifiedDividends: 0 };
    submission.taxableInterest = r.pick([0, 100, 10800, 11001]);
    submission.itemizedDeductions = undefined;
    submission.dependents = Array.from({ length: r.pick([0, 1, 2, 3, 4]) }, () => ({ age: r.pick([2, 9, 16]), isStudent: false, isDisabled: false, relationship: 'CHILD', monthsLivedWithTaxpayer: 12, providedMoreThanHalfOwnSupport: false, hasSsn: true, earnedIncome: 0 }));
    cases.push({ label: `low-income-${i}`, run: (mod) => new mod.TaxAssessmentService().assessTaxReturn(submission) });
  }
  return cases;
});
