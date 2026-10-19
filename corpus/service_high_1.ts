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

@Injectable()
export class TaxAssessmentService {
  public assessTaxReturn(submission: TaxReturnSubmission): TaxAssessmentResult {
    if (submission.taxYear !== 2023 && submission.taxYear !== 2024) {
      throw new BadRequestException('Tax assessment engine currently supports tax years 2023 and 2024 only.');
    }

    const totalW2Wages = submission.w2s.reduce((sum, w) => sum + w.wages, 0);
    const totalW2Withholding = submission.w2s.reduce((sum, w) => sum + w.federalTaxWithheld, 0);

    let netSeIncome = 0;
    let totalSeGross = 0;
    for (const se of submission.selfEmployment) {
      totalSeGross += se.grossIncome;
      netSeIncome += (se.grossIncome - se.expenses);
    }
    const seScheduleNet = netSeIncome > 0 ? netSeIncome * 0.9235 : 0;

    let seSocialSecurityTax = 0;
    let seMedicareTax = 0;
    const ssCap = submission.taxYear === 2023 ? 160200 : 168600;

    if (seScheduleNet >= 400) {
      const remainingSsCap = Math.max(0, ssCap - totalW2Wages);
      const ssTaxableSe = Math.min(seScheduleNet, remainingSsCap);
      seSocialSecurityTax = ssTaxableSe * 0.124;
      seMedicareTax = seScheduleNet * 0.029;
    }
    const totalSeTax = seSocialSecurityTax + seMedicareTax;
    const halfSeDeduction = totalSeTax * 0.5;

    let totalMedicareWages = submission.w2s.reduce((sum, w) => sum + w.medicareWages, 0);
    if (netSeIncome > 0) {
      totalMedicareWages += seScheduleNet;
    }

    let addlMedicareThreshold = 200000;
    if (submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      addlMedicareThreshold = 250000;
    } else if (submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
      addlMedicareThreshold = 125000;
    }
    const additionalMedicareTax = Math.max(0, totalMedicareWages - addlMedicareThreshold) * 0.009;

    const netStGains = submission.capitalGains.shortTermGains - submission.capitalGains.shortTermLosses;
    const netLtGains = submission.capitalGains.longTermGains - submission.capitalGains.longTermLosses;

    let netCapitalGainOrLoss = 0;
    let netLtCapitalGainForPreferential = 0;
    let capitalLossDeduction = 0;
    let stLossCarryover = 0;
    let ltLossCarryover = 0;

    if (netStGains >= 0 && netLtGains >= 0) {
      netCapitalGainOrLoss = netStGains + netLtGains;
      netLtCapitalGainForPreferential = netLtGains;
    } else if (netStGains < 0 && netLtGains < 0) {
      const totalLoss = Math.abs(netStGains) + Math.abs(netLtGains);
      const maxLossDeduction = submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 1500 : 3000;
      capitalLossDeduction = -Math.min(totalLoss, maxLossDeduction);
      netCapitalGainOrLoss = capitalLossDeduction;

      let remainingAllowedLoss = Math.abs(capitalLossDeduction);
      const stLossAbs = Math.abs(netStGains);
      if (stLossAbs >= remainingAllowedLoss) {
        stLossCarryover = stLossAbs - remainingAllowedLoss;
        ltLossCarryover = Math.abs(netLtGains);
      } else {
        remainingAllowedLoss -= stLossAbs;
        stLossCarryover = 0;
        ltLossCarryover = Math.abs(netLtGains) - remainingAllowedLoss;
      }
    } else if (netStGains < 0 && netLtGains >= 0) {
      const combined = netLtGains + netStGains;
      if (combined >= 0) {
        netCapitalGainOrLoss = combined;
        netLtCapitalGainForPreferential = combined;
      } else {
        const maxLossDeduction = submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 1500 : 3000;
        capitalLossDeduction = -Math.min(Math.abs(combined), maxLossDeduction);
        netCapitalGainOrLoss = capitalLossDeduction;
        stLossCarryover = Math.abs(combined) - Math.abs(capitalLossDeduction);
      }
    } else {
      const combined = netStGains + netLtGains;
      if (combined >= 0) {
        netCapitalGainOrLoss = combined;
        netLtCapitalGainForPreferential = 0;
      } else {
        const maxLossDeduction = submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 1500 : 3000;
        capitalLossDeduction = -Math.min(Math.abs(combined), maxLossDeduction);
        netCapitalGainOrLoss = capitalLossDeduction;
        ltLossCarryover = Math.abs(combined) - Math.abs(capitalLossDeduction);
      }
    }

    let netRentalIncome = 0;
    for (const rent of submission.rentalIncome) {
      const netRent = rent.grossRent - rent.expenses;
      if (netRent >= 0) {
        netRentalIncome += netRent;
      } else {
        if (rent.activeParticipant) {
          const maxPassiveLoss = submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 12500 : 25000;
          netRentalIncome += Math.max(netRent, -maxPassiveLoss);
        } else {
          netRentalIncome += 0;
        }
      }
    }

    const qualifiedDividends = Math.min(submission.dividends.ordinaryDividends, submission.dividends.qualifiedDividends);
    const nonQualifiedDividends = Math.max(0, submission.dividends.ordinaryDividends - qualifiedDividends);

    const preliminaryGrossIncomeWithoutSS = totalW2Wages + netSeIncome + netCapitalGainOrLoss + submission.dividends.ordinaryDividends + submission.taxableInterest + netRentalIncome;

    let taxableSocialSecurity = 0;
    if (submission.profile.socialSecurityBenefits > 0) {
      const provisionalIncome = preliminaryGrossIncomeWithoutSS + (0.5 * submission.profile.socialSecurityBenefits) + submission.profile.taxExemptInterest;
      let ssBase1 = 25000;
      let ssBase2 = 34000;

      if (submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
        ssBase1 = 32000;
        ssBase2 = 44000;
      } else if (submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
        if (!submission.profile.spouseLivingApartAllYear) {
          ssBase1 = 0;
          ssBase2 = 0;
        }
      }

      if (provisionalIncome > ssBase2) {
        if (ssBase1 === 0) {
          taxableSocialSecurity = Math.min(0.85 * submission.profile.socialSecurityBenefits, 0.85 * provisionalIncome);
        } else {
          const tier1 = 0.5 * (ssBase2 - ssBase1);
          const tier2 = 0.85 * (provisionalIncome - ssBase2);
          taxableSocialSecurity = Math.min(0.85 * submission.profile.socialSecurityBenefits, tier1 + tier2);
        }
      } else if (provisionalIncome > ssBase1) {
        taxableSocialSecurity = Math.min(0.5 * submission.profile.socialSecurityBenefits, 0.5 * (provisionalIncome - ssBase1));
      }
    }

    const totalGrossIncome = preliminaryGrossIncomeWithoutSS + taxableSocialSecurity;

    let hsaDeduction = 0;
    if (submission.profile.hsaCoverageType !== 'NONE') {
      let hsaLimit = submission.profile.hsaCoverageType === 'SELF_ONLY' ? (submission.taxYear === 2023 ? 3850 : 4150) : (submission.taxYear === 2023 ? 7750 : 8300);
      if (submission.profile.age >= 55) {
        hsaLimit += 1000;
      }
      hsaDeduction = Math.min(submission.profile.hsaContribution, hsaLimit);
    }

    let preliminaryMagiForDeductions = Math.max(0, totalGrossIncome - halfSeDeduction - hsaDeduction);

    let studentLoanDeduction = 0;
    if (submission.filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY && submission.profile.studentLoanInterestPaid > 0) {
      const maxStudentLoan = Math.min(2500, submission.profile.studentLoanInterestPaid);
      let phaseoutStart = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 155000 : 75000;
      let phaseoutEnd = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 185000 : 90000;

      if (preliminaryMagiForDeductions <= phaseoutStart) {
        studentLoanDeduction = maxStudentLoan;
      } else if (preliminaryMagiForDeductions < phaseoutEnd) {
        const phaseoutRatio = (preliminaryMagiForDeductions - phaseoutStart) / (phaseoutEnd - phaseoutStart);
        studentLoanDeduction = maxStudentLoan * (1 - phaseoutRatio);
      }
    }

    let iraDeduction = 0;
    if (submission.profile.iraContribution > 0) {
      let maxIra = submission.taxYear === 2023 ? 6500 : 7000;
      if (submission.profile.age >= 50) {
        maxIra += 1000;
      }
      const actualContribution = Math.min(submission.profile.iraContribution, maxIra);

      if (!submission.profile.hasEmployerRetirementPlan && !submission.profile.spouseHasEmployerRetirementPlan) {
        iraDeduction = actualContribution;
      } else if (submission.profile.hasEmployerRetirementPlan) {
        let iraPhaseStart = 73000;
        let iraPhaseEnd = 83000;
        if (submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
          iraPhaseStart = 116000;
          iraPhaseEnd = 136000;
        } else if (submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
          iraPhaseStart = 0;
          iraPhaseEnd = 10000;
        }

        if (preliminaryMagiForDeductions <= iraPhaseStart) {
          iraDeduction = actualContribution;
        } else if (preliminaryMagiForDeductions < iraPhaseEnd) {
          const ratio = (preliminaryMagiForDeductions - iraPhaseStart) / (iraPhaseEnd - iraPhaseStart);
          iraDeduction = actualContribution * (1 - ratio);
        }
      } else if (submission.profile.spouseHasEmployerRetirementPlan && submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
        const iraPhaseStart = 218000;
        const iraPhaseEnd = 228000;
        if (preliminaryMagiForDeductions <= iraPhaseStart) {
          iraDeduction = actualContribution;
        } else if (preliminaryMagiForDeductions < iraPhaseEnd) {
          const ratio = (preliminaryMagiForDeductions - iraPhaseStart) / (iraPhaseEnd - iraPhaseStart);
          iraDeduction = actualContribution * (1 - ratio);
        }
      }
    }

    const totalAboveTheLineDeductions = halfSeDeduction + hsaDeduction + studentLoanDeduction + iraDeduction;
    const adjustedGrossIncome = Math.max(0, totalGrossIncome - totalAboveTheLineDeductions);
    const modifiedAdjustedGrossIncome = adjustedGrossIncome + submission.profile.taxExemptInterest;

    let baseStandardDeduction = 0;
    if (submission.taxYear === 2023) {
      switch (submission.filingStatus) {
        case FilingStatus.SINGLE:
        case FilingStatus.MARRIED_FILING_SEPARATELY:
          baseStandardDeduction = 13850;
          break;
        case FilingStatus.HEAD_OF_HOUSEHOLD:
          baseStandardDeduction = 20800;
          break;
        case FilingStatus.MARRIED_FILING_JOINTLY:
        case FilingStatus.QUALIFYING_SURVIVING_SPOUSE:
          baseStandardDeduction = 27700;
          break;
      }
    } else {
      switch (submission.filingStatus) {
        case FilingStatus.SINGLE:
        case FilingStatus.MARRIED_FILING_SEPARATELY:
          baseStandardDeduction = 14600;
          break;
        case FilingStatus.HEAD_OF_HOUSEHOLD:
          baseStandardDeduction = 21900;
          break;
        case FilingStatus.MARRIED_FILING_JOINTLY:
        case FilingStatus.QUALIFYING_SURVIVING_SPOUSE:
          baseStandardDeduction = 29200;
          break;
      }
    }

    let additionalStandardUnits = 0;
    if (submission.profile.age >= 65) additionalStandardUnits++;
    if (submission.profile.isBlind) additionalStandardUnits++;

    if (submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      if ((submission.profile.spouseAge ?? 0) >= 65) additionalStandardUnits++;
      if (submission.profile.spouseIsBlind) additionalStandardUnits++;
    }

    let additionalStandardAmountPerUnit = 1500;
    if (submission.filingStatus === FilingStatus.SINGLE || submission.filingStatus === FilingStatus.HEAD_OF_HOUSEHOLD) {
      additionalStandardAmountPerUnit = 1850;
    }

    const totalStandardDeduction = baseStandardDeduction + (additionalStandardUnits * additionalStandardAmountPerUnit);

    let totalItemizedDeductions = 0;
    let cashCarryover = 0;
    let nonCashCarryover = 0;

    if (submission.itemizedDeductions) {
      const saltCap = submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 5000 : 10000;
      const stateTaxChoice = Math.max(submission.itemizedDeductions.stateAndLocalIncomeTax, submission.itemizedDeductions.stateAndLocalSalesTax);
      const totalSaltRaw = stateTaxChoice + submission.itemizedDeductions.realEstateTax + submission.itemizedDeductions.personalPropertyTax;
      const deductibleSalt = Math.min(saltCap, totalSaltRaw);

      let deductibleMortgageInterest = submission.itemizedDeductions.mortgageInterest;
      const mortgageCap = submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 375000 : 750000;
      if (submission.itemizedDeductions.mortgagePrincipalBalance > mortgageCap) {
        const ratio = mortgageCap / submission.itemizedDeductions.mortgagePrincipalBalance;
        deductibleMortgageInterest = submission.itemizedDeductions.mortgageInterest * ratio;
      }

      const medicalThreshold = adjustedGrossIncome * 0.075;
      const deductibleMedical = Math.max(0, submission.itemizedDeductions.medicalExpenses - medicalThreshold);

      const cashLimit = adjustedGrossIncome * 0.60;
      const deductibleCashCharity = Math.min(submission.itemizedDeductions.charitableCash, cashLimit);
      cashCarryover = Math.max(0, submission.itemizedDeductions.charitableCash - deductibleCashCharity);

      const nonCashLimit = adjustedGrossIncome * 0.30;
      const deductibleNonCashCharity = Math.min(submission.itemizedDeductions.charitableNonCash, nonCashLimit);
      nonCashCarryover = Math.max(0, submission.itemizedDeductions.charitableNonCash - deductibleNonCashCharity);

      totalItemizedDeductions = deductibleSalt + deductibleMortgageInterest + deductibleMedical + deductibleCashCharity + deductibleNonCashCharity + submission.itemizedDeductions.casualtyLosses;
    }

    let deductionTypeUsed: 'STANDARD' | 'ITEMIZED' = 'STANDARD';
    let finalDeductionAmount = totalStandardDeduction;

    if (submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY && submission.profile.spouseItemizesSeparately) {
      deductionTypeUsed = 'ITEMIZED';
      finalDeductionAmount = totalItemizedDeductions;
    } else if (totalItemizedDeductions > totalStandardDeduction) {
      deductionTypeUsed = 'ITEMIZED';
      finalDeductionAmount = totalItemizedDeductions;
    }

    const taxableIncome = Math.max(0, adjustedGrossIncome - finalDeductionAmount);

    const totalPreferentialIncome = Math.max(0, netLtCapitalGainForPreferential + qualifiedDividends);
    const preferentialTaxableIncome = Math.min(taxableIncome, totalPreferentialIncome);
    const ordinaryTaxableIncome = taxableIncome - preferentialTaxableIncome;

    const ordinaryIncomeTax = this.calculateOrdinaryTax(ordinaryTaxableIncome, submission.filingStatus, submission.taxYear);
    const preferentialIncomeTax = this.calculatePreferentialTax(ordinaryTaxableIncome, preferentialTaxableIncome, submission.filingStatus, submission.taxYear);

    let netInvestmentIncome = Math.max(0, submission.dividends.ordinaryDividends + submission.taxableInterest + netCapitalGainOrLoss + netRentalIncome);
    let niitThreshold = 200000;
    if (submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      niitThreshold = 250000;
    } else if (submission.filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
      niitThreshold = 125000;
    }
    const niitSubjectAmount = Math.min(netInvestmentIncome, Math.max(0, modifiedAdjustedGrossIncome - niitThreshold));
    const netInvestmentIncomeTax = niitSubjectAmount * 0.038;

    let alternativeMinimumTax = 0;
    let amtExemption = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 126500 : 81300;
    let amtPhaseout = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 1156300 : 578150;
    if (modifiedAdjustedGrossIncome > amtPhaseout) {
      amtExemption = Math.max(0, amtExemption - (modifiedAdjustedGrossIncome - amtPhaseout) * 0.25);
    }
    const amtBase = Math.max(0, taxableIncome - amtExemption);
    if (amtBase > 0) {
      const tentativeAmt = amtBase * 0.26;
      if (tentativeAmt > (ordinaryIncomeTax + preferentialIncomeTax)) {
        alternativeMinimumTax = tentativeAmt - (ordinaryIncomeTax + preferentialIncomeTax);
      }
    }

    const totalTaxBeforeCredits = ordinaryIncomeTax + preferentialIncomeTax + totalSeTax + additionalMedicareTax + netInvestmentIncomeTax + alternativeMinimumTax;

    let qualifyingChildrenCountForCtc = 0;
    let qualifyingOtherDependentsCount = 0;

    for (const dep of submission.dependents) {
      if (dep.hasSsn && dep.providedMoreThanHalfOwnSupport === false && dep.monthsLivedWithTaxpayer >= 6) {
        if (dep.age < 17) {
          qualifyingChildrenCountForCtc++;
        } else {
          qualifyingOtherDependentsCount++;
        }
      } else {
        qualifyingOtherDependentsCount++;
      }
    }

    let initialCtc = qualifyingChildrenCountForCtc * 2000;
    let initialOdc = qualifyingOtherDependentsCount * 500;

    let ctcPhaseoutThreshold = 200000;
    if (submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      ctcPhaseoutThreshold = 400000;
    }

    if (adjustedGrossIncome > ctcPhaseoutThreshold) {
      const excess = adjustedGrossIncome - ctcPhaseoutThreshold;
      const reduction = Math.ceil(excess / 1000) * 50;

      if (reduction >= initialOdc) {
        const remainingReduction = reduction - initialOdc;
        initialOdc = 0;
        initialCtc = Math.max(0, initialCtc - remainingReduction);
      } else {
        initialOdc -= reduction;
      }
    }

    let nonRefundableTaxCapacity = ordinaryIncomeTax + preferentialIncomeTax;

    const childTaxCreditNonRefundable = Math.min(initialCtc, nonRefundableTaxCapacity);
    nonRefundableTaxCapacity -= childTaxCreditNonRefundable;

    const creditForOtherDependents = Math.min(initialOdc, nonRefundableTaxCapacity);
    nonRefundableTaxCapacity -= creditForOtherDependents;

    let childAndDependentCareCredit = 0;
    if (submission.profile.childAndDependentCareExpenses > 0 && qualifyingChildrenCountForCtc > 0) {
      const careLimit = qualifyingChildrenCountForCtc === 1 ? 3000 : 6000;
      const eligibleCareExpenses = Math.min(submission.profile.childAndDependentCareExpenses, careLimit);

      let carePercent = 0.20;
      if (adjustedGrossIncome <= 15000) carePercent = 0.35;
      else if (adjustedGrossIncome <= 17000) carePercent = 0.34;
      else if (adjustedGrossIncome <= 19000) carePercent = 0.33;
      else if (adjustedGrossIncome <= 21000) carePercent = 0.32;
      else if (adjustedGrossIncome <= 23000) carePercent = 0.31;
      else if (adjustedGrossIncome <= 25000) carePercent = 0.30;
      else if (adjustedGrossIncome <= 27000) carePercent = 0.29;
      else if (adjustedGrossIncome <= 29000) carePercent = 0.28;
      else if (adjustedGrossIncome <= 31000) carePercent = 0.27;
      else if (adjustedGrossIncome <= 33000) carePercent = 0.26;
      else if (adjustedGrossIncome <= 35000) carePercent = 0.25;
      else if (adjustedGrossIncome <= 37000) carePercent = 0.24;
      else if (adjustedGrossIncome <= 39000) carePercent = 0.23;
      else if (adjustedGrossIncome <= 41000) carePercent = 0.22;
      else if (adjustedGrossIncome <= 43000) carePercent = 0.21;

      const rawCareCredit = eligibleCareExpenses * carePercent;
      childAndDependentCareCredit = Math.min(rawCareCredit, nonRefundableTaxCapacity);
      nonRefundableTaxCapacity -= childAndDependentCareCredit;
    }

    let aotcNonRefundable = 0;
    let aotcRefundable = 0;
    if (submission.profile.qualifyingEducationExpensesAotc > 0 && submission.filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY) {
      const exp = Math.min(4000, submission.profile.qualifyingEducationExpensesAotc);
      let calculatedAotc = 0;
      if (exp <= 2000) {
        calculatedAotc = exp;
      } else {
        calculatedAotc = 2000 + ((exp - 2000) * 0.25);
      }

      let aotcPhaseStart = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 160000 : 80000;
      let aotcPhaseEnd = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 180000 : 90000;

      if (modifiedAdjustedGrossIncome > aotcPhaseEnd) {
        calculatedAotc = 0;
      } else if (modifiedAdjustedGrossIncome > aotcPhaseStart) {
        const ratio = (modifiedAdjustedGrossIncome - aotcPhaseStart) / (aotcPhaseEnd - aotcPhaseStart);
        calculatedAotc = calculatedAotc * (1 - ratio);
      }

      const tentativeRefundable = calculatedAotc * 0.40;
      const tentativeNonRefundable = calculatedAotc * 0.60;

      aotcNonRefundable = Math.min(tentativeNonRefundable, nonRefundableTaxCapacity);
      nonRefundableTaxCapacity -= aotcNonRefundable;
      aotcRefundable = tentativeRefundable;
    }

    let lifetimeLearningCredit = 0;
    if (submission.profile.qualifyingEducationExpensesLlc > 0 && submission.filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY) {
      const exp = Math.min(10000, submission.profile.qualifyingEducationExpensesLlc);
      let calculatedLlc = exp * 0.20;

      let llcPhaseStart = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 160000 : 80000;
      let llcPhaseEnd = submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 180000 : 90000;

      if (modifiedAdjustedGrossIncome > llcPhaseEnd) {
        calculatedLlc = 0;
      } else if (modifiedAdjustedGrossIncome > llcPhaseStart) {
        const ratio = (modifiedAdjustedGrossIncome - llcPhaseStart) / (llcPhaseEnd - llcPhaseStart);
        calculatedLlc = calculatedLlc * (1 - ratio);
      }

      lifetimeLearningCredit = Math.min(calculatedLlc, nonRefundableTaxCapacity);
      nonRefundableTaxCapacity -= lifetimeLearningCredit;
    }

    let saversCredit = 0;
    if (submission.profile.iraContribution > 0 && submission.filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY) {
      const eligibleContrib = Math.min(2000, submission.profile.iraContribution);
      let creditRate = 0;

      if (submission.filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
        if (adjustedGrossIncome <= 43500) creditRate = 0.50;
        else if (adjustedGrossIncome <= 47500) creditRate = 0.20;
        else if (adjustedGrossIncome <= 73000) creditRate = 0.10;
      } else if (submission.filingStatus === FilingStatus.HEAD_OF_HOUSEHOLD) {
        if (adjustedGrossIncome <= 32625) creditRate = 0.50;
        else if (adjustedGrossIncome <= 35625) creditRate = 0.20;
        else if (adjustedGrossIncome <= 54750) creditRate = 0.10;
      } else {
        if (adjustedGrossIncome <= 21750) creditRate = 0.50;
        else if (adjustedGrossIncome <= 23750) creditRate = 0.20;
        else if (adjustedGrossIncome <= 36500) creditRate = 0.10;
      }

      saversCredit = Math.min(eligibleContrib * creditRate, nonRefundableTaxCapacity);
      nonRefundableTaxCapacity -= saversCredit;
    }

    let foreignTaxCredit = 0;
    if (submission.profile.foreignTaxesPaid > 0) {
      foreignTaxCredit = Math.min(submission.profile.foreignTaxesPaid, nonRefundableTaxCapacity);
      nonRefundableTaxCapacity -= foreignTaxCredit;
    }

    let energyEfficientHomeCredit = 0;
    if (submission.profile.energyEfficientHomeExpenses > 0) {
      const rawCredit = Math.min(1200, submission.profile.energyEfficientHomeExpenses * 0.30);
      energyEfficientHomeCredit = Math.min(rawCredit, nonRefundableTaxCapacity);
      nonRefundableTaxCapacity -= energyEfficientHomeCredit;
    }

    const totalNonRefundableCredits = childTaxCreditNonRefundable + creditForOtherDependents + childAndDependentCareCredit + aotcNonRefundable + lifetimeLearningCredit + saversCredit + foreignTaxCredit + energyEfficientHomeCredit;

    let additionalChildTaxCredit = 0;
    if (qualifyingChildrenCountForCtc > 0) {
      const remainingCtcCapacity = (qualifyingChildrenCountForCtc * 2000) - childTaxCreditNonRefundable;
      if (remainingCtcCapacity > 0) {
        const earnedIncome = totalW2Wages + netSeIncome;
        const actcEarnedLimit = Math.max(0, (earnedIncome - 2500) * 0.15);
        const maxActcPerChild = qualifyingChildrenCountForCtc * (submission.taxYear === 2023 ? 1600 : 1700);
        additionalChildTaxCredit = Math.min(remainingCtcCapacity, Math.min(actcEarnedLimit, maxActcPerChild));
      }
    }

    let earnedIncomeTaxCredit = 0;
    const earnedIncomeForEitc = totalW2Wages + netSeIncome;
    const investmentIncomeForEitc = submission.dividends.ordinaryDividends + submission.taxableInterest + Math.max(0, netCapitalGainOrLoss);

    if (investmentIncomeForEitc <= 11000 && submission.filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY) {
      earnedIncomeTaxCredit = this.calculateEitc(earnedIncomeForEitc, adjustedGrossIncome, qualifyingChildrenCountForCtc, submission.filingStatus);
    }

    const totalRefundableCredits = additionalChildTaxCredit + aotcRefundable + earnedIncomeTaxCredit;

    const totalTaxPayments = totalW2Withholding + submission.profile.estimatedTaxPayments + totalRefundableCredits;
    const totalFinalTaxLiability = Math.max(0, totalTaxBeforeCredits - totalNonRefundableCredits);

    const balanceDueOrRefund = totalFinalTaxLiability - totalTaxPayments;

    let underpaymentPenaltyEstimated = 0;
    if (balanceDueOrRefund > 1000 && (totalTaxPayments - totalRefundableCredits) < (0.90 * totalFinalTaxLiability)) {
      const safeHarborPriorYear = submission.profile.priorYearAgi > 150000 ? 1.10 * submission.profile.priorYearTotalTax : submission.profile.priorYearTotalTax;
      if ((totalTaxPayments - totalRefundableCredits) < safeHarborPriorYear) {
        underpaymentPenaltyEstimated = balanceDueOrRefund * 0.08;
      }
    }

    return {
      totalGrossIncome,
      adjustedGrossIncome,
      modifiedAdjustedGrossIncome,
      deductionTypeUsed,
      deductionAmount: finalDeductionAmount,
      charitableCarryover: { cash: cashCarryover, nonCash: nonCashCarryover },
      capitalLossCarryover: { shortTerm: stLossCarryover, longTerm: ltLossCarryover },
      taxableIncome,
      ordinaryTaxableIncome,
      preferentialTaxableIncome,
      ordinaryIncomeTax,
      preferentialIncomeTax,
      selfEmploymentTax: totalSeTax,
      additionalMedicareTax,
      netInvestmentIncomeTax,
      alternativeMinimumTax,
      totalTaxBeforeCredits,
      nonRefundableCredits: {
        childTaxCredit: childTaxCreditNonRefundable,
        creditForOtherDependents,
        childAndDependentCareCredit,
        aotcNonRefundable,
        lifetimeLearningCredit,
        saversCredit,
        foreignTaxCredit,
        energyEfficientHomeCredit,
        total: totalNonRefundableCredits,
      },
      refundableCredits: {
        additionalChildTaxCredit,
        aotcRefundable,
        earnedIncomeTaxCredit,
        total: totalRefundableCredits,
      },
      totalTaxPayments,
      totalFinalTaxLiability,
      balanceDueOrRefund,
      underpaymentPenaltyEstimated,
    };
  }

  private calculateOrdinaryTax(taxableOrdinary: number, status: FilingStatus, year: number): number {
    if (taxableOrdinary <= 0) return 0;

    let brackets: Array<{ rate: number; threshold: number }>;

    if (year === 2023) {
      if (status === FilingStatus.SINGLE || status === FilingStatus.MARRIED_FILING_SEPARATELY) {
        brackets = [
          { rate: 0.10, threshold: 11000 },
          { rate: 0.12, threshold: 44725 },
          { rate: 0.22, threshold: 95375 },
          { rate: 0.24, threshold: 182100 },
          { rate: 0.32, threshold: 231250 },
          { rate: 0.35, threshold: 578125 },
          { rate: 0.37, threshold: Infinity },
        ];
      } else if (status === FilingStatus.MARRIED_FILING_JOINTLY || status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE) {
        brackets = [
          { rate: 0.10, threshold: 22000 },
          { rate: 0.12, threshold: 89450 },
          { rate: 0.22, threshold: 190750 },
          { rate: 0.24, threshold: 364200 },
          { rate: 0.32, threshold: 462500 },
          { rate: 0.35, threshold: 693750 },
          { rate: 0.37, threshold: Infinity },
        ];
      } else {
        brackets = [
          { rate: 0.10, threshold: 15700 },
          { rate: 0.12, threshold: 59850 },
          { rate: 0.22, threshold: 95350 },
          { rate: 0.24, threshold: 182100 },
          { rate: 0.32, threshold: 231250 },
          { rate: 0.35, threshold: 578100 },
          { rate: 0.37, threshold: Infinity },
        ];
      }
    } else {
      if (status === FilingStatus.SINGLE || status === FilingStatus.MARRIED_FILING_SEPARATELY) {
        brackets = [
          { rate: 0.10, threshold: 11600 },
          { rate: 0.12, threshold: 47150 },
          { rate: 0.22, threshold: 100525 },
          { rate: 0.24, threshold: 191950 },
          { rate: 0.32, threshold: 243725 },
          { rate: 0.35, threshold: 609350 },
          { rate: 0.37, threshold: Infinity },
        ];
      } else if (status === FilingStatus.MARRIED_FILING_JOINTLY || status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE) {
        brackets = [
          { rate: 0.10, threshold: 23200 },
          { rate: 0.12, threshold: 94300 },
          { rate: 0.22, threshold: 201050 },
          { rate: 0.24, threshold: 383900 },
          { rate: 0.32, threshold: 487450 },
          { rate: 0.35, threshold: 731200 },
          { rate: 0.37, threshold: Infinity },
        ];
      } else {
        brackets = [
          { rate: 0.10, threshold: 16550 },
          { rate: 0.12, threshold: 63100 },
          { rate: 0.22, threshold: 100500 },
          { rate: 0.24, threshold: 191950 },
          { rate: 0.32, threshold: 243700 },
          { rate: 0.35, threshold: 609350 },
          { rate: 0.37, threshold: Infinity },
        ];
      }
    }

    let tax = 0;
    let previousThreshold = 0;

    for (const b of brackets) {
      if (taxableOrdinary > b.threshold) {
        tax += (b.threshold - previousThreshold) * b.rate;
        previousThreshold = b.threshold;
      } else {
        tax += (taxableOrdinary - previousThreshold) * b.rate;
        break;
      }
    }

    return tax;
  }

  private calculatePreferentialTax(ordinaryTaxable: number, preferentialTaxable: number, status: FilingStatus, year: number): number {
    if (preferentialTaxable <= 0) return 0;

    let zeroCap = 44625;
    let fifteenCap = 492300;

    if (year === 2023) {
      if (status === FilingStatus.MARRIED_FILING_JOINTLY || status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE) {
        zeroCap = 89250;
        fifteenCap = 553850;
      } else if (status === FilingStatus.HEAD_OF_HOUSEHOLD) {
        zeroCap = 59750;
        fifteenCap = 523050;
      } else if (status === FilingStatus.MARRIED_FILING_SEPARATELY) {
        zeroCap = 44625;
        fifteenCap = 276900;
      }
    } else {
      zeroCap = 47025;
      fifteenCap = 518900;
      if (status === FilingStatus.MARRIED_FILING_JOINTLY || status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE) {
        zeroCap = 94050;
        fifteenCap = 583750;
      } else if (status === FilingStatus.HEAD_OF_HOUSEHOLD) {
        zeroCap = 63000;
        fifteenCap = 551350;
      } else if (status === FilingStatus.MARRIED_FILING_SEPARATELY) {
        zeroCap = 47025;
        fifteenCap = 291850;
      }
    }

    const totalIncome = ordinaryTaxable + preferentialTaxable;
    let tax = 0;

    const currentStart = ordinaryTaxable;
    const currentEnd = totalIncome;

    if (currentEnd <= zeroCap) {
      tax += 0;
    } else if (currentStart >= fifteenCap) {
      tax += (currentEnd - currentStart) * 0.20;
    } else if (currentStart >= zeroCap && currentEnd <= fifteenCap) {
      tax += (currentEnd - currentStart) * 0.15;
    } else {
      let remaining = preferentialTaxable;
      let pointer = currentStart;

      if (pointer < zeroCap) {
        const spanInZero = Math.min(remaining, zeroCap - pointer);
        tax += spanInZero * 0;
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
}
