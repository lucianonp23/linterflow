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

interface TaxBrackets {
  brackets: Array<{ rate: number; threshold: number }>;
}

@Injectable()
export class TaxAssessmentService {
  public assessTaxReturn(submission: TaxReturnSubmission): TaxAssessmentResult {
    this.validateTaxYear(submission.taxYear);

    const { totalW2Wages, totalW2Withholding, totalMedicareWagesFromW2 } = this.calculateW2Totals(submission.w2s);
    const netSeIncome = this.calculateNetSelfEmploymentIncome(submission.selfEmployment);
    const seScheduleNet = netSeIncome > 0 ? netSeIncome * 0.9235 : 0;

    const { totalSeTax, halfSeDeduction } = this.calculateSelfEmploymentTax(
      seScheduleNet,
      totalW2Wages,
      submission.taxYear,
    );

    const additionalMedicareTax = this.calculateAdditionalMedicareTax(
      totalMedicareWagesFromW2,
      netSeIncome,
      seScheduleNet,
      submission.filingStatus,
    );

    const capitalGainsResult = this.calculateCapitalGains(
      submission.capitalGains,
      submission.filingStatus,
    );

    const netRentalIncome = this.calculateRentalIncome(
      submission.rentalIncome,
      submission.filingStatus,
    );

    const qualifiedDividends = Math.min(
      submission.dividends.ordinaryDividends,
      submission.dividends.qualifiedDividends,
    );

    const preliminaryGrossIncomeWithoutSS =
      totalW2Wages +
      netSeIncome +
      capitalGainsResult.netCapitalGainOrLoss +
      submission.dividends.ordinaryDividends +
      submission.taxableInterest +
      netRentalIncome;

    const taxableSocialSecurity = this.calculateTaxableSocialSecurity(
      submission.profile.socialSecurityBenefits,
      preliminaryGrossIncomeWithoutSS,
      submission.profile.taxExemptInterest,
      submission.filingStatus,
      submission.profile.spouseLivingApartAllYear,
    );

    const totalGrossIncome = preliminaryGrossIncomeWithoutSS + taxableSocialSecurity;

    const hsaDeduction = this.calculateHsaDeduction(
      submission.profile,
      submission.taxYear,
    );

    const preliminaryMagi = Math.max(0, totalGrossIncome - halfSeDeduction - hsaDeduction);

    const studentLoanDeduction = this.calculateStudentLoanDeduction(
      submission.profile.studentLoanInterestPaid,
      preliminaryMagi,
      submission.filingStatus,
    );

    const iraDeduction = this.calculateIraDeduction(
      submission.profile,
      preliminaryMagi,
      submission.filingStatus,
      submission.taxYear,
    );

    const totalAboveTheLineDeductions =
      halfSeDeduction + hsaDeduction + studentLoanDeduction + iraDeduction;

    const adjustedGrossIncome = Math.max(0, totalGrossIncome - totalAboveTheLineDeductions);
    const modifiedAdjustedGrossIncome = adjustedGrossIncome + submission.profile.taxExemptInterest;

    const deductionResult = this.calculateDeductions(
      submission.profile,
      submission.itemizedDeductions,
      submission.filingStatus,
      submission.taxYear,
      adjustedGrossIncome,
    );

    const taxableIncome = Math.max(0, adjustedGrossIncome - deductionResult.finalDeductionAmount);

    const totalPreferentialIncome = Math.max(
      0,
      capitalGainsResult.netLtCapitalGainForPreferential + qualifiedDividends,
    );
    const preferentialTaxableIncome = Math.min(taxableIncome, totalPreferentialIncome);
    const ordinaryTaxableIncome = taxableIncome - preferentialTaxableIncome;

    const ordinaryIncomeTax = this.calculateOrdinaryTax(
      ordinaryTaxableIncome,
      submission.filingStatus,
      submission.taxYear,
    );
    const preferentialIncomeTax = this.calculatePreferentialTax(
      ordinaryTaxableIncome,
      preferentialTaxableIncome,
      submission.filingStatus,
      submission.taxYear,
    );

    const netInvestmentIncomeTax = this.calculateNetInvestmentIncomeTax(
      submission.dividends.ordinaryDividends,
      submission.taxableInterest,
      capitalGainsResult.netCapitalGainOrLoss,
      netRentalIncome,
      modifiedAdjustedGrossIncome,
      submission.filingStatus,
    );

    const alternativeMinimumTax = this.calculateAlternativeMinimumTax(
      modifiedAdjustedGrossIncome,
      taxableIncome,
      ordinaryIncomeTax + preferentialIncomeTax,
      submission.filingStatus,
    );

    const totalTaxBeforeCredits =
      ordinaryIncomeTax +
      preferentialIncomeTax +
      totalSeTax +
      additionalMedicareTax +
      netInvestmentIncomeTax +
      alternativeMinimumTax;

    const { qualifyingChildrenCountForCtc, qualifyingOtherDependentsCount } =
      this.categorizeDependents(submission.dependents);

    const nonRefundableCreditsResult = this.calculateNonRefundableCredits({
      ordinaryIncomeTax,
      preferentialIncomeTax,
      qualifyingChildrenCountForCtc,
      qualifyingOtherDependentsCount,
      adjustedGrossIncome,
      modifiedAdjustedGrossIncome,
      filingStatus: submission.filingStatus,
      profile: submission.profile,
    });

    const refundableCreditsResult = this.calculateRefundableCredits({
      qualifyingChildrenCountForCtc,
      childTaxCreditNonRefundable: nonRefundableCreditsResult.childTaxCredit,
      totalW2Wages,
      netSeIncome,
      adjustedGrossIncome,
      ordinaryDividends: submission.dividends.ordinaryDividends,
      taxableInterest: submission.taxableInterest,
      netCapitalGainOrLoss: capitalGainsResult.netCapitalGainOrLoss,
      filingStatus: submission.filingStatus,
      taxYear: submission.taxYear,
      aotcRefundable: nonRefundableCreditsResult.aotcRefundable,
    });

    const totalTaxPayments =
      totalW2Withholding +
      submission.profile.estimatedTaxPayments +
      refundableCreditsResult.total;

    const totalFinalTaxLiability = Math.max(
      0,
      totalTaxBeforeCredits - nonRefundableCreditsResult.total,
    );

    const balanceDueOrRefund = totalFinalTaxLiability - totalTaxPayments;

    const underpaymentPenaltyEstimated = this.calculateUnderpaymentPenalty(
      balanceDueOrRefund,
      totalTaxPayments,
      refundableCreditsResult.total,
      totalFinalTaxLiability,
      submission.profile.priorYearAgi,
      submission.profile.priorYearTotalTax,
    );

    return {
      totalGrossIncome,
      adjustedGrossIncome,
      modifiedAdjustedGrossIncome,
      deductionTypeUsed: deductionResult.deductionTypeUsed,
      deductionAmount: deductionResult.finalDeductionAmount,
      charitableCarryover: deductionResult.charitableCarryover,
      capitalLossCarryover: capitalGainsResult.carryover,
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
      nonRefundableCredits: nonRefundableCreditsResult.credits,
      refundableCredits: refundableCreditsResult.credits,
      totalTaxPayments,
      totalFinalTaxLiability,
      balanceDueOrRefund,
      underpaymentPenaltyEstimated,
    };
  }

  private validateTaxYear(year: number): void {
    if (year !== 2023 && year !== 2024) {
      throw new BadRequestException(
        'Tax assessment engine currently supports tax years 2023 and 2024 only.',
      );
    }
  }

  private calculateW2Totals(w2s: W2Income[]): {
    totalW2Wages: number;
    totalW2Withholding: number;
    totalMedicareWagesFromW2: number;
  } {
    return w2s.reduce(
      (acc, w) => ({
        totalW2Wages: acc.totalW2Wages + w.wages,
        totalW2Withholding: acc.totalW2Withholding + w.federalTaxWithheld,
        totalMedicareWagesFromW2: acc.totalMedicareWagesFromW2 + w.medicareWages,
      }),
      { totalW2Wages: 0, totalW2Withholding: 0, totalMedicareWagesFromW2: 0 },
    );
  }

  private calculateNetSelfEmploymentIncome(seIncome: SelfEmploymentIncome[]): number {
    return seIncome.reduce((sum, se) => sum + (se.grossIncome - se.expenses), 0);
  }

  private calculateSelfEmploymentTax(
    seScheduleNet: number,
    totalW2Wages: number,
    taxYear: number,
  ): { totalSeTax: number; halfSeDeduction: number } {
    if (seScheduleNet < 400) {
      return { totalSeTax: 0, halfSeDeduction: 0 };
    }

    const ssCap = taxYear === 2023 ? 160200 : 168600;
    const remainingSsCap = Math.max(0, ssCap - totalW2Wages);
    const ssTaxableSe = Math.min(seScheduleNet, remainingSsCap);

    const seSocialSecurityTax = ssTaxableSe * 0.124;
    const seMedicareTax = seScheduleNet * 0.029;
    const totalSeTax = seSocialSecurityTax + seMedicareTax;

    return { totalSeTax, halfSeDeduction: totalSeTax * 0.5 };
  }

  private calculateAdditionalMedicareTax(
    totalMedicareWagesFromW2: number,
    netSeIncome: number,
    seScheduleNet: number,
    filingStatus: FilingStatus,
  ): number {
    let totalMedicareWages = totalMedicareWagesFromW2;
    if (netSeIncome > 0) {
      totalMedicareWages += seScheduleNet;
    }

    let addlMedicareThreshold = 200000;
    if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      addlMedicareThreshold = 250000;
    } else if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
      addlMedicareThreshold = 125000;
    }

    return Math.max(0, totalMedicareWages - addlMedicareThreshold) * 0.009;
  }

  private calculateCapitalGains(
    capitalGains: CapitalGains,
    filingStatus: FilingStatus,
  ): {
    netCapitalGainOrLoss: number;
    netLtCapitalGainForPreferential: number;
    carryover: { shortTerm: number; longTerm: number };
  } {
    const netStGains = capitalGains.shortTermGains - capitalGains.shortTermLosses;
    const netLtGains = capitalGains.longTermGains - capitalGains.longTermLosses;
    const maxLossDeduction =
      filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 1500 : 3000;

    let netCapitalGainOrLoss = 0;
    let netLtCapitalGainForPreferential = 0;
    let stLossCarryover = 0;
    let ltLossCarryover = 0;

    if (netStGains >= 0 && netLtGains >= 0) {
      netCapitalGainOrLoss = netStGains + netLtGains;
      netLtCapitalGainForPreferential = netLtGains;
    } else if (netStGains < 0 && netLtGains < 0) {
      const totalLoss = Math.abs(netStGains) + Math.abs(netLtGains);
      const capitalLossDeduction = -Math.min(totalLoss, maxLossDeduction);
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
        const capitalLossDeduction = -Math.min(Math.abs(combined), maxLossDeduction);
        netCapitalGainOrLoss = capitalLossDeduction;
        stLossCarryover = Math.abs(combined) - Math.abs(capitalLossDeduction);
      }
    } else {
      const combined = netStGains + netLtGains;
      if (combined >= 0) {
        netCapitalGainOrLoss = combined;
        netLtCapitalGainForPreferential = 0;
      } else {
        const capitalLossDeduction = -Math.min(Math.abs(combined), maxLossDeduction);
        netCapitalGainOrLoss = capitalLossDeduction;
        ltLossCarryover = Math.abs(combined) - Math.abs(capitalLossDeduction);
      }
    }

    return {
      netCapitalGainOrLoss,
      netLtCapitalGainForPreferential,
      carryover: { shortTerm: stLossCarryover, longTerm: ltLossCarryover },
    };
  }

  private calculateRentalIncome(
    rentals: RentalIncome[],
    filingStatus: FilingStatus,
  ): number {
    const maxPassiveLoss =
      filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 12500 : 25000;

    return rentals.reduce((total, rent) => {
      const netRent = rent.grossRent - rent.expenses;
      if (netRent >= 0) {
        return total + netRent;
      }
      return rent.activeParticipant ? total + Math.max(netRent, -maxPassiveLoss) : total;
    }, 0);
  }

  private calculateTaxableSocialSecurity(
    ssBenefits: number,
    preliminaryGrossIncome: number,
    taxExemptInterest: number,
    filingStatus: FilingStatus,
    spouseLivingApartAllYear?: boolean,
  ): number {
    if (ssBenefits <= 0) return 0;

    const provisionalIncome = preliminaryGrossIncome + 0.5 * ssBenefits + taxExemptInterest;
    let ssBase1 = 25000;
    let ssBase2 = 34000;

    if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      ssBase1 = 32000;
      ssBase2 = 44000;
    } else if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY && !spouseLivingApartAllYear) {
      ssBase1 = 0;
      ssBase2 = 0;
    }

    if (provisionalIncome > ssBase2) {
      if (ssBase1 === 0) {
        return Math.min(0.85 * ssBenefits, 0.85 * provisionalIncome);
      }
      const tier1 = 0.5 * (ssBase2 - ssBase1);
      const tier2 = 0.85 * (provisionalIncome - ssBase2);
      return Math.min(0.85 * ssBenefits, tier1 + tier2);
    }
    if (provisionalIncome > ssBase1) {
      return Math.min(0.5 * ssBenefits, 0.5 * (provisionalIncome - ssBase1));
    }

    return 0;
  }

  private calculateHsaDeduction(profile: TaxpayerProfile, taxYear: number): number {
    if (profile.hsaCoverageType === 'NONE') return 0;

    let hsaLimit =
      profile.hsaCoverageType === 'SELF_ONLY'
        ? taxYear === 2023 ? 3850 : 4150
        : taxYear === 2023 ? 7750 : 8300;

    if (profile.age >= 55) {
      hsaLimit += 1000;
    }

    return Math.min(profile.hsaContribution, hsaLimit);
  }

  private calculateStudentLoanDeduction(
    paid: number,
    magi: number,
    filingStatus: FilingStatus,
  ): number {
    if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY || paid <= 0) {
      return 0;
    }

    const maxDeduction = Math.min(2500, paid);
    const phaseoutStart = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 155000 : 75000;
    const phaseoutEnd = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 185000 : 90000;

    if (magi <= phaseoutStart) {
      return maxDeduction;
    }
    if (magi < phaseoutEnd) {
      const ratio = (magi - phaseoutStart) / (phaseoutEnd - phaseoutStart);
      return maxDeduction * (1 - ratio);
    }

    return 0;
  }

  private calculateIraDeduction(
    profile: TaxpayerProfile,
    magi: number,
    filingStatus: FilingStatus,
    taxYear: number,
  ): number {
    if (profile.iraContribution <= 0) return 0;

    let maxIra = taxYear === 2023 ? 6500 : 7000;
    if (profile.age >= 50) maxIra += 1000;

    const actualContribution = Math.min(profile.iraContribution, maxIra);

    if (!profile.hasEmployerRetirementPlan && !profile.spouseHasEmployerRetirementPlan) {
      return actualContribution;
    }

    if (profile.hasEmployerRetirementPlan) {
      let phaseStart = 73000;
      let phaseEnd = 83000;

      if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
        phaseStart = 116000;
        phaseEnd = 136000;
      } else if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
        phaseStart = 0;
        phaseEnd = 10000;
      }

      if (magi <= phaseStart) return actualContribution;
      if (magi < phaseEnd) {
        const ratio = (magi - phaseStart) / (phaseEnd - phaseStart);
        return actualContribution * (1 - ratio);
      }
      return 0;
    }

    if (profile.spouseHasEmployerRetirementPlan && filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      const phaseStart = 218000;
      const phaseEnd = 228000;

      if (magi <= phaseStart) return actualContribution;
      if (magi < phaseEnd) {
        const ratio = (magi - phaseStart) / (phaseEnd - phaseStart);
        return actualContribution * (1 - ratio);
      }
    }

    return 0;
  }

  private calculateDeductions(
    profile: TaxpayerProfile,
    itemized: ItemizedDeductions | undefined,
    filingStatus: FilingStatus,
    taxYear: number,
    agi: number,
  ): {
    deductionTypeUsed: 'STANDARD' | 'ITEMIZED';
    finalDeductionAmount: number;
    charitableCarryover: { cash: number; nonCash: number };
  } {
    const totalStandardDeduction = this.calculateStandardDeduction(
      profile,
      filingStatus,
      taxYear,
    );

    let totalItemizedDeductions = 0;
    let cashCarryover = 0;
    let nonCashCarryover = 0;

    if (itemized) {
      const saltCap = filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 5000 : 10000;
      const stateTaxChoice = Math.max(itemized.stateAndLocalIncomeTax, itemized.stateAndLocalSalesTax);
      const totalSaltRaw = stateTaxChoice + itemized.realEstateTax + itemized.personalPropertyTax;
      const deductibleSalt = Math.min(saltCap, totalSaltRaw);

      let deductibleMortgageInterest = itemized.mortgageInterest;
      const mortgageCap = filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY ? 375000 : 750000;
      if (itemized.mortgagePrincipalBalance > mortgageCap) {
        const ratio = mortgageCap / itemized.mortgagePrincipalBalance;
        deductibleMortgageInterest = itemized.mortgageInterest * ratio;
      }

      const medicalThreshold = agi * 0.075;
      const deductibleMedical = Math.max(0, itemized.medicalExpenses - medicalThreshold);

      const cashLimit = agi * 0.60;
      const deductibleCashCharity = Math.min(itemized.charitableCash, cashLimit);
      cashCarryover = Math.max(0, itemized.charitableCash - deductibleCashCharity);

      const nonCashLimit = agi * 0.30;
      const deductibleNonCashCharity = Math.min(itemized.charitableNonCash, nonCashLimit);
      nonCashCarryover = Math.max(0, itemized.charitableNonCash - deductibleNonCashCharity);

      totalItemizedDeductions =
        deductibleSalt +
        deductibleMortgageInterest +
        deductibleMedical +
        deductibleCashCharity +
        deductibleNonCashCharity +
        itemized.casualtyLosses;
    }

    const forceItemized =
      filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY &&
      profile.spouseItemizesSeparately;

    if (forceItemized || totalItemizedDeductions > totalStandardDeduction) {
      return {
        deductionTypeUsed: 'ITEMIZED',
        finalDeductionAmount: totalItemizedDeductions,
        charitableCarryover: { cash: cashCarryover, nonCash: nonCashCarryover },
      };
    }

    return {
      deductionTypeUsed: 'STANDARD',
      finalDeductionAmount: totalStandardDeduction,
      charitableCarryover: { cash: cashCarryover, nonCash: nonCashCarryover },
    };
  }

  private calculateStandardDeduction(
    profile: TaxpayerProfile,
    filingStatus: FilingStatus,
    taxYear: number,
  ): number {
    let base = 0;
    if (taxYear === 2023) {
      switch (filingStatus) {
        case FilingStatus.SINGLE:
        case FilingStatus.MARRIED_FILING_SEPARATELY:
          base = 13850;
          break;
        case FilingStatus.HEAD_OF_HOUSEHOLD:
          base = 20800;
          break;
        case FilingStatus.MARRIED_FILING_JOINTLY:
        case FilingStatus.QUALIFYING_SURVIVING_SPOUSE:
          base = 27700;
          break;
      }
    } else {
      switch (filingStatus) {
        case FilingStatus.SINGLE:
        case FilingStatus.MARRIED_FILING_SEPARATELY:
          base = 14600;
          break;
        case FilingStatus.HEAD_OF_HOUSEHOLD:
          base = 21900;
          break;
        case FilingStatus.MARRIED_FILING_JOINTLY:
        case FilingStatus.QUALIFYING_SURVIVING_SPOUSE:
          base = 29200;
          break;
      }
    }

    let additionalUnits = 0;
    if (profile.age >= 65) additionalUnits++;
    if (profile.isBlind) additionalUnits++;

    if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      if ((profile.spouseAge ?? 0) >= 65) additionalUnits++;
      if (profile.spouseIsBlind) additionalUnits++;
    }

    const unitAmount =
      filingStatus === FilingStatus.SINGLE || filingStatus === FilingStatus.HEAD_OF_HOUSEHOLD
        ? 1850
        : 1500;

    return base + additionalUnits * unitAmount;
  }

  private calculateNetInvestmentIncomeTax(
    ordinaryDividends: number,
    taxableInterest: number,
    netCapitalGainOrLoss: number,
    netRentalIncome: number,
    magi: number,
    filingStatus: FilingStatus,
  ): number {
    const netInvestmentIncome = Math.max(
      0,
      ordinaryDividends + taxableInterest + netCapitalGainOrLoss + netRentalIncome,
    );

    let niitThreshold = 200000;
    if (filingStatus === FilingStatus.MARRIED_FILING_JOINTLY) {
      niitThreshold = 250000;
    } else if (filingStatus === FilingStatus.MARRIED_FILING_SEPARATELY) {
      niitThreshold = 125000;
    }

    const niitSubjectAmount = Math.min(
      netInvestmentIncome,
      Math.max(0, magi - niitThreshold),
    );

    return niitSubjectAmount * 0.038;
  }

  private calculateAlternativeMinimumTax(
    magi: number,
    taxableIncome: number,
    regularTax: number,
    filingStatus: FilingStatus,
  ): number {
    let amtExemption = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 126500 : 81300;
    const amtPhaseout = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 1156300 : 578150;

    if (magi > amtPhaseout) {
      amtExemption = Math.max(0, amtExemption - (magi - amtPhaseout) * 0.25);
    }

    const amtBase = Math.max(0, taxableIncome - amtExemption);
    if (amtBase > 0) {
      const tentativeAmt = amtBase * 0.26;
      if (tentativeAmt > regularTax) {
        return tentativeAmt - regularTax;
      }
    }

    return 0;
  }

  private categorizeDependents(dependents: DependentInfo[]): {
    qualifyingChildrenCountForCtc: number;
    qualifyingOtherDependentsCount: number;
  } {
    let ctcCount = 0;
    let odcCount = 0;

    for (const dep of dependents) {
      if (dep.hasSsn && !dep.providedMoreThanHalfOwnSupport && dep.monthsLivedWithTaxpayer >= 6) {
        if (dep.age < 17) {
          ctcCount++;
        } else {
          odcCount++;
        }
      } else {
        odcCount++;
      }
    }

    return {
      qualifyingChildrenCountForCtc: ctcCount,
      qualifyingOtherDependentsCount: odcCount,
    };
  }

  private calculateNonRefundableCredits(params: {
    ordinaryIncomeTax: number;
    preferentialIncomeTax: number;
    qualifyingChildrenCountForCtc: number;
    qualifyingOtherDependentsCount: number;
    adjustedGrossIncome: number;
    modifiedAdjustedGrossIncome: number;
    filingStatus: FilingStatus;
    profile: TaxpayerProfile;
  }): {
    childTaxCredit: number;
    aotcRefundable: number;
    total: number;
    credits: TaxAssessmentResult['nonRefundableCredits'];
  } {
    const {
      ordinaryIncomeTax,
      preferentialIncomeTax,
      qualifyingChildrenCountForCtc,
      qualifyingOtherDependentsCount,
      adjustedGrossIncome,
      modifiedAdjustedGrossIncome,
      filingStatus,
      profile,
    } = params;

    let initialCtc = qualifyingChildrenCountForCtc * 2000;
    let initialOdc = qualifyingOtherDependentsCount * 500;
    const ctcPhaseoutThreshold =
      filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 400000 : 200000;

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

    let capacity = ordinaryIncomeTax + preferentialIncomeTax;

    const childTaxCredit = Math.min(initialCtc, capacity);
    capacity -= childTaxCredit;

    const creditForOtherDependents = Math.min(initialOdc, capacity);
    capacity -= creditForOtherDependents;

    let childAndDependentCareCredit = 0;
    if (profile.childAndDependentCareExpenses > 0 && qualifyingChildrenCountForCtc > 0) {
      const careLimit = qualifyingChildrenCountForCtc === 1 ? 3000 : 6000;
      const eligibleExpenses = Math.min(profile.childAndDependentCareExpenses, careLimit);
      const carePercent = this.getCareCreditPercentage(adjustedGrossIncome);
      const rawCareCredit = eligibleExpenses * carePercent;

      childAndDependentCareCredit = Math.min(rawCareCredit, capacity);
      capacity -= childAndDependentCareCredit;
    }

    let aotcNonRefundable = 0;
    let aotcRefundable = 0;
    if (
      profile.qualifyingEducationExpensesAotc > 0 &&
      filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY
    ) {
      const exp = Math.min(4000, profile.qualifyingEducationExpensesAotc);
      let calculatedAotc = exp <= 2000 ? exp : 2000 + (exp - 2000) * 0.25;

      const phaseStart = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 160000 : 80000;
      const phaseEnd = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 180000 : 90000;

      if (modifiedAdjustedGrossIncome > phaseEnd) {
        calculatedAotc = 0;
      } else if (modifiedAdjustedGrossIncome > phaseStart) {
        const ratio = (modifiedAdjustedGrossIncome - phaseStart) / (phaseEnd - phaseStart);
        calculatedAotc *= 1 - ratio;
      }

      aotcRefundable = calculatedAotc * 0.40;
      aotcNonRefundable = Math.min(calculatedAotc * 0.60, capacity);
      capacity -= aotcNonRefundable;
    }

    let lifetimeLearningCredit = 0;
    if (
      profile.qualifyingEducationExpensesLlc > 0 &&
      filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY
    ) {
      const exp = Math.min(10000, profile.qualifyingEducationExpensesLlc);
      let calculatedLlc = exp * 0.20;

      const phaseStart = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 160000 : 80000;
      const phaseEnd = filingStatus === FilingStatus.MARRIED_FILING_JOINTLY ? 180000 : 90000;

      if (modifiedAdjustedGrossIncome > phaseEnd) {
        calculatedLlc = 0;
      } else if (modifiedAdjustedGrossIncome > phaseStart) {
        const ratio = (modifiedAdjustedGrossIncome - phaseStart) / (phaseEnd - phaseStart);
        calculatedLlc *= 1 - ratio;
      }

      lifetimeLearningCredit = Math.min(calculatedLlc, capacity);
      capacity -= lifetimeLearningCredit;
    }

    let saversCredit = 0;
    if (profile.iraContribution > 0 && filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY) {
      const eligibleContrib = Math.min(2000, profile.iraContribution);
      const creditRate = this.getSaversCreditRate(adjustedGrossIncome, filingStatus);

      saversCredit = Math.min(eligibleContrib * creditRate, capacity);
      capacity -= saversCredit;
    }

    let foreignTaxCredit = 0;
    if (profile.foreignTaxesPaid > 0) {
      foreignTaxCredit = Math.min(profile.foreignTaxesPaid, capacity);
      capacity -= foreignTaxCredit;
    }

    let energyEfficientHomeCredit = 0;
    if (profile.energyEfficientHomeExpenses > 0) {
      const rawCredit = Math.min(1200, profile.energyEfficientHomeExpenses * 0.30);
      energyEfficientHomeCredit = Math.min(rawCredit, capacity);
      capacity -= energyEfficientHomeCredit;
    }

    const total =
      childTaxCredit +
      creditForOtherDependents +
      childAndDependentCareCredit +
      aotcNonRefundable +
      lifetimeLearningCredit +
      saversCredit +
      foreignTaxCredit +
      energyEfficientHomeCredit;

    return {
      childTaxCredit,
      aotcRefundable,
      total,
      credits: {
        childTaxCredit,
        creditForOtherDependents,
        childAndDependentCareCredit,
        aotcNonRefundable,
        lifetimeLearningCredit,
        saversCredit,
        foreignTaxCredit,
        energyEfficientHomeCredit,
        total,
      },
    };
  }

  private getCareCreditPercentage(agi: number): number {
    if (agi <= 15000) return 0.35;
    if (agi <= 17000) return 0.34;
    if (agi <= 19000) return 0.33;
    if (agi <= 21000) return 0.32;
    if (agi <= 23000) return 0.31;
    if (agi <= 25000) return 0.30;
    if (agi <= 27000) return 0.29;
    if (agi <= 29000) return 0.28;
    if (agi <= 31000) return 0.27;
    if (agi <= 33000) return 0.26;
    if (agi <= 35000) return 0.25;
    if (agi <= 37000) return 0.24;
    if (agi <= 39000) return 0.23;
    if (agi <= 41000) return 0.22;
    if (agi <= 43000) return 0.21;
    return 0.20;
  }

  private getSaversCreditRate(agi: number, status: FilingStatus): number {
    if (status === FilingStatus.MARRIED_FILING_JOINTLY) {
      if (agi <= 43500) return 0.50;
      if (agi <= 47500) return 0.20;
      if (agi <= 73000) return 0.10;
      return 0;
    }
    if (status === FilingStatus.HEAD_OF_HOUSEHOLD) {
      if (agi <= 32625) return 0.50;
      if (agi <= 35625) return 0.20;
      if (agi <= 54750) return 0.10;
      return 0;
    }
    if (agi <= 21750) return 0.50;
    if (agi <= 23750) return 0.20;
    if (agi <= 36500) return 0.10;
    return 0;
  }

  private calculateRefundableCredits(params: {
    qualifyingChildrenCountForCtc: number;
    childTaxCreditNonRefundable: number;
    totalW2Wages: number;
    netSeIncome: number;
    adjustedGrossIncome: number;
    ordinaryDividends: number;
    taxableInterest: number;
    netCapitalGainOrLoss: number;
    filingStatus: FilingStatus;
    taxYear: number;
    aotcRefundable: number;
  }): {
    total: number;
    credits: TaxAssessmentResult['refundableCredits'];
  } {
    const {
      qualifyingChildrenCountForCtc,
      childTaxCreditNonRefundable,
      totalW2Wages,
      netSeIncome,
      adjustedGrossIncome,
      ordinaryDividends,
      taxableInterest,
      netCapitalGainOrLoss,
      filingStatus,
      taxYear,
      aotcRefundable,
    } = params;

    let additionalChildTaxCredit = 0;
    if (qualifyingChildrenCountForCtc > 0) {
      const remainingCtcCapacity =
        qualifyingChildrenCountForCtc * 2000 - childTaxCreditNonRefundable;

      if (remainingCtcCapacity > 0) {
        const earnedIncome = totalW2Wages + netSeIncome;
        const actcEarnedLimit = Math.max(0, (earnedIncome - 2500) * 0.15);
        const maxActcPerChild =
          qualifyingChildrenCountForCtc * (taxYear === 2023 ? 1600 : 1700);
        additionalChildTaxCredit = Math.min(
          remainingCtcCapacity,
          Math.min(actcEarnedLimit, maxActcPerChild),
        );
      }
    }

    let earnedIncomeTaxCredit = 0;
    const earnedIncomeForEitc = totalW2Wages + netSeIncome;
    const investmentIncomeForEitc =
      ordinaryDividends + taxableInterest + Math.max(0, netCapitalGainOrLoss);

    if (
      investmentIncomeForEitc <= 11000 &&
      filingStatus !== FilingStatus.MARRIED_FILING_SEPARATELY
    ) {
      earnedIncomeTaxCredit = this.calculateEitc(
        earnedIncomeForEitc,
        adjustedGrossIncome,
        qualifyingChildrenCountForCtc,
        filingStatus,
      );
    }

    const total = additionalChildTaxCredit + aotcRefundable + earnedIncomeTaxCredit;

    return {
      total,
      credits: {
        additionalChildTaxCredit,
        aotcRefundable,
        earnedIncomeTaxCredit,
        total,
      },
    };
  }

  private calculateUnderpaymentPenalty(
    balanceDueOrRefund: number,
    totalTaxPayments: number,
    totalRefundableCredits: number,
    totalFinalTaxLiability: number,
    priorYearAgi: number,
    priorYearTotalTax: number,
  ): number {
    const paymentsExcludingRefundable = totalTaxPayments - totalRefundableCredits;

    if (
      balanceDueOrRefund > 1000 &&
      paymentsExcludingRefundable < 0.90 * totalFinalTaxLiability
    ) {
      const safeHarborPriorYear =
        priorYearAgi > 150000 ? 1.10 * priorYearTotalTax : priorYearTotalTax;

      if (paymentsExcludingRefundable < safeHarborPriorYear) {
        return balanceDueOrRefund * 0.08;
      }
    }

    return 0;
  }

  private calculateOrdinaryTax(
    taxableOrdinary: number,
    status: FilingStatus,
    year: number,
  ): number {
    if (taxableOrdinary <= 0) return 0;

    const brackets = this.getOrdinaryTaxBrackets(status, year);
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

  private getOrdinaryTaxBrackets(
    status: FilingStatus,
    year: number,
  ): Array<{ rate: number; threshold: number }> {
    if (year === 2023) {
      if (status === FilingStatus.SINGLE || status === FilingStatus.MARRIED_FILING_SEPARATELY) {
        return [
          { rate: 0.10, threshold: 11000 },
          { rate: 0.12, threshold: 44725 },
          { rate: 0.22, threshold: 95375 },
          { rate: 0.24, threshold: 182100 },
          { rate: 0.32, threshold: 231250 },
          { rate: 0.35, threshold: 578125 },
          { rate: 0.37, threshold: Infinity },
        ];
      }
      if (
        status === FilingStatus.MARRIED_FILING_JOINTLY ||
        status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE
      ) {
        return [
          { rate: 0.10, threshold: 22000 },
          { rate: 0.12, threshold: 89450 },
          { rate: 0.22, threshold: 190750 },
          { rate: 0.24, threshold: 364200 },
          { rate: 0.32, threshold: 462500 },
          { rate: 0.35, threshold: 693750 },
          { rate: 0.37, threshold: Infinity },
        ];
      }
      return [
        { rate: 0.10, threshold: 15700 },
        { rate: 0.12, threshold: 59850 },
        { rate: 0.22, threshold: 95350 },
        { rate: 0.24, threshold: 182100 },
        { rate: 0.32, threshold: 231250 },
        { rate: 0.35, threshold: 578100 },
        { rate: 0.37, threshold: Infinity },
      ];
    }

    if (status === FilingStatus.SINGLE || status === FilingStatus.MARRIED_FILING_SEPARATELY) {
      return [
        { rate: 0.10, threshold: 11600 },
        { rate: 0.12, threshold: 47150 },
        { rate: 0.22, threshold: 100525 },
        { rate: 0.24, threshold: 191950 },
        { rate: 0.32, threshold: 243725 },
        { rate: 0.35, threshold: 609350 },
        { rate: 0.37, threshold: Infinity },
      ];
    }
    if (
      status === FilingStatus.MARRIED_FILING_JOINTLY ||
      status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE
    ) {
      return [
        { rate: 0.10, threshold: 23200 },
        { rate: 0.12, threshold: 94300 },
        { rate: 0.22, threshold: 201050 },
        { rate: 0.24, threshold: 383900 },
        { rate: 0.32, threshold: 487450 },
        { rate: 0.35, threshold: 731200 },
        { rate: 0.37, threshold: Infinity },
      ];
    }
    return [
      { rate: 0.10, threshold: 16550 },
      { rate: 0.12, threshold: 63100 },
      { rate: 0.22, threshold: 100500 },
      { rate: 0.24, threshold: 191950 },
      { rate: 0.32, threshold: 243700 },
      { rate: 0.35, threshold: 609350 },
      { rate: 0.37, threshold: Infinity },
    ];
  }

  private calculatePreferentialTax(
    ordinaryTaxable: number,
    preferentialTaxable: number,
    status: FilingStatus,
    year: number,
  ): number {
    if (preferentialTaxable <= 0) return 0;

    const { zeroCap, fifteenCap } = this.getPreferentialCaps(status, year);
    const totalIncome = ordinaryTaxable + preferentialTaxable;
    const currentStart = ordinaryTaxable;
    const currentEnd = totalIncome;

    if (currentEnd <= zeroCap) {
      return 0;
    }
    if (currentStart >= fifteenCap) {
      return (currentEnd - currentStart) * 0.20;
    }
    if (currentStart >= zeroCap && currentEnd <= fifteenCap) {
      return (currentEnd - currentStart) * 0.15;
    }

    let tax = 0;
    let remaining = preferentialTaxable;
    let pointer = currentStart;

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

  private getPreferentialCaps(
    status: FilingStatus,
    year: number,
  ): { zeroCap: number; fifteenCap: number } {
    if (year === 2023) {
      if (
        status === FilingStatus.MARRIED_FILING_JOINTLY ||
        status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE
      ) {
        return { zeroCap: 89250, fifteenCap: 553850 };
      }
      if (status === FilingStatus.HEAD_OF_HOUSEHOLD) {
        return { zeroCap: 59750, fifteenCap: 523050 };
      }
      if (status === FilingStatus.MARRIED_FILING_SEPARATELY) {
        return { zeroCap: 44625, fifteenCap: 276900 };
      }
      return { zeroCap: 44625, fifteenCap: 492300 };
    }

    if (
      status === FilingStatus.MARRIED_FILING_JOINTLY ||
      status === FilingStatus.QUALIFYING_SURVIVING_SPOUSE
    ) {
      return { zeroCap: 94050, fifteenCap: 583750 };
    }
    if (status === FilingStatus.HEAD_OF_HOUSEHOLD) {
      return { zeroCap: 63000, fifteenCap: 551350 };
    }
    if (status === FilingStatus.MARRIED_FILING_SEPARATELY) {
      return { zeroCap: 47025, fifteenCap: 291850 };
    }
    return { zeroCap: 47025, fifteenCap: 518900 };
  }

  private calculateEitc(
    earnedIncome: number,
    agi: number,
    children: number,
    status: FilingStatus,
  ): number {
    const basisIncome = Math.max(earnedIncome, agi);

    let maxCredit = 600;
    let phaseoutStart = 9800;
    let maxIncome = 17640;

    if (children === 1) {
      maxCredit = 3995;
      phaseoutStart = 21560;
      maxIncome = 46560;
    } else if (children === 2) {
      maxCredit = 6604;
      phaseoutStart = 21560;
      maxIncome = 52918;
    } else if (children >= 3) {
      maxCredit = 7430;
      phaseoutStart = 21560;
      maxIncome = 56838;
    }

    if (status === FilingStatus.MARRIED_FILING_JOINTLY) {
      phaseoutStart += 6580;
      maxIncome += 6580;
    }

    if (basisIncome >= maxIncome) return 0;
    if (basisIncome <= phaseoutStart) return maxCredit;

    const phaseoutRange = maxIncome - phaseoutStart;
    const excess = basisIncome - phaseoutStart;
    const reductionRatio = excess / phaseoutRange;

    return Math.max(0, maxCredit * (1 - reductionRatio));
  }
}