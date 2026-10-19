import { Injectable, BadRequestException } from '@nestjs/common';

export enum FilingStatus {
  SINGLE = 'SINGLE',
  MARRIED_FILING_JOINTLY = 'MARRIED_FILING_JOINTLY',
  MARRIED_FILING_SEPARATELY = 'MARRIED_FILING_SEPARATELY',
  HEAD_OF_HOUSEHOLD = 'HEAD_OF_HOUSEHOLD',
  QUALIFYING_SURVIVING_SPOUSE = 'QUALIFYING_SURVIVING_SPOUSE',
}

export interface W2Income {
  wages: number;
  federalTaxWithheld: number;
  socialSecurityWages: number;
  socialSecurityTaxWithheld: number;
  medicareWages: number;
  medicareTaxWithheld: number;
}

export interface SelfEmploymentIncome {
  grossIncome: number;
  expenses: number;
}

export interface CapitalGains {
  shortTermGains: number;
  shortTermLosses: number;
  longTermGains: number;
  longTermLosses: number;
}

export interface DividendIncome {
  ordinaryDividends: number;
  qualifiedDividends: number;
}

export interface RentalIncome {
  grossRent: number;
  expenses: number;
  activeParticipant: boolean;
}

export interface DependentInfo {
  age: number;
  isStudent: boolean;
  isDisabled: boolean;
  relationship: 'CHILD' | 'STEPCHILD' | 'FOSTER' | 'SIBLING' | 'PARENT' | 'OTHER';
  monthsLivedWithTaxpayer: number;
  providedMoreThanHalfOwnSupport: boolean;
  hasSsn: boolean;
  earnedIncome: number;
}

export interface ItemizedDeductions {
  stateAndLocalIncomeTax: number;
  stateAndLocalSalesTax: number;
  realEstateTax: number;
  personalPropertyTax: number;
  mortgageInterest: number;
  mortgagePrincipalBalance: number;
  charitableCash: number;
  charitableNonCash: number;
  medicalExpenses: number;
  casualtyLosses: number;
}

export interface TaxpayerProfile {
  age: number;
  isBlind: boolean;
  spouseAge?: number;
  spouseIsBlind?: boolean;
  spouseItemizesSeparately?: boolean;
  spouseLivingApartAllYear?: boolean;
  hasEmployerRetirementPlan: boolean;
  spouseHasEmployerRetirementPlan?: boolean;
  hsaCoverageType: 'NONE' | 'SELF_ONLY' | 'FAMILY';
  hsaContribution: number;
  iraContribution: number;
  studentLoanInterestPaid: number;
  taxExemptInterest: number;
  socialSecurityBenefits: number;
  estimatedTaxPayments: number;
  foreignTaxesPaid: number;
  qualifyingEducationExpensesAotc: number;
  qualifyingEducationExpensesLlc: number;
  energyEfficientHomeExpenses: number;
  childAndDependentCareExpenses: number;
  priorYearAgi: number;
  priorYearTotalTax: number;
}

export interface TaxReturnSubmission {
  taxYear: number;
  filingStatus: FilingStatus;
  profile: TaxpayerProfile;
  w2s: W2Income[];
  selfEmployment: SelfEmploymentIncome[];
  capitalGains: CapitalGains;
  dividends: DividendIncome;
  taxableInterest: number;
  rentalIncome: RentalIncome[];
  dependents: DependentInfo[];
  itemizedDeductions?: ItemizedDeductions;
}

export interface TaxAssessmentResult {
  totalGrossIncome: number;
  adjustedGrossIncome: number;
  modifiedAdjustedGrossIncome: number;
  deductionTypeUsed: 'STANDARD' | 'ITEMIZED';
  deductionAmount: number;
  charitableCarryover: { cash: number; nonCash: number };
  capitalLossCarryover: { shortTerm: number; longTerm: number };
  taxableIncome: number;
  ordinaryTaxableIncome: number;
  preferentialTaxableIncome: number;
  ordinaryIncomeTax: number;
  preferentialIncomeTax: number;
  selfEmploymentTax: number;
  additionalMedicareTax: number;
  netInvestmentIncomeTax: number;
  alternativeMinimumTax: number;
  totalTaxBeforeCredits: number;
  nonRefundableCredits: {
    childTaxCredit: number;
    creditForOtherDependents: number;
    childAndDependentCareCredit: number;
    aotcNonRefundable: number;
    lifetimeLearningCredit: number;
    saversCredit: number;
    foreignTaxCredit: number;
    energyEfficientHomeCredit: number;
    total: number;
  };
  refundableCredits: {
    additionalChildTaxCredit: number;
    aotcRefundable: number;
    earnedIncomeTaxCredit: number;
    total: number;
  };
  totalTaxPayments: number;
  totalFinalTaxLiability: number;
  balanceDueOrRefund: number;
  underpaymentPenaltyEstimated: number;
}

type OrdinaryTaxBrackets = Array<{ rate: number; threshold: number }>;

const ORDINARY_TAX_BRACKETS: Record<number, Record<string, OrdinaryTaxBrackets>> = {
  2023: {
    SINGLE_MFS: [
      { rate: 0.10, threshold: 11000 },
      { rate: 0.12, threshold: 44725 },
      { rate: 0.22, threshold: 95375 },
      { rate: 0.24, threshold: 182100 },
      { rate: 0.32, threshold: 231250 },
      { rate: 0.35, threshold: 578125 },
      { rate: 0.37, threshold: Infinity },
    ],
    MFJ_QSS: [
      { rate: 0.10, threshold: 22000 },
      { rate: 0.12, threshold: 89450 },
      { rate: 0.22, threshold: 190750 },
      { rate: 0.24, threshold: 364200 },
      { rate: 0.32, threshold: 462500 },
      { rate: 0.35, threshold: 693750 },
      { rate: 0.37, threshold: Infinity },
    ],
    HOH: [
      { rate: 0.10, threshold: 15700 },
      { rate: 0.12, threshold: 59850 },
      { rate: 0.22, threshold: 95350 },
      { rate: 0.24, threshold: 182100 },
      { rate: 0.32, threshold: 231250 },
      { rate: 0.35, threshold: 578100 },
      { rate: 0.37, threshold: Infinity },
    ],
  },
  2024: {
    SINGLE_MFS: [
      { rate: 0.10, threshold: 11600 },
      { rate: 0.12, threshold: 47150 },
      { rate: 0.22, threshold: 100525 },
      { rate: 0.24, threshold: 191950 },
      { rate: 0.32, threshold: 243725 },
      { rate: 0.35, threshold: 609350 },
      { rate: 0.37, threshold: Infinity },
    ],
    MFJ_QSS: [
      { rate: 0.10, threshold: 23200 },
      { rate: 0.12, threshold: 94300 },
      { rate: 0.22, threshold: 201050 },
      { rate: 0.24, threshold: 383900 },
      { rate: 0.32, threshold: 487450 },
      { rate: 0.35, threshold: 731200 },
      { rate: 0.37, threshold: Infinity },
    ],
    HOH: [
      { rate: 0.10, threshold: 16550 },
      { rate: 0.12, threshold: 63100 },
      { rate: 0.22, threshold: 100500 },
      { rate: 0.24, threshold: 191950 },
      { rate: 0.32, threshold: 243700 },
      { rate: 0.35, threshold: 609350 },
      { rate: 0.37, threshold: Infinity },
    ],
  },
};

const PREFERENTIAL_TAX_CAPS: Record<number, Record<FilingStatus, { zeroCap: number; fifteenCap: number }>> = {
  2023: {
    [FilingStatus.SINGLE]: { zeroCap: 44625, fifteenCap: 492300 },
    [FilingStatus.MARRIED_FILING_SEPARATELY]: { zeroCap: 44625, fifteenCap: 276900 },
    [FilingStatus.HEAD_OF_HOUSEHOLD]: { zeroCap: 59750, fifteenCap: 523050 },
    [FilingStatus.MARRIED_FILING_JOINTLY]: { zeroCap: 89250, fifteenCap: 553850 },
    [FilingStatus.QUALIFYING_SURVIVING_SPOUSE]: { zeroCap: 89250, fifteenCap: 553850 },
  },
  2024: {
    [FilingStatus.SINGLE]: { zeroCap: 47025, fifteenCap: 518900 },
    [FilingStatus.MARRIED_FILING_SEPARATELY]: { zeroCap: 47025, fifteenCap: 291850 },
    [FilingStatus.HEAD_OF_HOUSEHOLD]: { zeroCap: 63000, fifteenCap: 551350 },
    [FilingStatus.MARRIED_FILING_JOINTLY]: { zeroCap: 94050, fifteenCap: 583750 },
    [FilingStatus.QUALIFYING_SURVIVING_SPOUSE]: { zeroCap: 94050, fifteenCap: 583750 },
  },
};

const BASE_STANDARD_DEDUCTION: Record<number, Record<string, number>> = {
  2023: {
    SINGLE_MFS: 13850,
    HOH: 20800,
    MFJ_QSS: 27700,
  },
  2024: {
    SINGLE_MFS: 14600,
    HOH: 21900,
    MFJ_QSS: 29200,
  },
};

const CARE_PERCENT_TABLE = [
  { limit: 15000, rate: 0.35 },
  { limit: 17000, rate: 0.34 },
  { limit: 19000, rate: 0.33 },
  { limit: 21000, rate: 0.32 },
  { limit: 23000, rate: 0.31 },
  { limit: 25000, rate: 0.30 },
  { limit: 27000, rate: 0.29 },
  { limit: 29000, rate: 0.28 },
  { limit: 31000, rate: 0.27 },
  { limit: 33000, rate: 0.26 },
  { limit: 35000, rate: 0.25 },
  { limit: 37000, rate: 0.24 },
  { limit: 39000, rate: 0.23 },
  { limit: 41000, rate: 0.22 },
  { limit: 43000, rate: 0.21 },
];

const SAVERS_CREDIT_BRACKETS: Record<string, Array<{ limit: number; rate: number }>> = {
  [FilingStatus.MARRIED_FILING_JOINTLY]: [
    { limit: 43500, rate: 0.50 },
    { limit: 47500, rate: 0.20 },
    { limit: 73000, rate: 0.10 },
  ],
  [FilingStatus.HEAD_OF_HOUSEHOLD]: [
    { limit: 32625, rate: 0.50 },
    { limit: 35625, rate: 0.20 },
    { limit: 54750, rate: 0.10 },
  ],
  DEFAULT: [
    { limit: 21750, rate: 0.50 },
    { limit: 23750, rate: 0.20 },
    { limit: 36500, rate: 0.10 },
  ],
};

const CAPITAL_GAINS_STRATEGIES: Record<string, (params: { netStGains: number; netLtGains: number; maxLossDeduction: number }) => { netCapitalGainOrLoss: number; netLtCapitalGainForPreferential: number; stLossCarryover: number; ltLossCarryover: number }> = {
  'true_true': ({ netStGains, netLtGains }) => ({
    netCapitalGainOrLoss: netStGains + netLtGains,
    netLtCapitalGainForPreferential: netLtGains,
    stLossCarryover: 0,
    ltLossCarryover: 0,
  }),
  'false_false': ({ netStGains, netLtGains, maxLossDeduction }) => {
    const stAbs = Math.abs(netStGains);
    const ltAbs = Math.abs(netLtGains);
    const totalLoss = stAbs + ltAbs;
    const deduction = Math.min(totalLoss, maxLossDeduction);
    const stDeducted = Math.min(stAbs, deduction);
    const ltDeducted = deduction - stDeducted;
    return {
      netCapitalGainOrLoss: -deduction,
      netLtCapitalGainForPreferential: 0,
      stLossCarryover: stAbs - stDeducted,
      ltLossCarryover: ltAbs - ltDeducted,
    };
  },
  'true_false': ({ netStGains, netLtGains, maxLossDeduction }) => {
    const combined = netStGains + netLtGains;
    if (combined >= 0) {
      return {
        netCapitalGainOrLoss: combined,
        netLtCapitalGainForPreferential: 0,
        stLossCarryover: 0,
        ltLossCarryover: 0,
      };
    }
    const deduction = Math.min(Math.abs(combined), maxLossDeduction);
    const lossCarryover = Math.abs(combined) - deduction;
    return {
      netCapitalGainOrLoss: -deduction,
      netLtCapitalGainForPreferential: 0,
      stLossCarryover: 0,
      ltLossCarryover: lossCarryover,
    };
  },
  'false_true': ({ netStGains, netLtGains, maxLossDeduction }) => {
    const combined = netStGains + netLtGains;
    if (combined >= 0) {
      return {
        netCapitalGainOrLoss: combined,
        netLtCapitalGainForPreferential: combined,
        stLossCarryover: 0,
        ltLossCarryover: 0,
      };
    }
    const deduction = Math.min(Math.abs(combined), maxLossDeduction);
    const lossCarryover = Math.abs(combined) - deduction;
    return {
      netCapitalGainOrLoss: -deduction,
      netLtCapitalGainForPreferential: 0,
      stLossCarryover: lossCarryover,
      ltLossCarryover: 0,
    };
  },
};

const EMPLOYER_PLAN_PHASEOUTS: Record<string, { start: number; end: number }> = {
  [FilingStatus.MARRIED_FILING_JOINTLY]: { start: 116000, end: 136000 },
  [FilingStatus.MARRIED_FILING_SEPARATELY]: { start: 0, end: 10000 },
  DEFAULT: { start: 73000, end: 83000 },
};

@Injectable()
export class TaxAssessmentService {
  public assessTaxReturn(submission: TaxReturnSubmission): TaxAssessmentResult {
    if (submission.taxYear !== 2023 && submission.taxYear !== 2024) {
      throw new BadRequestException('Tax assessment engine currently supports tax years 2023 and 2024 only.');
    }

    const totalW2Wages = submission.w2s.reduce((sum, w) => sum + w.wages, 0);
    const totalW2Withholding = submission.w2s.reduce((sum, w) => sum + w.federalTaxWithheld, 0);

    const seResults = this.calculateSelfEmploymentTax(submission.selfEmployment, totalW2Wages, submission.taxYear);
    const additionalMedicareTax = this.calculateAdditionalMedicareTax(submission.w2s, seResults.netSeIncome, seResults.seScheduleNet, submission.filingStatus);

    const capGains = this.calculateCapitalGains(submission.capitalGains, submission.filingStatus);
    const netRentalIncome = this.calculateRentalIncome(submission.rentalIncome, submission.filingStatus);

    const qualifiedDividends = Math.min(submission.dividends.ordinaryDividends, submission.dividends.qualifiedDividends);
    const preliminaryGrossIncomeWithoutSS = totalW2Wages + seResults.netSeIncome + capGains.netCapitalGainOrLoss + submission.dividends.ordinaryDividends + submission.taxableInterest + netRentalIncome;

    const taxableSocialSecurity = this.calculateTaxableSocialSecurity(submission.profile, submission.filingStatus, preliminaryGrossIncomeWithoutSS);
    const totalGrossIncome = preliminaryGrossIncomeWithoutSS + taxableSocialSecurity;

    const hsaDeduction = this.calculateHsaDeduction(submission.profile, submission.taxYear);
    const preliminaryMagiForDeductions = Math.max(0, totalGrossIncome - seResults.halfSeDeduction - hsaDeduction);

    const studentLoanDeduction = this.calculateStudentLoanDeduction(submission.profile, submission.filingStatus, preliminaryMagiForDeductions);
    const iraDeduction = this.calculateIraDeduction(submission.profile, submission.filingStatus, submission.taxYear, preliminaryMagiForDeductions);

    const totalAboveTheLineDeductions = seResults.halfSeDeduction + hsaDeduction + studentLoanDeduction + iraDeduction;
    const adjustedGrossIncome = Math.max(0, totalGrossIncome - totalAboveTheLineDeductions);
    const modifiedAdjustedGrossIncome = adjustedGrossIncome + submission.profile.taxExemptInterest;

    const totalStandardDeduction = this.calculateStandardDeduction(submission.profile, submission.filingStatus, submission.taxYear);
    const itemizedResults = this.calculateItemizedDeductions(adjustedGrossIncome, submission.filingStatus, submission.itemizedDeductions);

    const deductionTypeUsed: 'STANDARD' | 'ITEMIZED' = this.shouldUseItemized(submission.filingStatus, submission.profile.spouseItemizesSeparately, itemizedResults.totalItemized, totalStandardDeduction)
      ? 'ITEMIZED'
      : 'STANDARD';
    const finalDeductionAmount = deductionTypeUsed === 'ITEMIZED' ? itemizedResults.totalItemized : totalStandardDeduction;

    const taxableIncome = Math.max(0, adjustedGrossIncome - finalDeductionAmount);
    const totalPreferentialIncome = Math.max(0, capGains.netLtCapitalGainForPreferential + qualifiedDividends);
    const preferentialTaxableIncome = Math.min(taxableIncome, totalPreferentialIncome);
    const ordinaryTaxableIncome = taxableIncome - preferentialTaxableIncome;

    const ordinaryIncomeTax = this.calculateOrdinaryTax(ordinaryTaxableIncome, submission.filingStatus, submission.taxYear);
    const preferentialIncomeTax = this.calculatePreferentialTax(ordinaryTaxableIncome, preferentialTaxableIncome, submission.filingStatus, submission.taxYear);

    const netInvestmentIncomeTax = this.calculateNetInvestmentIncomeTax(submission.dividends.ordinaryDividends, submission.taxableInterest, capGains.netCapitalGainOrLoss, netRentalIncome, modifiedAdjustedGrossIncome, submission.filingStatus);
    const alternativeMinimumTax = this.calculateAlternativeMinimumTax(taxableIncome, modifiedAdjustedGrossIncome, ordinaryIncomeTax + preferentialIncomeTax, submission.filingStatus);

    const totalTaxBeforeCredits = ordinaryIncomeTax + preferentialIncomeTax + seResults.totalSeTax + additionalMedicareTax + netInvestmentIncomeTax + alternativeMinimumTax;

    const dependentCounts = this.classifyDependents(submission.dependents);
    const nonRefundableCredits = this.calculateNonRefundableCredits({
      profile: submission.profile,
      filingStatus: submission.filingStatus,
      adjustedGrossIncome,
      modifiedAdjustedGrossIncome,
      ordinaryIncomeTax,
      preferentialIncomeTax,
      ctcCount: dependentCounts.ctcCount,
      odcCount: dependentCounts.odcCount,
    });

    const refundableCredits = this.calculateRefundableCredits({
      profile: submission.profile,
      filingStatus: submission.filingStatus,
      taxYear: submission.taxYear,
      adjustedGrossIncome,
      totalW2Wages,
      netSeIncome: seResults.netSeIncome,
      dividends: submission.dividends,
      taxableInterest: submission.taxableInterest,
      netCapitalGainOrLoss: capGains.netCapitalGainOrLoss,
      ctcCount: dependentCounts.ctcCount,
      ctcNonRefundable: nonRefundableCredits.childTaxCredit,
      aotcRefundable: nonRefundableCredits.aotcRefundable,
    });

    const totalTaxPayments = totalW2Withholding + submission.profile.estimatedTaxPayments + refundableCredits.total;
    const totalFinalTaxLiability = Math.max(0, totalTaxBeforeCredits - nonRefundableCredits.total);
    const balanceDueOrRefund = totalFinalTaxLiability - totalTaxPayments;

    const underpaymentPenaltyEstimated = this.calculateUnderpaymentPenalty(balanceDueOrRefund, totalTaxPayments, refundableCredits.total, totalFinalTaxLiability, submission.profile);

    return {
      totalGrossIncome,
      adjustedGrossIncome,
      modifiedAdjustedGrossIncome,
      deductionTypeUsed,
      deductionAmount: finalDeductionAmount,
      charitableCarryover: { cash: itemizedResults.cashCarryover, nonCash: itemizedResults.nonCashCarryover },
      capitalLossCarryover: { shortTerm: capGains.stLossCarryover, longTerm: capGains.ltLossCarryover },
      taxableIncome,
      ordinaryTaxableIncome,
      preferentialTaxableIncome,
      ordinaryIncomeTax,
      preferentialIncomeTax,
      selfEmploymentTax: seResults.totalSeTax,
      additionalMedicareTax,
      netInvestmentIncomeTax,
      alternativeMinimumTax,
      totalTaxBeforeCredits,
      nonRefundableCredits,
      refundableCredits,
      totalTaxPayments,
      totalFinalTaxLiability,
      balanceDueOrRefund,
      underpaymentPenaltyEstimated,
    };
  }

  private calculateOrdinaryTax(taxableOrdinary: number, status: FilingStatus, year: number): number {
    if (taxableOrdinary <= 0) return 0;

    const statusGroup = this.getFilingStatusGroup(status);
    const brackets = ORDINARY_TAX_BRACKETS[year]?.[statusGroup] ?? ORDINARY_TAX_BRACKETS[2023]['SINGLE_MFS'];

    let tax = 0;
    let previousThreshold = 0;

    for (const bracket of brackets) {
      if (taxableOrdinary > bracket.threshold) {
        tax += (bracket.threshold - previousThreshold) * bracket.rate;
        previousThreshold = bracket.threshold;
      } else {
        tax += (taxableOrdinary - previousThreshold) * bracket.rate;
        break;
      }
    }

    return tax;
  }

  private calculatePreferentialTax(ordinaryTaxable: number, preferentialTaxable: number, status: FilingStatus, year: number): number {
    if (preferentialTaxable <= 0) return 0;

    const caps = PREFERENTIAL_TAX_CAPS[year]?.[status] ?? PREFERENTIAL_TAX_CAPS[2023][FilingStatus.SINGLE];
    const { zeroCap, fifteenCap } = caps;

    let tax = 0;
    let remaining = preferentialTaxable;
    let pointer = ordinaryTaxable;

    if (pointer < zeroCap) {
      const spanInZero = Math.min(remaining, zeroCap - pointer);
      pointer += spanInZero;
      remaining -= spanInZero;
    }

    if (remaining > 0 && pointer < fifteenCap) {
      const spanInFifteen = Math.min(remaining, fifteenCap - pointer);
      tax += spanInFifteen * 0.15;
      pointer += spanInFifteen;
      remaining -= spanInFifteen;
    }

    if (remaining > 0) {
      tax += remaining * 0.20;
    }

    return tax;
  }

  private calculateEitc(earnedIncome: number, agi: number, children: number, status: FilingStatus): number {
    const basisIncome = Math.max(earnedIncome, agi);

    let maxCredit = 600;
    let phaseoutStart = 9800;
    let maxIncome = 17640;

    if (status === FilingStatus.MARRIED_FILING_JOINTLY) {
      phaseoutStart += 6580;
      maxIncome += 6580;
    }

    if (children === 1) {
      maxCredit = 3995;
      phaseoutStart = 21560;
      maxIncome = 46560;
      if (status === FilingStatus.MARRIED_FILING_JOINTLY) {
        phaseoutStart += 6580;
        maxIncome += 6580;
      }
    } else if (children === 2) {
      maxCredit = 6604;
      phaseoutStart = 21560;
      maxIncome = 52918;
      if (status === FilingStatus.MARRIED_FILING_JOINTLY) {
        phaseoutStart += 6580;
        maxIncome += 6580;
      }
    } else if (children >= 3) {
      maxCredit = 7430;
      phaseoutStart = 21560;
      maxIncome = 56838;
      if (status === FilingStatus.MARRIED_FILING_JOINTLY) {
        phaseoutStart += 6580;
        maxIncome += 6580;
      }
    }

    if (basisIncome >= maxIncome) return 0;
    if (basisIncome <= phaseoutStart) return maxCredit;

    const phaseoutRange = maxIncome - phaseoutStart;
    const excess = basisIncome - phaseoutStart;
    const reductionRatio = excess / phaseoutRange;

    return Math.max(0, maxCredit * (1 - reductionRatio));
  }

  private getFilingStatusGroup(status: FilingStatus): 'SINGLE_MFS' | 'MFJ_QSS' | 'HOH' {
    if (status === FilingStatus.SINGLE || status === FilingStatus.MARRIED_FILING_SEPARATELY) {
      return 'SINGLE_MFS';
    }
    if (status === FilingStatus.MARRIED_FILING_JOINTLY || status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE) {
      return 'MFJ_QSS';
    }
    return 'HOH';
  }

  private calculateSelfEmploymentTax(selfEmployment: SelfEmploymentIncome[], totalW2Wages: number, taxYear: number) {
    let netSeIncome = 0;
    for (const se of selfEmployment) {
      netSeIncome += (se.grossIncome - se.expenses);
    }
    const seScheduleNet = netSeIncome > 0 ? netSeIncome * 0.9235 : 0;

    let seSocialSecurityTax = 0;
    let seMedicareTax = 0;
    const ssCap = taxYear === 2023 ? 160200 : 168600;

    if (seScheduleNet >= 400) {
      const remainingSsCap = Math.max(0, ssCap - totalW2Wages);
      const ssTaxableSe = Math.min(seScheduleNet, remainingSsCap);
      seSocialSecurityTax = ssTaxableSe * 0.124;
      seMedicareTax = seScheduleNet * 0.029;
    }

    const totalSeTax = seSocialSecurityTax + seMedicareTax;
    return {
      netSeIncome,
      seScheduleNet,
      totalSeTax,
      halfSeDeduction: totalSeTax * 0.5,
    };
  }

  private calculateAdditionalMedicareTax(w2s: W2Income[], netSeIncome: number, seScheduleNet: number, filingStatus: FilingStatus): number {
    let totalMedicareWages = w2s.reduce((sum, w) => sum + w.medicareWages, 0);
    if (netSeIncome > 0) {
      totalMedicareWages += seScheduleNet;
    }

    let threshold = 200000;
    if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      threshold = 250000;
    } else if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
      threshold = 125000;
    }

    return Math.max(0, totalMedicareWages - threshold) * 0.009;
  }

  private calculateCapitalGains(capitalGains: CapitalGains, filingStatus: FilingStatus) {
    const netStGains = capitalGains.shortTermGains - capitalGains.shortTermLosses;
    const netLtGains = capitalGains.longTermGains - capitalGains.longTermLosses;
    const maxLossDeduction = filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 1500 : 3000;

    const key = `${netStGains >= 0}_${netLtGains >= 0}`;
    return CAPITAL_GAINS_STRATEGIES[key]({ netStGains, netLtGains, maxLossDeduction });
  }

  private calculateRentalIncome(rentalIncome: RentalIncome[], filingStatus: FilingStatus): number {
    const maxPassiveLoss = filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 12500 : 25000;
    return rentalIncome.reduce((sum, rent) => {
      const netRent = rent.grossRent - rent.expenses;
      if (netRent >= 0) return sum + netRent;
      return rent.activeParticipant ? sum + Math.max(netRent, -maxPassiveLoss) : sum;
    }, 0);
  }

  private calculateTaxableSocialSecurity(profile: TaxpayerProfile, filingStatus: FilingStatus, preliminaryGrossIncome: number): number {
    if (profile.socialSecurityBenefits <= 0) return 0;

    const provisionalIncome = preliminaryGrossIncome + (0.5 * profile.socialSecurityBenefits) + profile.taxExemptInterest;
    let ssBase1 = 25000;
    let ssBase2 = 34000;

    if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      ssBase1 = 32000;
      ssBase2 = 44000;
    } else if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY && !profile.spouseLivingApartAllYear) {
      ssBase1 = 0;
      ssBase2 = 0;
    }

    if (provisionalIncome > ssBase2) {
      if (ssBase1 === 0) {
        return Math.min(0.85 * profile.socialSecurityBenefits, 0.85 * provisionalIncome);
      }
      const tier1 = 0.5 * (ssBase2 - ssBase1);
      const tier2 = 0.85 * (provisionalIncome - ssBase2);
      return Math.min(0.85 * profile.socialSecurityBenefits, tier1 + tier2);
    }

    if (provisionalIncome > ssBase1) {
      return Math.min(0.5 * profile.socialSecurityBenefits, 0.5 * (provisionalIncome - ssBase1));
    }

    return 0;
  }

  private calculateHsaDeduction(profile: TaxpayerProfile, taxYear: number): number {
    if (profile.hsaCoverageType === 'NONE') return 0;

    let hsaLimit = profile.hsaCoverageType === 'SELF_ONLY'
      ? (taxYear === 2023 ? 3850 : 4150)
      : (taxYear === 2023 ? 7750 : 8300);

    if (profile.age >= 55) {
      hsaLimit += 1000;
    }

    return Math.min(profile.hsaContribution, hsaLimit);
  }

  private calculateStudentLoanDeduction(profile: TaxpayerProfile, filingStatus: FilingStatus, magi: number): number {
    if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY || profile.studentLoanInterestPaid <= 0) {
      return 0;
    }

    const maxStudentLoan = Math.min(2500, profile.studentLoanInterestPaid);
    const phaseoutStart = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 155000 : 75000;
    const phaseoutEnd = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 185000 : 90000;

    if (magi <= phaseoutStart) return maxStudentLoan;
    if (magi < phaseoutEnd) {
      const phaseoutRatio = (magi - phaseoutStart) / (phaseoutEnd - phaseoutStart);
      return maxStudentLoan * (1 - phaseoutRatio);
    }

    return 0;
  }

  private getIraPhaseoutRange(profile: TaxpayerProfile, status: FilingStatus): { start: number; end: number } | null | 'NO_PHASEOUT' {
    if (profile.hasEmployerRetirementPlan) {
      return EMPLOYER_PLAN_PHASEOUTS[status] ?? EMPLOYER_PLAN_PHASEOUTS.DEFAULT;
    }
    if (profile.spouseHasEmployerRetirementPlan) {
      return status === FilingStatus.MARRIED_FILING_JOINTLY ? { start: 218000, end: 228000 } : null;
    }
    return 'NO_PHASEOUT';
  }

  private calculateIraDeduction(profile: TaxpayerProfile, filingStatus: FilingStatus, taxYear: number, magi: number): number {
    if (profile.iraContribution <= 0) return 0;

    let maxIra = taxYear === 2023 ? 6500 : 7000;
    if (profile.age >= 50) maxIra += 1000;
    const actualContribution = Math.min(profile.iraContribution, maxIra);

    const range = this.getIraPhaseoutRange(profile, filingStatus);
    if (!range) return 0;
    if (range === 'NO_PHASEOUT') return actualContribution;

    return this.applyPhaseout(actualContribution, magi, range.start, range.end);
  }

  private applyPhaseout(amount: number, income: number, start: number, end: number): number {
    if (income <= start) return amount;
    if (income < end) {
      const ratio = (income - start) / (end - start);
      return amount * (1 - ratio);
    }
    return 0;
  }

  private calculateStandardDeduction(profile: TaxpayerProfile, filingStatus: FilingStatus, taxYear: number): number {
    const statusGroup = this.getFilingStatusGroup(filingStatus);
    const baseStandardDeduction = BASE_STANDARD_DEDUCTION[taxYear]?.[statusGroup] ?? 13850;

    let additionalUnits = 0;
    if (profile.age >= 65) additionalUnits++;
    if (profile.isBlind) additionalUnits++;

    if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      if ((profile.spouseAge ?? 0) >= 65) additionalUnits++;
      if (profile.spouseIsBlind) additionalUnits++;
    }

    const unitAmount = (filingStatus === FilingStatus.SINGLE || filingStatus === FilingStatus.HEAD_OF_HOUSEHOLD) ? 1850 : 1500;
    return baseStandardDeduction + (additionalUnits * unitAmount);
  }

  private calculateItemizedDeductions(agi: number, filingStatus: FilingStatus, itemized?: ItemizedDeductions) {
    if (!itemized) {
      return { totalItemized: 0, cashCarryover: 0, nonCashCarryover: 0 };
    }

    const saltCap = filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 5000 : 10000;
    const stateTaxChoice = Math.max(itemized.stateAndLocalIncomeTax, itemized.stateAndLocalSalesTax);
    const totalSaltRaw = stateTaxChoice + itemized.realEstateTax + itemized.personalPropertyTax;
    const deductibleSalt = Math.min(saltCap, totalSaltRaw);

    let deductibleMortgageInterest = itemized.mortgageInterest;
    const mortgageCap = filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 375000 : 750000;
    if (itemized.mortgagePrincipalBalance > mortgageCap) {
      deductibleMortgageInterest = itemized.mortgageInterest * (mortgageCap / itemized.mortgagePrincipalBalance);
    }

    const deductibleMedical = Math.max(0, itemized.medicalExpenses - (agi * 0.075));

    const cashLimit = agi * 0.60;
    const deductibleCashCharity = Math.min(itemized.charitableCash, cashLimit);
    const cashCarryover = Math.max(0, itemized.charitableCash - deductibleCashCharity);

    const nonCashLimit = agi * 0.30;
    const deductibleNonCashCharity = Math.min(itemized.charitableNonCash, nonCashLimit);
    const nonCashCarryover = Math.max(0, itemized.charitableNonCash - deductibleNonCashCharity);

    const totalItemized = deductibleSalt + deductibleMortgageInterest + deductibleMedical + deductibleCashCharity + deductibleNonCashCharity + itemized.casualtyLosses;

    return { totalItemized, cashCarryover, nonCashCarryover };
  }

  private shouldUseItemized(filingStatus: FilingStatus, spouseItemizes: boolean | undefined, totalItemized: number, totalStandard: number): boolean {
    if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY && spouseItemizes) {
      return true;
    }
    return totalItemized > totalStandard;
  }

  private calculateNetInvestmentIncomeTax(dividends: number, taxableInterest: number, capitalGainOrLoss: number, netRentalIncome: number, magi: number, status: FilingStatus): number {
    const netInvestmentIncome = Math.max(0, dividends + taxableInterest + capitalGainOrLoss + netRentalIncome);
    let threshold = 200000;
    if (status === FilingStatus.MARRIED_FILING_JOINTLY) threshold = 250000;
    else if (status === FilingStatus.MARRIED_FILING_SEPARATELY) threshold = 125000;

    const subjectAmount = Math.min(netInvestmentIncome, Math.max(0, magi - threshold));
    return subjectAmount * 0.038;
  }

  private calculateAlternativeMinimumTax(taxableIncome: number, magi: number, regularTax: number, status: FilingStatus): number {
    let exemption = status === FilingStatus.MARRIED_FILING_JOINTLY ? 126500 : 81300;
    const phaseout = status === FilingStatus.MARRIED_FILING_JOINTLY ? 1156300 : 578150;

    if (magi > phaseout) {
      exemption = Math.max(0, exemption - ((magi - phaseout) * 0.25));
    }

    const amtBase = Math.max(0, taxableIncome - exemption);
    if (amtBase <= 0) return 0;

    const tentativeAmt = amtBase * 0.26;
    return tentativeAmt > regularTax ? tentativeAmt - regularTax : 0;
  }

  private classifyDependents(dependents: DependentInfo[]) {
    let ctcCount = 0;
    let odcCount = 0;

    for (const dep of dependents) {
      if (dep.hasSsn && !dep.providedMoreThanHalfOwnSupport && dep.monthsLivedWithTaxpayer >= 6) {
        if (dep.age < 17) ctcCount++;
        else odcCount++;
      } else {
        odcCount++;
      }
    }

    return { ctcCount, odcCount };
  }

  private calculateNonRefundableCredits(params: {
    profile: TaxpayerProfile;
    filingStatus: FilingStatus;
    adjustedGrossIncome: number;
    modifiedAdjustedGrossIncome: number;
    ordinaryIncomeTax: number;
    preferentialIncomeTax: number;
    ctcCount: number;
    odcCount: number;
  }) {
    let nonRefundableCapacity = params.ordinaryIncomeTax + params.preferentialIncomeTax;

    let initialCtc = params.ctcCount * 2000;
    let initialOdc = params.odcCount * 500;
    const threshold = params.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 400000 : 200000;

    if (params.adjustedGrossIncome > threshold) {
      const reduction = Math.ceil((params.adjustedGrossIncome - threshold) / 1000) * 50;
      if (reduction >= initialOdc) {
        initialCtc = Math.max(0, initialCtc - (reduction - initialOdc));
        initialOdc = 0;
      } else {
        initialOdc -= reduction;
      }
    }

    const childTaxCredit = Math.min(initialCtc, nonRefundableCapacity);
    nonRefundableCapacity -= childTaxCredit;

    const creditForOtherDependents = Math.min(initialOdc, nonRefundableCapacity);
    nonRefundableCapacity -= creditForOtherDependents;

    const childAndDependentCareCredit = this.calculateDependentCareCredit(params.profile.childAndDependentCareExpenses, params.ctcCount, params.adjustedGrossIncome, nonRefundableCapacity);
    nonRefundableCapacity -= childAndDependentCareCredit;

    const { aotcNonRefundable, aotcRefundable } = this.calculateAotc(params.profile.qualifyingEducationExpensesAotc, params.filingStatus, params.modifiedAdjustedGrossIncome, nonRefundableCapacity);
    nonRefundableCapacity -= aotcNonRefundable;

    const lifetimeLearningCredit = this.calculateLlc(params.profile.qualifyingEducationExpensesLlc, params.filingStatus, params.modifiedAdjustedGrossIncome, nonRefundableCapacity);
    nonRefundableCapacity -= lifetimeLearningCredit;

    const saversCredit = this.calculateSaversCredit(params.profile.iraContribution, params.filingStatus, params.adjustedGrossIncome, nonRefundableCapacity);
    nonRefundableCapacity -= saversCredit;

    const foreignTaxCredit = params.profile.foreignTaxesPaid > 0 ? Math.min(params.profile.foreignTaxesPaid, nonRefundableCapacity) : 0;
    nonRefundableCapacity -= foreignTaxCredit;

    const energyEfficientHomeCredit = params.profile.energyEfficientHomeExpenses > 0 ? Math.min(Math.min(1200, params.profile.energyEfficientHomeExpenses * 0.30), nonRefundableCapacity) : 0;

    const total = childTaxCredit + creditForOtherDependents + childAndDependentCareCredit + aotcNonRefundable + lifetimeLearningCredit + saversCredit + foreignTaxCredit + energyEfficientHomeCredit;

    return {
      childTaxCredit,
      creditForOtherDependents,
      childAndDependentCareCredit,
      aotcNonRefundable,
      aotcRefundable,
      lifetimeLearningCredit,
      saversCredit,
      foreignTaxCredit,
      energyEfficientHomeCredit,
      total,
    };
  }

  private calculateDependentCareCredit(expenses: number, ctcCount: number, agi: number, capacity: number): number {
    if (expenses <= 0 || ctcCount <= 0) return 0;

    const careLimit = ctcCount === 1 ? 3000 : 6000;
    const eligibleExpenses = Math.min(expenses, careLimit);
    const carePercent = CARE_PERCENT_TABLE.find(t => agi <= t.limit)?.rate ?? 0.20;

    return Math.min(eligibleExpenses * carePercent, capacity);
  }

  private calculateAotc(expenses: number, filingStatus: FilingStatus, magi: number, capacity: number) {
    if (expenses <= 0 || filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
      return { aotcNonRefundable: 0, aotcRefundable: 0 };
    }

    const exp = Math.min(4000, expenses);
    let calculated = exp <= 2000 ? exp : 2000 + ((exp - 2000) * 0.25);

    const phaseStart = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 160000 : 80000;
    const phaseEnd = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 180000 : 90000;

    calculated = this.applyPhaseout(calculated, magi, phaseStart, phaseEnd);

    const aotcRefundable = calculated * 0.40;
    const aotcNonRefundable = Math.min(calculated * 0.60, capacity);

    return { aotcNonRefundable, aotcRefundable };
  }

  private calculateLlc(expenses: number, filingStatus: FilingStatus, magi: number, capacity: number): number {
    if (expenses <= 0 || filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) return 0;

    const exp = Math.min(10000, expenses);
    let calculated = exp * 0.20;

    const phaseStart = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 160000 : 80000;
    const phaseEnd = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 180000 : 90000;

    calculated = this.applyPhaseout(calculated, magi, phaseStart, phaseEnd);
    return Math.min(calculated, capacity);
  }

  private calculateSaversCredit(iraContribution: number, filingStatus: FilingStatus, agi: number, capacity: number): number {
    if (iraContribution <= 0 || filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) return 0;

    const eligibleContrib = Math.min(2000, iraContribution);
    const creditRate = this.getSaversCreditRate(filingStatus, agi);

    return Math.min(eligibleContrib * creditRate, capacity);
  }

  private getSaversCreditRate(status: FilingStatus, agi: number): number {
    const brackets = SAVERS_CREDIT_BRACKETS[status] ?? SAVERS_CREDIT_BRACKETS.DEFAULT;
    return brackets.find(b => agi <= b.limit)?.rate ?? 0;
  }

  private calculateRefundableCredits(params: {
    profile: TaxpayerProfile;
    filingStatus: FilingStatus;
    taxYear: number;
    adjustedGrossIncome: number;
    totalW2Wages: number;
    netSeIncome: number;
    dividends: DividendIncome;
    taxableInterest: number;
    netCapitalGainOrLoss: number;
    ctcCount: number;
    ctcNonRefundable: number;
    aotcRefundable: number;
  }) {
    let additionalChildTaxCredit = 0;
    if (params.ctcCount > 0) {
      const remainingCtcCapacity = (params.ctcCount * 2000) - params.ctcNonRefundable;
      if (remainingCtcCapacity > 0) {
        const earnedIncome = params.totalW2Wages + params.netSeIncome;
        const actcEarnedLimit = Math.max(0, (earnedIncome - 2500) * 0.15);
        const maxActcPerChild = params.ctcCount * (params.taxYear === 2023 ? 1600 : 1700);
        additionalChildTaxCredit = Math.min(remainingCtcCapacity, Math.min(actcEarnedLimit, maxActcPerChild));
      }
    }

    let earnedIncomeTaxCredit = 0;
    const earnedIncomeForEitc = params.totalW2Wages + params.netSeIncome;
    const investmentIncomeForEitc = params.dividends.ordinaryDividends + params.taxableInterest + Math.max(0, params.netCapitalGainOrLoss);

    if (investmentIncomeForEitc <= 11000 && params.filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY) {
      earnedIncomeTaxCredit = this.calculateEitc(earnedIncomeForEitc, params.adjustedGrossIncome, params.ctcCount, params.filingStatus);
    }

    const total = additionalChildTaxCredit + params.aotcRefundable + earnedIncomeTaxCredit;

    return {
      additionalChildTaxCredit,
      aotcRefundable: params.aotcRefundable,
      earnedIncomeTaxCredit,
      total,
    };
  }

  private calculateUnderpaymentPenalty(balanceDueOrRefund: number, totalTaxPayments: number, refundableCreditsTotal: number, totalFinalTaxLiability: number, profile: TaxpayerProfile): number {
    if (balanceDueOrRefund <= 1000) return 0;

    const netPaymentsWithoutRefundables = totalTaxPayments - refundableCreditsTotal;
    if (netPaymentsWithoutRefundables >= (0.90 * totalFinalTaxLiability)) return 0;

    const safeHarborPriorYear = profile.priorYearAgi > 150000 ? 1.10 * profile.priorYearTotalTax : profile.priorYearTotalTax;
    if (netPaymentsWithoutRefundables < safeHarborPriorYear) {
      return balanceDueOrRefund * 0.08;
    }

    return 0;
  }
}