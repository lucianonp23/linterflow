import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

export enum LoanType {
  CONVENTIONAL = 'CONVENTIONAL',
  FHA = 'FHA',
  VA = 'VA',
  USDA = 'USDA',
}

export enum PropertyType {
  SINGLE_FAMILY = 'SINGLE_FAMILY',
  MULTI_FAMILY = 'MULTI_FAMILY',
  CONDO = 'CONDO',
  MANUFACTURED = 'MANUFACTURED',
  COMMERCIAL = 'COMMERCIAL',
}

export enum OccupancyType {
  PRIMARY_RESIDENCE = 'PRIMARY_RESIDENCE',
  SECONDARY_HOME = 'SECONDARY_HOME',
  INVESTMENT_PROPERTY = 'INVESTMENT_PROPERTY',
}

export enum EmploymentStatus {
  FULL_TIME = 'FULL_TIME',
  PART_TIME = 'PART_TIME',
  SELF_EMPLOYED = 'SELF_EMPLOYED',
  RETIRED = 'RETIRED',
  UNEMPLOYED = 'UNEMPLOYED',
}

export enum BankruptcyType {
  NONE = 'NONE',
  CHAPTER_7 = 'CHAPTER_7',
  CHAPTER_13 = 'CHAPTER_13',
}

export enum EligibilityStatus {
  APPROVED = 'APPROVED',
  CONDITIONAL_APPROVAL = 'CONDITIONAL_APPROVAL',
  MANUAL_UNDERWRITING_REQUIRED = 'MANUAL_UNDERWRITING_REQUIRED',
  DECLINED = 'DECLINED',
}

export interface IncomeSource {
  type: string;
  monthlyAmount: number;
  isGuaranteed: boolean;
  yearsReceived: number;
}

export interface LiabilityItem {
  name: string;
  monthlyPayment: number;
  remainingMonths: number;
  isRealEstateLiability: boolean;
}

export interface CreateMortgageApplicationDto {
  applicantId: string;
  applicantName: string;
  creditScore: number;
  grossMonthlyIncome: number;
  additionalIncomes?: IncomeSource[];
  monthlyDebts: number;
  detailedLiabilities?: LiabilityItem[];
  loanAmount: number;
  propertyValue: number;
  downPaymentAmount: number;
  loanTermYears: number;
  loanType: LoanType;
  propertyType: PropertyType;
  occupancyType: OccupancyType;
  employmentStatus: EmploymentStatus;
  employmentDurationMonths: number;
  isFirstTimeHomebuyer: boolean;
  isVeteran: boolean;
  bankruptcyType: BankruptcyType;
  monthsSinceBankruptcy?: number;
  hasForeclosureHistory: boolean;
  monthsSinceForeclosure?: number;
  liquidAssets: number;
  isUsdaEligibleRuralArea?: boolean;
  monthlyHoaFee?: number;
  numberOfUnits?: number;
  hasCoSigner?: boolean;
  coSignerCreditScore?: number;
}

export interface UpdateMortgageApplicationDto extends Partial<CreateMortgageApplicationDto> {}

export interface ApplicationQueryFilter {
  applicantId?: string;
  loanType?: LoanType;
  propertyType?: PropertyType;
  status?: EligibilityStatus;
  minCreditScore?: number;
  maxDti?: number;
  maxLtv?: number;
}

export interface DetailedAssessment {
  status: EligibilityStatus;
  calculatedDti: number;
  calculatedLtv: number;
  calculatedCltv: number;
  estimatedInterestRate: number;
  monthlyHousingPayment: number;
  requiredReserveMonths: number;
  actualReserveMonths: number;
  rejectionReasons: string[];
  conditions: string[];
  riskWarnings: string[];
  appliedRules: string[];
}

export interface MortgageApplicationEntity {
  id: string;
  applicantId: string;
  applicantName: string;
  creditScore: number;
  grossMonthlyIncome: number;
  additionalIncomes: IncomeSource[];
  monthlyDebts: number;
  detailedLiabilities: LiabilityItem[];
  loanAmount: number;
  propertyValue: number;
  downPaymentAmount: number;
  loanTermYears: number;
  loanType: LoanType;
  propertyType: PropertyType;
  occupancyType: OccupancyType;
  employmentStatus: EmploymentStatus;
  employmentDurationMonths: number;
  isFirstTimeHomebuyer: boolean;
  isVeteran: boolean;
  bankruptcyType: BankruptcyType;
  monthsSinceBankruptcy: number;
  hasForeclosureHistory: boolean;
  monthsSinceForeclosure: number;
  liquidAssets: number;
  isUsdaEligibleRuralArea: boolean;
  monthlyHoaFee: number;
  numberOfUnits: number;
  hasCoSigner: boolean;
  coSignerCreditScore: number;
  assessment: DetailedAssessment;
  createdAt: Date;
  updatedAt: Date;
}

interface EvaluationContext {
  data: Omit<MortgageApplicationEntity, 'assessment'>;
  rejectionReasons: string[];
  conditions: string[];
  riskWarnings: string[];
  appliedRules: string[];
  effectiveCreditScore: number;
  totalMonthlyIncome: number;
  totalMonthlyLiabilities: number;
  calculatedLtv: number;
  calculatedCltv: number;
  estimatedInterestRate: number;
  monthlyHousingPayment: number;
  calculatedDti: number;
  actualReserveMonths: number;
  requiredReserveMonths: number;
}

interface FieldValidationRule {
  isValid: (dto: Partial<CreateMortgageApplicationDto>) => boolean;
  message: string;
}

const BASIC_FIELD_VALIDATIONS: FieldValidationRule[] = [
  {
    isValid: (dto) => dto.grossMonthlyIncome === undefined || dto.grossMonthlyIncome > 0,
    message: 'Gross monthly income must be greater than zero.',
  },
  {
    isValid: (dto) => dto.propertyValue === undefined || dto.propertyValue > 0,
    message: 'Property value must be greater than zero.',
  },
  {
    isValid: (dto) => dto.loanAmount === undefined || dto.loanAmount > 0,
    message: 'Loan amount must be greater than zero.',
  },
  {
    isValid: (dto) => dto.creditScore === undefined || (dto.creditScore >= 300 && dto.creditScore <= 850),
    message: 'Credit score must be between 300 and 850.',
  },
  {
    isValid: (dto) =>
      !dto.hasCoSigner ||
      dto.coSignerCreditScore === undefined ||
      (dto.coSignerCreditScore >= 300 && dto.coSignerCreditScore <= 850),
    message: 'Co-signer credit score must be between 300 and 850.',
  },
];

function withDefault<T>(value: T | undefined | null | 0 | false, defaultValue: T): T {
  return value || defaultValue;
}

const CREDIT_SCORE_RATE_TIERS: Array<{ minScore: number; adjustment: number }> = [
  { minScore: 760, adjustment: -0.5 },
  { minScore: 720, adjustment: -0.25 },
  { minScore: 680, adjustment: 0.0 },
  { minScore: 640, adjustment: 0.5 },
  { minScore: 620, adjustment: 1.0 },
  { minScore: 0, adjustment: 2.0 },
];

const LTV_RATE_TIERS: Array<{ minLtv: number; adjustment: number }> = [
  { minLtv: 90, adjustment: 0.375 },
  { minLtv: 80, adjustment: 0.125 },
];

const LOAN_TYPE_RATE_ADJUSTMENTS: Partial<Record<LoanType, number>> = {
  [LoanType.FHA]: -0.25,
  [LoanType.VA]: -0.375,
  [LoanType.USDA]: -0.125,
};

const OCCUPANCY_TYPE_RATE_ADJUSTMENTS: Partial<Record<OccupancyType, number>> = {
  [OccupancyType.INVESTMENT_PROPERTY]: 0.75,
  [OccupancyType.SECONDARY_HOME]: 0.375,
};

const PROPERTY_TYPE_RATE_ADJUSTMENTS: Partial<Record<PropertyType, number>> = {
  [PropertyType.CONDO]: 0.125,
  [PropertyType.MANUFACTURED]: 0.5,
  [PropertyType.MULTI_FAMILY]: 0.25,
};

function getCreditScoreAdjustment(score: number): number {
  for (const tier of CREDIT_SCORE_RATE_TIERS) {
    if (score >= tier.minScore) {
      return tier.adjustment;
    }
  }
  return 2.0;
}

function getLtvAdjustment(ltv: number): number {
  for (const tier of LTV_RATE_TIERS) {
    if (ltv > tier.minLtv) {
      return tier.adjustment;
    }
  }
  return 0;
}

function processIncome(
  grossIncome: number,
  additionalIncomes: IncomeSource[] | undefined,
  conditions: string[],
  riskWarnings: string[],
  appliedRules: string[]
): number {
  let total = grossIncome;
  if (!additionalIncomes || additionalIncomes.length === 0) {
    return total;
  }
  for (const inc of additionalIncomes) {
    if (inc.isGuaranteed && inc.yearsReceived >= 2) {
      total += inc.monthlyAmount;
      appliedRules.push(`ADDITIONAL_INCOME_ACCEPTED_${inc.type.toUpperCase()}`);
    } else if (inc.isGuaranteed && inc.yearsReceived < 2) {
      conditions.push(`Provide proof of continuous income for source: ${inc.type}`);
      riskWarnings.push(`Additional income source ${inc.type} has less than 2 years history.`);
    } else {
      riskWarnings.push(`Unverified or non-guaranteed income source excluded: ${inc.type}`);
    }
  }
  return total;
}

function processLiabilities(
  monthlyDebts: number,
  detailedLiabilities: LiabilityItem[] | undefined,
  appliedRules: string[]
): number {
  if (!detailedLiabilities || detailedLiabilities.length === 0) {
    return monthlyDebts;
  }
  let calculatedLiabilities = 0;
  for (const liability of detailedLiabilities) {
    if (liability.remainingMonths <= 10 && !liability.isRealEstateLiability) {
      appliedRules.push(`LIABILITY_EXCLUDED_SHORT_TERM_${liability.name}`);
      continue;
    }
    calculatedLiabilities += liability.monthlyPayment;
  }
  if (calculatedLiabilities > monthlyDebts) {
    appliedRules.push('DETAILED_LIABILITIES_OVERRODE_SUMMARY');
    return calculatedLiabilities;
  }
  return monthlyDebts;
}

function checkCommercialProperty(ctx: EvaluationContext): void {
  if (ctx.data.propertyType === PropertyType.COMMERCIAL) {
    ctx.rejectionReasons.push('Commercial properties are ineligible for residential mortgage engine.');
    ctx.appliedRules.push('RULE_REJECT_COMMERCIAL');
  }
}

function checkEmployedContinuity(ctx: EvaluationContext): void {
  if (ctx.data.employmentDurationMonths < 24) {
    ctx.conditions.push('Provide VOE (Verification of Employment) and previous 2 years W-2 forms.');
    if (ctx.data.employmentDurationMonths < 6) {
      ctx.riskWarnings.push('Employment duration under 6 months triggers strict probability of continuance check.');
    }
    ctx.appliedRules.push('RULE_CHECK_EMPLOYMENT_CONTINUITY');
  }
}

const EMPLOYMENT_RULES: Record<EmploymentStatus, (ctx: EvaluationContext) => void> = {
  [EmploymentStatus.UNEMPLOYED]: (ctx) => {
    ctx.rejectionReasons.push('Applicant is currently unemployed.');
    ctx.appliedRules.push('RULE_REJECT_UNEMPLOYED');
  },
  [EmploymentStatus.SELF_EMPLOYED]: (ctx) => {
    if (ctx.data.employmentDurationMonths < 12) {
      ctx.rejectionReasons.push('Self-employed applicants require at least 12 months of operating history.');
      ctx.appliedRules.push('RULE_REJECT_SELF_EMPLOYED_UNDER_12M');
    } else if (ctx.data.employmentDurationMonths < 24) {
      ctx.conditions.push('Provide 2 years of audited P&L statements and business tax returns.');
      ctx.riskWarnings.push('Self-employed between 12-24 months requires manual tax verification.');
      ctx.appliedRules.push('RULE_CONDITIONAL_SELF_EMPLOYED_12_24M');
    } else {
      ctx.appliedRules.push('RULE_PASS_SELF_EMPLOYED_24M');
    }
  },
  [EmploymentStatus.FULL_TIME]: checkEmployedContinuity,
  [EmploymentStatus.PART_TIME]: checkEmployedContinuity,
  [EmploymentStatus.RETIRED]: (ctx) => {
    ctx.conditions.push('Provide pension, social security award letters or 401k/IRA distribution proof.');
    ctx.appliedRules.push('RULE_RETIRED_VERIFICATION');
  },
};

function evaluateEmploymentStatus(ctx: EvaluationContext): void {
  const handler = EMPLOYMENT_RULES[ctx.data.employmentStatus];
  if (handler) {
    handler(ctx);
  }
}

const LOAN_TYPE_RULES: Record<LoanType, (ctx: EvaluationContext) => void> = {
  [LoanType.CONVENTIONAL]: (ctx) => {
    if (ctx.effectiveCreditScore < 620) {
      ctx.rejectionReasons.push('Conventional loan requires a minimum credit score of 620.');
      ctx.appliedRules.push('RULE_REJECT_CONVENTIONAL_CREDIT');
    }
  },
  [LoanType.FHA]: (ctx) => {
    if (ctx.effectiveCreditScore < 500) {
      ctx.rejectionReasons.push('FHA loan requires a minimum credit score of 500.');
      ctx.appliedRules.push('RULE_REJECT_FHA_CREDIT_BELOW_500');
    } else if (ctx.effectiveCreditScore < 580) {
      if (ctx.calculatedLtv > 90) {
        ctx.rejectionReasons.push('FHA applicants with credit score 500-579 require a minimum 10% down payment (Max 90% LTV).');
        ctx.appliedRules.push('RULE_REJECT_FHA_500_579_LTV');
      } else {
        ctx.conditions.push('FHA Credit Score between 500-579 requires manual underwriting approval.');
        ctx.appliedRules.push('RULE_MANUAL_FHA_500_579');
      }
    }
  },
  [LoanType.VA]: (ctx) => {
    if (!ctx.data.isVeteran) {
      ctx.rejectionReasons.push('VA loans are restricted to eligible military veterans or active service members.');
      ctx.appliedRules.push('RULE_REJECT_VA_NON_VETERAN');
    }
    if (ctx.effectiveCreditScore < 580) {
      ctx.rejectionReasons.push('VA loan requires a minimum credit score of 580.');
      ctx.appliedRules.push('RULE_REJECT_VA_CREDIT');
    }
  },
  [LoanType.USDA]: (ctx) => {
    if (!ctx.data.isUsdaEligibleRuralArea) {
      ctx.rejectionReasons.push('USDA loans require the property to be located in a designated rural area.');
      ctx.appliedRules.push('RULE_REJECT_USDA_LOCATION');
    }
    if (ctx.effectiveCreditScore < 640) {
      ctx.rejectionReasons.push('USDA loan requires a minimum credit score of 640.');
      ctx.appliedRules.push('RULE_REJECT_USDA_CREDIT');
    }
    if (ctx.data.occupancyType !== OccupancyType.PRIMARY_RESIDENCE) {
      ctx.rejectionReasons.push('USDA loans are strictly for primary residences.');
      ctx.appliedRules.push('RULE_REJECT_USDA_OCCUPANCY');
    }
  },
};

function evaluateLoanType(ctx: EvaluationContext): void {
  const handler = LOAN_TYPE_RULES[ctx.data.loanType];
  if (handler) {
    handler(ctx);
  }
}

const SINGLE_FAMILY_RULES: Partial<Record<OccupancyType, (ctx: EvaluationContext) => void>> = {
  [OccupancyType.PRIMARY_RESIDENCE]: (ctx) => {
    if (ctx.data.loanType === LoanType.CONVENTIONAL) {
      const maxLtvSingle = ctx.data.isFirstTimeHomebuyer ? 97 : 95;
      if (ctx.calculatedLtv > maxLtvSingle) {
        ctx.rejectionReasons.push(`Conventional Single Family Primary residence max LTV is ${maxLtvSingle}%.`);
      }
    }
  },
  [OccupancyType.SECONDARY_HOME]: (ctx) => {
    if (ctx.data.loanType === LoanType.CONVENTIONAL) {
      if (ctx.calculatedLtv > 90) {
        ctx.rejectionReasons.push('Conventional Second Home max LTV is 90%.');
      }
    } else {
      ctx.rejectionReasons.push('Government loans (FHA/VA/USDA) do not allow Second Home occupancy.');
    }
  },
  [OccupancyType.INVESTMENT_PROPERTY]: (ctx) => {
    if (ctx.data.loanType === LoanType.CONVENTIONAL) {
      if (ctx.calculatedLtv > 85) {
        ctx.rejectionReasons.push('Conventional Investment Single Family max LTV is 85%.');
      }
    } else {
      ctx.rejectionReasons.push('Government loans (FHA/VA/USDA) do not allow Investment properties.');
    }
  },
};

function evaluateSingleFamily(ctx: EvaluationContext): void {
  const handler = SINGLE_FAMILY_RULES[ctx.data.occupancyType];
  if (handler) {
    handler(ctx);
  }
}

const CONDO_MAX_LTV: Partial<Record<OccupancyType, { maxLtv: number; message: string }>> = {
  [OccupancyType.PRIMARY_RESIDENCE]: { maxLtv: 90, message: 'Conventional Condo Primary max LTV is 90%.' },
  [OccupancyType.SECONDARY_HOME]: { maxLtv: 80, message: 'Conventional Condo Second Home max LTV is 80%.' },
  [OccupancyType.INVESTMENT_PROPERTY]: { maxLtv: 75, message: 'Conventional Condo Investment max LTV is 75%.' },
};

function evaluateCondo(ctx: EvaluationContext): void {
  ctx.conditions.push('Subject to condo project questionnaire and HOA budget review.');
  if (ctx.data.monthlyHoaFee <= 0) {
    ctx.riskWarnings.push('Condo property missing monthly HOA fee; calculated payment may be understated.');
  }
  if (ctx.data.loanType === LoanType.CONVENTIONAL) {
    const rule = CONDO_MAX_LTV[ctx.data.occupancyType];
    if (rule && ctx.calculatedLtv > rule.maxLtv) {
      ctx.rejectionReasons.push(rule.message);
    }
  }
}

function evaluateMultiFamily(ctx: EvaluationContext): void {
  if (ctx.data.numberOfUnits > 4) {
    ctx.rejectionReasons.push('Multi-family properties exceeding 4 units are considered commercial.');
    ctx.appliedRules.push('RULE_REJECT_MULTIFAMILY_UNITS');
  }
  if (ctx.data.occupancyType === OccupancyType.INVESTMENT_PROPERTY) {
    if (ctx.data.loanType === LoanType.CONVENTIONAL && ctx.calculatedLtv > 75) {
      ctx.rejectionReasons.push('Conventional Multi-Family Investment max LTV is 75%.');
    }
  } else if (ctx.data.occupancyType === OccupancyType.PRIMARY_RESIDENCE) {
    if (ctx.data.loanType === LoanType.CONVENTIONAL && ctx.calculatedLtv > 85) {
      ctx.rejectionReasons.push('Conventional Multi-Family Primary max LTV is 85%.');
    }
  }
}

function evaluateManufactured(ctx: EvaluationContext): void {
  if (ctx.data.occupancyType !== OccupancyType.PRIMARY_RESIDENCE) {
    ctx.rejectionReasons.push('Manufactured housing must be occupied as primary residence.');
  }
  if (ctx.data.loanType === LoanType.CONVENTIONAL && ctx.calculatedLtv > 80) {
    ctx.rejectionReasons.push('Conventional Manufactured Home max LTV is 80%.');
  } else if (ctx.data.loanType === LoanType.FHA && ctx.calculatedLtv > 90) {
    ctx.rejectionReasons.push('FHA Manufactured Home max LTV is 90%.');
  }
  ctx.conditions.push('Property must be permanently affixed to a HUD-compliant foundation.');
}

const PROPERTY_TYPE_RULES: Partial<Record<PropertyType, (ctx: EvaluationContext) => void>> = {
  [PropertyType.SINGLE_FAMILY]: evaluateSingleFamily,
  [PropertyType.CONDO]: evaluateCondo,
  [PropertyType.MULTI_FAMILY]: evaluateMultiFamily,
  [PropertyType.MANUFACTURED]: evaluateManufactured,
};

function evaluatePropertyType(ctx: EvaluationContext): void {
  const handler = PROPERTY_TYPE_RULES[ctx.data.propertyType];
  if (handler) {
    handler(ctx);
  }
}

function evaluateChapter7(ctx: EvaluationContext): void {
  switch (ctx.data.loanType) {
    case LoanType.CONVENTIONAL:
      if (ctx.data.monthsSinceBankruptcy < 48) {
        ctx.rejectionReasons.push(`Chapter 7 Bankruptcy requires 48 months seasoning for Conventional loans (actual: ${ctx.data.monthsSinceBankruptcy}m).`);
        ctx.appliedRules.push('RULE_REJECT_CH7_CONVENTIONAL');
      }
      break;
    case LoanType.FHA:
    case LoanType.VA:
      if (ctx.data.monthsSinceBankruptcy < 24) {
        ctx.rejectionReasons.push(`Chapter 7 Bankruptcy requires 24 months seasoning for FHA/VA loans (actual: ${ctx.data.monthsSinceBankruptcy}m).`);
        ctx.appliedRules.push('RULE_REJECT_CH7_FHA_VA');
      }
      break;
    case LoanType.USDA:
      if (ctx.data.monthsSinceBankruptcy < 36) {
        ctx.rejectionReasons.push(`Chapter 7 Bankruptcy requires 36 months seasoning for USDA loans (actual: ${ctx.data.monthsSinceBankruptcy}m).`);
        ctx.appliedRules.push('RULE_REJECT_CH7_USDA');
      }
      break;
  }
}

function evaluateChapter13(ctx: EvaluationContext): void {
  switch (ctx.data.loanType) {
    case LoanType.CONVENTIONAL:
      if (ctx.data.monthsSinceBankruptcy < 24) {
        ctx.rejectionReasons.push('Chapter 13 Bankruptcy requires 24 months seasoning from discharge for Conventional loans.');
        ctx.appliedRules.push('RULE_REJECT_CH13_CONVENTIONAL');
      }
      break;
    case LoanType.FHA:
    case LoanType.VA:
      if (ctx.data.monthsSinceBankruptcy < 12) {
        ctx.rejectionReasons.push('Chapter 13 Bankruptcy requires at least 12 months satisfactory payments and court approval for FHA/VA.');
        ctx.appliedRules.push('RULE_REJECT_CH13_FHA_VA');
      } else {
        ctx.conditions.push('Provide bankruptcy trustee written approval for new mortgage debt.');
      }
      break;
    case LoanType.USDA:
      if (ctx.data.monthsSinceBankruptcy < 24) {
        ctx.rejectionReasons.push('Chapter 13 Bankruptcy requires 24 months seasoning for USDA loans.');
        ctx.appliedRules.push('RULE_REJECT_CH13_USDA');
      }
      break;
  }
}

function evaluateBankruptcy(ctx: EvaluationContext): void {
  if (ctx.data.bankruptcyType === BankruptcyType.NONE) {
    return;
  }
  if (ctx.data.bankruptcyType === BankruptcyType.CHAPTER_7) {
    evaluateChapter7(ctx);
  } else if (ctx.data.bankruptcyType === BankruptcyType.CHAPTER_13) {
    evaluateChapter13(ctx);
  }
}

function evaluateForeclosure(ctx: EvaluationContext): void {
  if (!ctx.data.hasForeclosureHistory) {
    return;
  }
  switch (ctx.data.loanType) {
    case LoanType.CONVENTIONAL:
      if (ctx.data.monthsSinceForeclosure < 84) {
        ctx.rejectionReasons.push(`Foreclosure requires 84 months (7 years) seasoning for Conventional loans (actual: ${ctx.data.monthsSinceForeclosure}m).`);
        ctx.appliedRules.push('RULE_REJECT_FORECLOSURE_CONVENTIONAL');
      }
      break;
    case LoanType.FHA:
    case LoanType.USDA:
      if (ctx.data.monthsSinceForeclosure < 36) {
        ctx.rejectionReasons.push(`Foreclosure requires 36 months seasoning for FHA/USDA loans (actual: ${ctx.data.monthsSinceForeclosure}m).`);
        ctx.appliedRules.push('RULE_REJECT_FORECLOSURE_FHA_USDA');
      }
      break;
    case LoanType.VA:
      if (ctx.data.monthsSinceForeclosure < 24) {
        ctx.rejectionReasons.push(`Foreclosure requires 24 months seasoning for VA loans (actual: ${ctx.data.monthsSinceForeclosure}m).`);
        ctx.appliedRules.push('RULE_REJECT_FORECLOSURE_VA');
      }
      break;
  }
}

function evaluateReserveRequirements(ctx: EvaluationContext): void {
  let requiredReserveMonths = 0;

  if (ctx.data.occupancyType === OccupancyType.INVESTMENT_PROPERTY) {
    requiredReserveMonths += 6;
  } else if (ctx.data.occupancyType === OccupancyType.SECONDARY_HOME) {
    requiredReserveMonths += 2;
  }

  if (ctx.data.propertyType === PropertyType.MULTI_FAMILY) {
    requiredReserveMonths += (ctx.data.numberOfUnits - 1) * 2;
  }

  if (ctx.data.employmentStatus === EmploymentStatus.SELF_EMPLOYED && ctx.data.employmentDurationMonths < 24) {
    requiredReserveMonths += 3;
  }

  if (ctx.calculatedDti > 43) {
    requiredReserveMonths += 2;
  }

  if (ctx.data.loanAmount > 726200) {
    requiredReserveMonths += 6;
    ctx.appliedRules.push('RULE_JUMBO_RESERVES_APPLIED');
  }

  ctx.requiredReserveMonths = requiredReserveMonths;

  if (ctx.actualReserveMonths < requiredReserveMonths) {
    if (ctx.data.occupancyType === OccupancyType.INVESTMENT_PROPERTY) {
      ctx.rejectionReasons.push(`Investment property requires ${requiredReserveMonths} months reserves (actual: ${ctx.actualReserveMonths.toFixed(1)}m).`);
      ctx.appliedRules.push('RULE_REJECT_RESERVES_INVESTMENT');
    } else {
      ctx.conditions.push(`Provide proof of additional liquid assets to meet ${requiredReserveMonths} months reserve requirement.`);
      ctx.riskWarnings.push(`Reserve shortfall: Has ${ctx.actualReserveMonths.toFixed(1)} months, requires ${requiredReserveMonths} months.`);
      ctx.appliedRules.push('RULE_CONDITION_RESERVES_SHORTFALL');
    }
  }
}

interface DtiCompensatingRule {
  isApplicable: (ctx: EvaluationContext) => boolean;
  factor: number;
  ruleName: string;
}

const DTI_COMPENSATING_RULES: DtiCompensatingRule[] = [
  {
    isApplicable: (ctx) => ctx.effectiveCreditScore >= 740,
    factor: 3,
    ruleName: 'DTI_COMP_FACTOR_HIGH_CREDIT',
  },
  {
    isApplicable: (ctx) => ctx.actualReserveMonths >= ctx.requiredReserveMonths + 6,
    factor: 2,
    ruleName: 'DTI_COMP_FACTOR_EXTRA_RESERVES',
  },
  {
    isApplicable: (ctx) => ctx.calculatedLtv <= 70,
    factor: 2,
    ruleName: 'DTI_COMP_FACTOR_LOW_LTV',
  },
  {
    isApplicable: (ctx) => ctx.data.loanType === LoanType.FHA && ctx.effectiveCreditScore >= 680,
    factor: 3,
    ruleName: 'DTI_COMP_FACTOR_FHA_HIGH_CREDIT',
  },
];

function calculateMaxAllowedDti(ctx: EvaluationContext): number {
  let factors = 0;
  for (const rule of DTI_COMPENSATING_RULES) {
    if (rule.isApplicable(ctx)) {
      factors += rule.factor;
      ctx.appliedRules.push(rule.ruleName);
    }
  }
  return Math.min(50, 43 + factors);
}

function handleOver50Dti(ctx: EvaluationContext): void {
  const isVaException =
    ctx.data.loanType === LoanType.VA &&
    ctx.effectiveCreditScore >= 720 &&
    ctx.actualReserveMonths >= 6;

  if (isVaException) {
    ctx.conditions.push('DTI exceeds 50% but VA residual income check passed. Requires manual underwriting signoff.');
    ctx.appliedRules.push('RULE_VA_HIGH_DTI_EXCEPTION');
  } else {
    ctx.rejectionReasons.push(`DTI of ${ctx.calculatedDti.toFixed(2)}% exceeds the absolute limit of 50.00%.`);
    ctx.appliedRules.push('RULE_REJECT_DTI_HARD_CAP');
  }
}

function evaluateDti(ctx: EvaluationContext): void {
  const maxAllowedDti = calculateMaxAllowedDti(ctx);

  if (ctx.calculatedDti > 50) {
    handleOver50Dti(ctx);
  } else if (ctx.calculatedDti > maxAllowedDti) {
    ctx.rejectionReasons.push(`DTI of ${ctx.calculatedDti.toFixed(2)}% exceeds calculated maximum threshold of ${maxAllowedDti.toFixed(2)}%.`);
    ctx.appliedRules.push('RULE_REJECT_DTI_THESHOLD');
  } else if (ctx.calculatedDti > 43) {
    ctx.conditions.push(`DTI is ${ctx.calculatedDti.toFixed(2)}% (above 43%). Mandatory automated underwriting system (AUS) approval required.`);
    ctx.appliedRules.push('RULE_CONDITION_HIGH_DTI_AUS');
  }

  if (ctx.calculatedLtv > 80 && ctx.data.loanType === LoanType.CONVENTIONAL) {
    ctx.conditions.push('Private Mortgage Insurance (PMI) approval is required.');
  }
}

function determineFinalStatus(ctx: EvaluationContext): EligibilityStatus {
  if (ctx.rejectionReasons.length > 0) {
    return EligibilityStatus.DECLINED;
  }

  const requiresDeeperReview =
    ctx.effectiveCreditScore < 640 ||
    ctx.calculatedDti > 45 ||
    ctx.data.employmentStatus === EmploymentStatus.SELF_EMPLOYED ||
    ctx.data.bankruptcyType !== BankruptcyType.NONE ||
    ctx.data.hasForeclosureHistory;

  if (requiresDeeperReview) {
    if (ctx.conditions.length > 0) {
      return EligibilityStatus.MANUAL_UNDERWRITING_REQUIRED;
    }
    return EligibilityStatus.CONDITIONAL_APPROVAL;
  }

  if (ctx.conditions.length > 0) {
    return EligibilityStatus.CONDITIONAL_APPROVAL;
  }

  return EligibilityStatus.APPROVED;
}

const EVALUATION_PIPELINE: Array<(ctx: EvaluationContext) => void> = [
  checkCommercialProperty,
  evaluateEmploymentStatus,
  evaluateLoanType,
  evaluatePropertyType,
  evaluateBankruptcy,
  evaluateForeclosure,
  evaluateReserveRequirements,
  evaluateDti,
];

@Injectable()
export class MortgageEligibilityRepository {
  private readonly store = new Map<string, MortgageApplicationEntity>();

  public async create(dto: CreateMortgageApplicationDto): Promise<MortgageApplicationEntity> {
    this.validateBasicFields(dto);

    const id = this.generateId();
    const now = new Date();

    const entityWithoutAssessment = this.buildInitialEntity(id, now, dto);
    const assessment = this.evaluateEligibilityRules(entityWithoutAssessment);

    const fullEntity: MortgageApplicationEntity = {
      ...entityWithoutAssessment,
      assessment,
    };

    this.store.set(id, fullEntity);
    return { ...fullEntity };
  }

  private buildInitialEntity(
    id: string,
    now: Date,
    dto: CreateMortgageApplicationDto
  ): Omit<MortgageApplicationEntity, 'assessment'> {
    return {
      id,
      applicantId: dto.applicantId,
      applicantName: dto.applicantName,
      creditScore: dto.creditScore,
      grossMonthlyIncome: dto.grossMonthlyIncome,
      additionalIncomes: withDefault(dto.additionalIncomes, []),
      monthlyDebts: dto.monthlyDebts,
      detailedLiabilities: withDefault(dto.detailedLiabilities, []),
      loanAmount: dto.loanAmount,
      propertyValue: dto.propertyValue,
      downPaymentAmount: dto.downPaymentAmount,
      loanTermYears: withDefault(dto.loanTermYears, 30),
      loanType: dto.loanType,
      propertyType: dto.propertyType,
      occupancyType: dto.occupancyType,
      employmentStatus: dto.employmentStatus,
      employmentDurationMonths: dto.employmentDurationMonths,
      isFirstTimeHomebuyer: withDefault(dto.isFirstTimeHomebuyer, false),
      isVeteran: withDefault(dto.isVeteran, false),
      bankruptcyType: withDefault(dto.bankruptcyType, BankruptcyType.NONE),
      monthsSinceBankruptcy: withDefault(dto.monthsSinceBankruptcy, 999),
      hasForeclosureHistory: withDefault(dto.hasForeclosureHistory, false),
      monthsSinceForeclosure: withDefault(dto.monthsSinceForeclosure, 999),
      liquidAssets: withDefault(dto.liquidAssets, 0),
      isUsdaEligibleRuralArea: withDefault(dto.isUsdaEligibleRuralArea, false),
      monthlyHoaFee: withDefault(dto.monthlyHoaFee, 0),
      numberOfUnits: withDefault(dto.numberOfUnits, 1),
      hasCoSigner: withDefault(dto.hasCoSigner, false),
      coSignerCreditScore: withDefault(dto.coSignerCreditScore, 0),
      createdAt: now,
      updatedAt: now,
    };
  }

  public async findById(id: string): Promise<MortgageApplicationEntity> {
    const entity = this.store.get(id);
    if (!entity) {
      throw new NotFoundException(`Mortgage application with ID "${id}" was not found.`);
    }
    return { ...entity };
  }

  public async findAll(filter?: ApplicationQueryFilter): Promise<MortgageApplicationEntity[]> {
    let results = Array.from(this.store.values());

    if (!filter) {
      return results.map((r) => ({ ...r }));
    }

    if (filter.applicantId) {
      results = results.filter((item) => item.applicantId === filter.applicantId);
    }

    if (filter.loanType) {
      results = results.filter((item) => item.loanType === filter.loanType);
    }

    if (filter.propertyType) {
      results = results.filter((item) => item.propertyType === filter.propertyType);
    }

    if (filter.status) {
      results = results.filter((item) => item.assessment.status === filter.status);
    }

    if (filter.minCreditScore !== undefined) {
      results = results.filter((item) => {
        const effectiveCredit = item.hasCoSigner
          ? Math.min(item.creditScore, item.coSignerCreditScore)
          : item.creditScore;
        return effectiveCredit >= filter.minCreditScore;
      });
    }

    if (filter.maxDti !== undefined) {
      results = results.filter((item) => item.assessment.calculatedDti <= filter.maxDti);
    }

    if (filter.maxLtv !== undefined) {
      results = results.filter((item) => item.assessment.calculatedLtv <= filter.maxLtv);
    }

    return results.map((r) => ({ ...r }));
  }

  public async update(id: string, dto: UpdateMortgageApplicationDto): Promise<MortgageApplicationEntity> {
    const existing = await this.findById(id);

    const merged: Omit<MortgageApplicationEntity, 'assessment'> = {
      ...existing,
      ...dto,
      additionalIncomes: dto.additionalIncomes ? dto.additionalIncomes : existing.additionalIncomes,
      detailedLiabilities: dto.detailedLiabilities ? dto.detailedLiabilities : existing.detailedLiabilities,
      updatedAt: new Date(),
    };

    this.validateBasicFields(merged);

    const updatedAssessment = this.evaluateEligibilityRules(merged);

    const finalEntity: MortgageApplicationEntity = {
      ...merged,
      assessment: updatedAssessment,
    };

    this.store.set(id, finalEntity);
    return { ...finalEntity };
  }

  public async delete(id: string): Promise<{ success: boolean; id: string }> {
    const exists = this.store.has(id);
    if (!exists) {
      throw new NotFoundException(`Mortgage application with ID "${id}" was not found.`);
    }
    this.store.delete(id);
    return { success: true, id };
  }

  public async findByApplicant(applicantId: string): Promise<MortgageApplicationEntity[]> {
    return this.findAll({ applicantId });
  }

  public async reevaluate(id: string): Promise<MortgageApplicationEntity> {
    const existing = await this.findById(id);
    const updatedAssessment = this.evaluateEligibilityRules(existing);

    const updatedEntity: MortgageApplicationEntity = {
      ...existing,
      assessment: updatedAssessment,
      updatedAt: new Date(),
    };

    this.store.set(id, updatedEntity);
    return { ...updatedEntity };
  }

  private validateBasicFields(dto: Partial<CreateMortgageApplicationDto>): void {
    for (const rule of BASIC_FIELD_VALIDATIONS) {
      if (!rule.isValid(dto)) {
        throw new BadRequestException(rule.message);
      }
    }
  }

  private createEvaluationContext(
    data: Omit<MortgageApplicationEntity, 'assessment'>
  ): EvaluationContext {
    const effectiveCreditScore = data.hasCoSigner
      ? Math.min(data.creditScore, data.coSignerCreditScore)
      : data.creditScore;

    const rejectionReasons: string[] = [];
    const conditions: string[] = [];
    const riskWarnings: string[] = [];
    const appliedRules: string[] = [];

    if (data.hasCoSigner) {
      appliedRules.push('CO_SIGNER_CREDIT_SCORE_USED');
      if (data.coSignerCreditScore < data.creditScore) {
        riskWarnings.push('Co-signer credit score is lower than primary applicant score.');
      }
    }

    const totalMonthlyIncome = processIncome(
      data.grossMonthlyIncome,
      data.additionalIncomes,
      conditions,
      riskWarnings,
      appliedRules
    );

    const totalMonthlyLiabilities = processLiabilities(
      data.monthlyDebts,
      data.detailedLiabilities,
      appliedRules
    );

    const calculatedLtv = (data.loanAmount / data.propertyValue) * 100;
    const cltvExcess =
      data.propertyValue - data.downPaymentAmount - data.loanAmount > 0
        ? data.propertyValue - data.downPaymentAmount - data.loanAmount
        : 0;
    const calculatedCltv = ((data.loanAmount + cltvExcess) / data.propertyValue) * 100;

    const estimatedInterestRate = this.calculateInterestRate(
      data.loanType,
      effectiveCreditScore,
      calculatedLtv,
      data.occupancyType,
      data.propertyType
    );

    const monthlyHousingPayment = this.calculateMonthlyPitai(
      data.loanAmount,
      estimatedInterestRate,
      data.loanTermYears,
      data.propertyValue,
      calculatedLtv,
      data.loanType,
      data.monthlyHoaFee,
      data.propertyType
    );

    const calculatedDti = ((totalMonthlyLiabilities + monthlyHousingPayment) / totalMonthlyIncome) * 100;
    const actualReserveMonths = data.liquidAssets / monthlyHousingPayment;

    return {
      data,
      rejectionReasons,
      conditions,
      riskWarnings,
      appliedRules,
      effectiveCreditScore,
      totalMonthlyIncome,
      totalMonthlyLiabilities,
      calculatedLtv,
      calculatedCltv,
      estimatedInterestRate,
      monthlyHousingPayment,
      calculatedDti,
      actualReserveMonths,
      requiredReserveMonths: 0,
    };
  }

  private evaluateEligibilityRules(
    data: Omit<MortgageApplicationEntity, 'assessment'>
  ): DetailedAssessment {
    const ctx = this.createEvaluationContext(data);

    for (const rule of EVALUATION_PIPELINE) {
      rule(ctx);
    }

    const status = determineFinalStatus(ctx);

    return {
      status,
      calculatedDti: Number(ctx.calculatedDti.toFixed(2)),
      calculatedLtv: Number(ctx.calculatedLtv.toFixed(2)),
      calculatedCltv: Number(ctx.calculatedCltv.toFixed(2)),
      estimatedInterestRate: Number(ctx.estimatedInterestRate.toFixed(3)),
      monthlyHousingPayment: Number(ctx.monthlyHousingPayment.toFixed(2)),
      requiredReserveMonths: ctx.requiredReserveMonths,
      actualReserveMonths: Number(ctx.actualReserveMonths.toFixed(1)),
      rejectionReasons: ctx.rejectionReasons,
      conditions: ctx.conditions,
      riskWarnings: ctx.riskWarnings,
      appliedRules: ctx.appliedRules,
    };
  }

  private calculateInterestRate(
    loanType: LoanType,
    creditScore: number,
    ltv: number,
    occupancyType: OccupancyType,
    propertyType: PropertyType
  ): number {
    const baseRate = 6.5;
    const creditAdj = getCreditScoreAdjustment(creditScore);
    const ltvAdj = getLtvAdjustment(ltv);
    const loanAdj = LOAN_TYPE_RATE_ADJUSTMENTS[loanType] ?? 0;
    const occAdj = OCCUPANCY_TYPE_RATE_ADJUSTMENTS[occupancyType] ?? 0;
    const propAdj = PROPERTY_TYPE_RATE_ADJUSTMENTS[propertyType] ?? 0;

    return Math.max(3.0, baseRate + creditAdj + ltvAdj + loanAdj + occAdj + propAdj);
  }

  private calculateMonthlyPitai(
    loanAmount: number,
    annualInterestRate: number,
    termYears: number,
    propertyValue: number,
    ltv: number,
    loanType: LoanType,
    monthlyHoaFee: number,
    propertyType: PropertyType
  ): number {
    const monthlyRate = annualInterestRate / 100 / 12;
    const totalPayments = termYears * 12;

    const principalAndInterest =
      (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments))) /
      (Math.pow(1 + monthlyRate, totalPayments) - 1);

    const monthlyPropertyTax = (propertyValue * 0.012) / 12;
    const monthlyHazardInsurance = (propertyValue * 0.0035) / 12;

    let monthlyMortgageInsurance = 0;
    if (ltv > 80) {
      switch (loanType) {
        case LoanType.CONVENTIONAL:
          monthlyMortgageInsurance = (loanAmount * 0.0085) / 12;
          break;
        case LoanType.FHA:
          monthlyMortgageInsurance = (loanAmount * 0.0055) / 12;
          break;
        case LoanType.USDA:
          monthlyMortgageInsurance = (loanAmount * 0.0035) / 12;
          break;
        case LoanType.VA:
          monthlyMortgageInsurance = 0;
          break;
      }
    }

    let hoa = monthlyHoaFee;
    if (propertyType === PropertyType.CONDO && hoa <= 0) {
      hoa = 250;
    }

    return principalAndInterest + monthlyPropertyTax + monthlyHazardInsurance + monthlyMortgageInsurance + hoa;
  }

  private generateId(): string {
    return 'app_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }
}