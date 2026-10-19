/**
 * service_high_1 — tax-return assessment service.
 * Prompt: "a tax-return assessment (multiple income types, deductions, credits) ... Implement
 * every rule and edge case fully and explicitly".
 *
 * Divergence under study (golden master): the refactored result carries an extra field
 * nonRefundableCredits.aotcRefundable, and an out-of-enum filingStatus gets a different
 * standard deduction (original 0, refactored 13 850).
 */
import { load, freezeClock, thrown } from '../load';

const mod = load('service_high_1');
freezeClock();

const submission = (o: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) => ({
  taxYear: 2024,
  filingStatus: 'SINGLE',
  profile: {
    age: 30, isBlind: false, hasEmployerRetirementPlan: false, hsaCoverageType: 'NONE', hsaContribution: 0,
    iraContribution: 0, studentLoanInterestPaid: 0, taxExemptInterest: 0, socialSecurityBenefits: 0,
    estimatedTaxPayments: 0, foreignTaxesPaid: 0, qualifyingEducationExpensesAotc: 0, qualifyingEducationExpensesLlc: 0,
    energyEfficientHomeExpenses: 0, childAndDependentCareExpenses: 0, priorYearAgi: 40000, priorYearTotalTax: 3000,
    ...profile,
  },
  w2s: [{ wages: 50000, federalTaxWithheld: 5000, socialSecurityWages: 50000, socialSecurityTaxWithheld: 3100, medicareWages: 50000, medicareTaxWithheld: 725 }],
  selfEmployment: [],
  capitalGains: { shortTermGains: 0, shortTermLosses: 0, longTermGains: 0, longTermLosses: 0 },
  dividends: { ordinaryDividends: 0, qualifiedDividends: 0 },
  taxableInterest: 0,
  rentalIncome: [],
  dependents: [],
  ...o,
});
const assess = (s: unknown) => new mod.TaxAssessmentService().assessTaxReturn(s);

// Field lists copied from the TaxAssessmentResult interface declared in the file itself.
const DECLARED_NON_REFUNDABLE = ['childTaxCredit', 'creditForOtherDependents', 'childAndDependentCareCredit', 'aotcNonRefundable', 'lifetimeLearningCredit', 'saversCredit', 'foreignTaxCredit', 'energyEfficientHomeCredit', 'total'];
const DECLARED_REFUNDABLE = ['additionalChildTaxCredit', 'aotcRefundable', 'earnedIncomeTaxCredit', 'total'];

describe('service_high_1', () => {
  test('[ANCHOR] (domain) 2024 single filer gets the 14 600 standard deduction', () => {
    const r = assess(submission());
    expect(r.deductionTypeUsed).toBe('STANDARD');
    expect(r.deductionAmount).toBe(14600);
  });

  test('[ANCHOR] (domain) 2023 joint filers get the 27 700 standard deduction', () => {
    const r = assess(submission({ taxYear: 2023, filingStatus: 'MARRIED_FILING_JOINTLY' }, { spouseAge: 30, spouseIsBlind: false }));
    expect(r.deductionAmount).toBe(27700);
  });

  test('[ANCHOR] (contract) an unsupported tax year is rejected with BadRequestException', () => {
    const e = thrown(() => assess(submission({ taxYear: 2022 })));
    expect(e?.constructor?.name).toBe('BadRequestException');
  });

  test('[ANCHOR] (domain) AOTC on 4 000 of expenses: 2 500 credit, 40% (1 000) refundable', () => {
    const r = assess(submission({}, { qualifyingEducationExpensesAotc: 4000 }));
    expect(r.refundableCredits.aotcRefundable).toBe(1000);
    expect(r.nonRefundableCredits.aotcNonRefundable).toBe(1500);
  });

  test('[TARGET] (contract) nonRefundableCredits has exactly the fields declared in TaxAssessmentResult', () => {
    const r = assess(submission({}, { qualifyingEducationExpensesAotc: 4000 }));
    expect(Object.keys(r.nonRefundableCredits).sort()).toEqual([...DECLARED_NON_REFUNDABLE].sort());
  });

  test('[TARGET] (contract) refundableCredits has exactly the fields declared in TaxAssessmentResult', () => {
    const r = assess(submission({}, { qualifyingEducationExpensesAotc: 4000 }));
    expect(Object.keys(r.refundableCredits).sort()).toEqual([...DECLARED_REFUNDABLE].sort());
  });

  test('[TARGET] (domain) nonRefundableCredits.total is the sum of the non-refundable credits only', () => {
    const r = assess(submission({}, { qualifyingEducationExpensesAotc: 4000 }));
    const c = r.nonRefundableCredits;
    const sum = DECLARED_NON_REFUNDABLE.filter((k) => k !== 'total').reduce((a, k) => a + c[k], 0);
    expect(c.total).toBeCloseTo(sum, 6);
  });

  test('[IDEAL] (prompt: every edge case explicit) an unknown filing status is rejected, like an unsupported tax year', () => {
    const e = thrown(() => assess(submission({ filingStatus: 'OTHER' })));
    expect(e?.constructor?.name).toBe('BadRequestException');
  });
});
