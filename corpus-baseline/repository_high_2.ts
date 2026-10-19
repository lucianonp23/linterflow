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

type EntityBase = Omit<MortgageApplicationEntity, 'assessment'>;

class EvaluationContext {
  public readonly rejectionReasons: string[] = [];
  public readonly conditions: string[] = [];
  public readonly riskWarnings: string[] = [];
  public readonly appliedRules: string[] = [];

  public addRejection(reason: string, rule?: string): void {
    this.rejectionReasons.push(reason);
    if (rule) this.appliedRules.push(rule);
  }

  public addCondition(condition: string, rule?: string): void {
    this.conditions.push(condition);
    if (rule) this.appliedRules.push(rule);
  }

  public addWarning(warning: string): void {
    this.riskWarnings.push(warning);
  }

  public addRule(rule: string): void {
    this.appliedRules.push(rule);
  }
}

@Injectable()
export class MortgageEligibilityRepository {
  private readonly store = new Map<string, MortgageApplicationEntity>();

  public async create(dto: CreateMortgageApplicationDto): Promise<MortgageApplicationEntity> {
    this.validateBasicFields(dto);

    const id = this.generateId();
    const now = new Date();

    const entityWithoutAssessment: EntityBase = {
      id,
      applicantId: dto.applicantId,
      applicantName: dto.applicantName,
      creditScore: dto.creditScore,
      grossMonthlyIncome: dto.grossMonthlyIncome,
      additionalIncomes: dto.additionalIncomes || [],
      monthlyDebts: dto.monthlyDebts,
      detailedLiabilities: dto.detailedLiabilities || [],
      loanAmount: dto.loanAmount,
      propertyValue: dto.propertyValue,
      downPaymentAmount: dto.downPaymentAmount,
      loanTermYears: dto.loanTermYears || 30,
      loanType: dto.loanType,
      propertyType: dto.propertyType,
      occupancyType: dto.occupancyType,
      employmentStatus: dto.employmentStatus,
      employmentDurationMonths: dto.employmentDurationMonths,
      isFirstTimeHomebuyer: dto.isFirstTimeHomebuyer || false,
      isVeteran: dto.isVeteran || false,
      bankruptcyType: dto.bankruptcyType || BankruptcyType.NONE,
      monthsSinceBankruptcy: dto.monthsSinceBankruptcy || 999,
      hasForeclosureHistory: dto.hasForeclosureHistory || false,
      monthsSinceForeclosure: dto.monthsSinceForeclosure || 999,
      liquidAssets: dto.liquidAssets || 0,
      isUsdaEligibleRuralArea: dto.isUsdaEligibleRuralArea || false,
      monthlyHoaFee: dto.monthlyHoaFee || 0,
      numberOfUnits: dto.numberOfUnits || 1,
      hasCoSigner: dto.hasCoSigner || false,
      coSignerCreditScore: dto.coSignerCreditScore || 0,
      createdAt: now,
      updatedAt: now,
    };

    const assessment = this.evaluateEligibilityRules(entityWithoutAssessment);

    const fullEntity: MortgageApplicationEntity = {
      ...entityWithoutAssessment,
      assessment,
    };

    this.store.set(id, fullEntity);
    return { ...fullEntity };
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

    const merged: EntityBase = {
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
    if (dto.grossMonthlyIncome !== undefined && dto.grossMonthlyIncome <= 0) {
      throw new BadRequestException('Gross monthly income must be greater than zero.');
    }
    if (dto.propertyValue !== undefined && dto.propertyValue <= 0) {
      throw new BadRequestException('Property value must be greater than zero.');
    }
    if (dto.loanAmount !== undefined && dto.loanAmount <= 0) {
      throw new BadRequestException('Loan amount must be greater than zero.');
    }
    if (dto.creditScore !== undefined && (dto.creditScore < 300 || dto.creditScore > 850)) {
      throw new BadRequestException('Credit score must be between 300 and 850.');
    }
    if (
      dto.hasCoSigner &&
      dto.coSignerCreditScore !== undefined &&
      (dto.coSignerCreditScore < 300 || dto.coSignerCreditScore > 850)
    ) {
      throw new BadRequestException('Co-signer credit score must be between 300 and 850.');
    }
  }

  private evaluateEligibilityRules(data: EntityBase): DetailedAssessment {
    const ctx = new EvaluationContext();

    const effectiveCreditScore = this.resolveCreditScore(data, ctx);
    const totalMonthlyIncome = this.calculateTotalIncome(data, ctx);
    const totalMonthlyLiabilities = this.calculateTotalLiabilities(data, ctx);

    const calculatedLtv = (data.loanAmount / data.propertyValue) * 100;
    const secondLien = data.propertyValue - data.downPaymentAmount - data.loanAmount;
    const calculatedCltv = ((data.loanAmount + (secondLien > 0 ? secondLien : 0)) / data.propertyValue) * 100;

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

    this.checkEmploymentRules(data, ctx);
    this.checkLoanTypeRules(data, ctx, effectiveCreditScore, calculatedLtv);
    this.checkPropertyTypeRules(data, ctx, calculatedLtv);
    this.checkBankruptcyRules(data, ctx);
    this.checkForeclosureRules(data, ctx);

    const requiredReserveMonths = this.calculateRequiredReserveMonths(data, calculatedDti, ctx);
    this.checkReserveRules(data, ctx, actualReserveMonths, requiredReserveMonths);
    this.checkDtiRules(data, ctx, effectiveCreditScore, calculatedDti, actualReserveMonths, requiredReserveMonths, calculatedLtv);

    if (calculatedLtv > 80 && data.loanType === LoanType.CONVENTIONAL) {
      ctx.addCondition('Private Mortgage Insurance (PMI) approval is required.');
    }

    const status = this.determineEligibilityStatus(data, ctx, effectiveCreditScore, calculatedDti);

    return {
      status,
      calculatedDti: Number(calculatedDti.toFixed(2)),
      calculatedLtv: Number(calculatedLtv.toFixed(2)),
      calculatedCltv: Number(calculatedCltv.toFixed(2)),
      estimatedInterestRate: Number(estimatedInterestRate.toFixed(3)),
      monthlyHousingPayment: Number(monthlyHousingPayment.toFixed(2)),
      requiredReserveMonths,
      actualReserveMonths: Number(actualReserveMonths.toFixed(1)),
      rejectionReasons: ctx.rejectionReasons,
      conditions: ctx.conditions,
      riskWarnings: ctx.riskWarnings,
      appliedRules: ctx.appliedRules,
    };
  }

  private resolveCreditScore(data: EntityBase, ctx: EvaluationContext): number {
    if (!data.hasCoSigner) {
      return data.creditScore;
    }

    ctx.addRule('CO_SIGNER_CREDIT_SCORE_USED');
    if (data.coSignerCreditScore < data.creditScore) {
      ctx.addWarning('Co-signer credit score is lower than primary applicant score.');
    }

    return Math.min(data.creditScore, data.coSignerCreditScore);
  }

  private calculateTotalIncome(data: EntityBase, ctx: EvaluationContext): number {
    let totalIncome = data.grossMonthlyIncome;

    if (data.additionalIncomes && data.additionalIncomes.length > 0) {
      for (const inc of data.additionalIncomes) {
        if (inc.isGuaranteed && inc.yearsReceived >= 2) {
          totalIncome += inc.monthlyAmount;
          ctx.addRule(`ADDITIONAL_INCOME_ACCEPTED_${inc.type.toUpperCase()}`);
        } else if (inc.isGuaranteed && inc.yearsReceived < 2) {
          ctx.addCondition(`Provide proof of continuous income for source: ${inc.type}`);
          ctx.addWarning(`Additional income source ${inc.type} has less than 2 years history.`);
        } else {
          ctx.addWarning(`Unverified or non-guaranteed income source excluded: ${inc.type}`);
        }
      }
    }

    return totalIncome;
  }

  private calculateTotalLiabilities(data: EntityBase, ctx: EvaluationContext): number {
    let totalLiabilities = data.monthlyDebts;

    if (data.detailedLiabilities && data.detailedLiabilities.length > 0) {
      let calculatedLiabilities = 0;
      for (const liability of data.detailedLiabilities) {
        if (liability.remainingMonths <= 10 && !liability.isRealEstateLiability) {
          ctx.addRule(`LIABILITY_EXCLUDED_SHORT_TERM_${liability.name}`);
          continue;
        }
        calculatedLiabilities += liability.monthlyPayment;
      }
      if (calculatedLiabilities > totalLiabilities) {
        totalLiabilities = calculatedLiabilities;
        ctx.addRule('DETAILED_LIABILITIES_OVERRODE_SUMMARY');
      }
    }

    return totalLiabilities;
  }

  private checkEmploymentRules(data: EntityBase, ctx: EvaluationContext): void {
    switch (data.employmentStatus) {
      case EmploymentStatus.UNEMPLOYED:
        ctx.addRejection('Applicant is currently unemployed.', 'RULE_REJECT_UNEMPLOYED');
        break;

      case EmploymentStatus.SELF_EMPLOYED:
        if (data.employmentDurationMonths < 12) {
          ctx.addRejection(
            'Self-employed applicants require at least 12 months of operating history.',
            'RULE_REJECT_SELF_EMPLOYED_UNDER_12M'
          );
        } else if (data.employmentDurationMonths < 24) {
          ctx.addCondition(
            'Provide 2 years of audited P&L statements and business tax returns.',
            'RULE_CONDITIONAL_SELF_EMPLOYED_12_24M'
          );
          ctx.addWarning('Self-employed between 12-24 months requires manual tax verification.');
        } else {
          ctx.addRule('RULE_PASS_SELF_EMPLOYED_24M');
        }
        break;

      case EmploymentStatus.FULL_TIME:
      case EmploymentStatus.PART_TIME:
        if (data.employmentDurationMonths < 24) {
          ctx.addCondition(
            'Provide VOE (Verification of Employment) and previous 2 years W-2 forms.',
            'RULE_CHECK_EMPLOYMENT_CONTINUITY'
          );
          if (data.employmentDurationMonths < 6) {
            ctx.addWarning('Employment duration under 6 months triggers strict probability of continuance check.');
          }
        }
        break;

      case EmploymentStatus.RETIRED:
        ctx.addCondition(
          'Provide pension, social security award letters or 401k/IRA distribution proof.',
          'RULE_RETIRED_VERIFICATION'
        );
        break;
    }
  }

  private checkLoanTypeRules(data: EntityBase, ctx: EvaluationContext, creditScore: number, ltv: number): void {
    switch (data.loanType) {
      case LoanType.CONVENTIONAL:
        if (creditScore < 620) {
          ctx.addRejection('Conventional loan requires a minimum credit score of 620.', 'RULE_REJECT_CONVENTIONAL_CREDIT');
        }
        break;

      case LoanType.FHA:
        if (creditScore < 500) {
          ctx.addRejection('FHA loan requires a minimum credit score of 500.', 'RULE_REJECT_FHA_CREDIT_BELOW_500');
        } else if (creditScore < 580) {
          if (ltv > 90) {
            ctx.addRejection(
              'FHA applicants with credit score 500-579 require a minimum 10% down payment (Max 90% LTV).',
              'RULE_REJECT_FHA_500_579_LTV'
            );
          } else {
            ctx.addCondition(
              'FHA Credit Score between 500-579 requires manual underwriting approval.',
              'RULE_MANUAL_FHA_500_579'
            );
          }
        }
        break;

      case LoanType.VA:
        if (!data.isVeteran) {
          ctx.addRejection(
            'VA loans are restricted to eligible military veterans or active service members.',
            'RULE_REJECT_VA_NON_VETERAN'
          );
        }
        if (creditScore < 580) {
          ctx.addRejection('VA loan requires a minimum credit score of 580.', 'RULE_REJECT_VA_CREDIT');
        }
        break;

      case LoanType.USDA:
        if (!data.isUsdaEligibleRuralArea) {
          ctx.addRejection(
            'USDA loans require the property to be located in a designated rural area.',
            'RULE_REJECT_USDA_LOCATION'
          );
        }
        if (creditScore < 640) {
          ctx.addRejection('USDA loan requires a minimum credit score of 640.', 'RULE_REJECT_USDA_CREDIT');
        }
        if (data.occupancyType !== OccupancyType.PRIMARY_RESIDENCE) {
          ctx.addRejection('USDA loans are strictly for primary residences.', 'RULE_REJECT_USDA_OCCUPANCY');
        }
        break;
    }
  }

  private checkPropertyTypeRules(data: EntityBase, ctx: EvaluationContext, ltv: number): void {
    if (data.propertyType === PropertyType.COMMERCIAL) {
      ctx.addRejection('Commercial properties are ineligible for residential mortgage engine.', 'RULE_REJECT_COMMERCIAL');
    }

    switch (data.propertyType) {
      case PropertyType.SINGLE_FAMILY:
        this.checkSingleFamilyRules(data, ctx, ltv);
        break;

      case PropertyType.CONDO:
        this.checkCondoRules(data, ctx, ltv);
        break;

      case PropertyType.MULTI_FAMILY:
        this.checkMultiFamilyRules(data, ctx, ltv);
        break;

      case PropertyType.MANUFACTURED:
        this.checkManufacturedRules(data, ctx, ltv);
        break;
    }
  }

  private checkSingleFamilyRules(data: EntityBase, ctx: EvaluationContext, ltv: number): void {
    switch (data.occupancyType) {
      case OccupancyType.PRIMARY_RESIDENCE:
        const maxLtvSingle = data.isFirstTimeHomebuyer && data.loanType === LoanType.CONVENTIONAL ? 97 : 95;
        if (data.loanType === LoanType.CONVENTIONAL && ltv > maxLtvSingle) {
          ctx.addRejection(`Conventional Single Family Primary residence max LTV is ${maxLtvSingle}%.`);
        }
        break;
      case OccupancyType.SECONDARY_HOME:
        if (data.loanType === LoanType.CONVENTIONAL && ltv > 90) {
          ctx.addRejection('Conventional Second Home max LTV is 90%.');
        } else if (data.loanType !== LoanType.CONVENTIONAL) {
          ctx.addRejection('Government loans (FHA/VA/USDA) do not allow Second Home occupancy.');
        }
        break;
      case OccupancyType.INVESTMENT_PROPERTY:
        if (data.loanType === LoanType.CONVENTIONAL && ltv > 85) {
          ctx.addRejection('Conventional Investment Single Family max LTV is 85%.');
        } else if (data.loanType !== LoanType.CONVENTIONAL) {
          ctx.addRejection('Government loans (FHA/VA/USDA) do not allow Investment properties.');
        }
        break;
    }
  }

  private checkCondoRules(data: EntityBase, ctx: EvaluationContext, ltv: number): void {
    ctx.addCondition('Subject to condo project questionnaire and HOA budget review.');
    if (data.monthlyHoaFee <= 0) {
      ctx.addWarning('Condo property missing monthly HOA fee; calculated payment may be understated.');
    }
    switch (data.occupancyType) {
      case OccupancyType.PRIMARY_RESIDENCE:
        if (data.loanType === LoanType.CONVENTIONAL && ltv > 90) {
          ctx.addRejection('Conventional Condo Primary max LTV is 90%.');
        }
        break;
      case OccupancyType.SECONDARY_HOME:
        if (data.loanType === LoanType.CONVENTIONAL && ltv > 80) {
          ctx.addRejection('Conventional Condo Second Home max LTV is 80%.');
        }
        break;
      case OccupancyType.INVESTMENT_PROPERTY:
        if (data.loanType === LoanType.CONVENTIONAL && ltv > 75) {
          ctx.addRejection('Conventional Condo Investment max LTV is 75%.');
        }
        break;
    }
  }

  private checkMultiFamilyRules(data: EntityBase, ctx: EvaluationContext, ltv: number): void {
    if (data.numberOfUnits > 4) {
      ctx.addRejection('Multi-family properties exceeding 4 units are considered commercial.', 'RULE_REJECT_MULTIFAMILY_UNITS');
    }
    if (data.occupancyType === OccupancyType.INVESTMENT_PROPERTY) {
      if (data.loanType === LoanType.CONVENTIONAL && ltv > 75) {
        ctx.addRejection('Conventional Multi-Family Investment max LTV is 75%.');
      }
    } else if (data.occupancyType === OccupancyType.PRIMARY_RESIDENCE) {
      if (data.loanType === LoanType.CONVENTIONAL && ltv > 85) {
        ctx.addRejection('Conventional Multi-Family Primary max LTV is 85%.');
      }
    }
  }

  private checkManufacturedRules(data: EntityBase, ctx: EvaluationContext, ltv: number): void {
    if (data.occupancyType !== OccupancyType.PRIMARY_RESIDENCE) {
      ctx.addRejection('Manufactured housing must be occupied as primary residence.');
    }
    if (data.loanType === LoanType.CONVENTIONAL && ltv > 80) {
      ctx.addRejection('Conventional Manufactured Home max LTV is 80%.');
    } else if (data.loanType === LoanType.FHA && ltv > 90) {
      ctx.addRejection('FHA Manufactured Home max LTV is 90%.');
    }
    ctx.addCondition('Property must be permanently affixed to a HUD-compliant foundation.');
  }

  private checkBankruptcyRules(data: EntityBase, ctx: EvaluationContext): void {
    if (data.bankruptcyType === BankruptcyType.NONE) {
      return;
    }

    if (data.bankruptcyType === BankruptcyType.CHAPTER_7) {
      switch (data.loanType) {
        case LoanType.CONVENTIONAL:
          if (data.monthsSinceBankruptcy < 48) {
            ctx.addRejection(
              `Chapter 7 Bankruptcy requires 48 months seasoning for Conventional loans (actual: ${data.monthsSinceBankruptcy}m).`,
              'RULE_REJECT_CH7_CONVENTIONAL'
            );
          }
          break;
        case LoanType.FHA:
        case LoanType.VA:
          if (data.monthsSinceBankruptcy < 24) {
            ctx.addRejection(
              `Chapter 7 Bankruptcy requires 24 months seasoning for FHA/VA loans (actual: ${data.monthsSinceBankruptcy}m).`,
              'RULE_REJECT_CH7_FHA_VA'
            );
          }
          break;
        case LoanType.USDA:
          if (data.monthsSinceBankruptcy < 36) {
            ctx.addRejection(
              `Chapter 7 Bankruptcy requires 36 months seasoning for USDA loans (actual: ${data.monthsSinceBankruptcy}m).`,
              'RULE_REJECT_CH7_USDA'
            );
          }
          break;
      }
    } else if (data.bankruptcyType === BankruptcyType.CHAPTER_13) {
      switch (data.loanType) {
        case LoanType.CONVENTIONAL:
          if (data.monthsSinceBankruptcy < 24) {
            ctx.addRejection(
              'Chapter 13 Bankruptcy requires 24 months seasoning from discharge for Conventional loans.',
              'RULE_REJECT_CH13_CONVENTIONAL'
            );
          }
          break;
        case LoanType.FHA:
        case LoanType.VA:
          if (data.monthsSinceBankruptcy < 12) {
            ctx.addRejection(
              'Chapter 13 Bankruptcy requires at least 12 months satisfactory payments and court approval for FHA/VA.',
              'RULE_REJECT_CH13_FHA_VA'
            );
          } else {
            ctx.addCondition('Provide bankruptcy trustee written approval for new mortgage debt.');
          }
          break;
        case LoanType.USDA:
          if (data.monthsSinceBankruptcy < 24) {
            ctx.addRejection('Chapter 13 Bankruptcy requires 24 months seasoning for USDA loans.', 'RULE_REJECT_CH13_USDA');
          }
          break;
      }
    }
  }

  private checkForeclosureRules(data: EntityBase, ctx: EvaluationContext): void {
    if (!data.hasForeclosureHistory) {
      return;
    }

    switch (data.loanType) {
      case LoanType.CONVENTIONAL:
        if (data.monthsSinceForeclosure < 84) {
          ctx.addRejection(
            `Foreclosure requires 84 months (7 years) seasoning for Conventional loans (actual: ${data.monthsSinceForeclosure}m).`,
            'RULE_REJECT_FORECLOSURE_CONVENTIONAL'
          );
        }
        break;
      case LoanType.FHA:
      case LoanType.USDA:
        if (data.monthsSinceForeclosure < 36) {
          ctx.addRejection(
            `Foreclosure requires 36 months seasoning for FHA/USDA loans (actual: ${data.monthsSinceForeclosure}m).`,
            'RULE_REJECT_FORECLOSURE_FHA_USDA'
          );
        }
        break;
      case LoanType.VA:
        if (data.monthsSinceForeclosure < 24) {
          ctx.addRejection(
            `Foreclosure requires 24 months seasoning for VA loans (actual: ${data.monthsSinceForeclosure}m).`,
            'RULE_REJECT_FORECLOSURE_VA'
          );
        }
        break;
    }
  }

  private calculateRequiredReserveMonths(data: EntityBase, dti: number, ctx: EvaluationContext): number {
    let requiredReserves = 0;

    if (data.occupancyType === OccupancyType.INVESTMENT_PROPERTY) {
      requiredReserves += 6;
    } else if (data.occupancyType === OccupancyType.SECONDARY_HOME) {
      requiredReserves += 2;
    }

    if (data.propertyType === PropertyType.MULTI_FAMILY) {
      requiredReserves += (data.numberOfUnits - 1) * 2;
    }

    if (data.employmentStatus === EmploymentStatus.SELF_EMPLOYED && data.employmentDurationMonths < 24) {
      requiredReserves += 3;
    }

    if (dti > 43) {
      requiredReserves += 2;
    }

    if (data.loanAmount > 726200) {
      requiredReserves += 6;
      ctx.addRule('RULE_JUMBO_RESERVES_APPLIED');
    }

    return requiredReserves;
  }

  private checkReserveRules(
    data: EntityBase,
    ctx: EvaluationContext,
    actualReserves: number,
    requiredReserves: number
  ): void {
    if (actualReserves < requiredReserves) {
      if (data.occupancyType === OccupancyType.INVESTMENT_PROPERTY) {
        ctx.addRejection(
          `Investment property requires ${requiredReserves} months reserves (actual: ${actualReserves.toFixed(1)}m).`,
          'RULE_REJECT_RESERVES_INVESTMENT'
        );
      } else {
        ctx.addCondition(
          `Provide proof of additional liquid assets to meet ${requiredReserves} months reserve requirement.`,
          'RULE_CONDITION_RESERVES_SHORTFALL'
        );
        ctx.addWarning(`Reserve shortfall: Has ${actualReserves.toFixed(1)} months, requires ${requiredReserves} months.`);
      }
    }
  }

  private checkDtiRules(
    data: EntityBase,
    ctx: EvaluationContext,
    creditScore: number,
    dti: number,
    actualReserves: number,
    requiredReserves: number,
    ltv: number
  ): void {
    let maxAllowedDti = 43;
    let dtiCompensatingFactors = 0;

    if (creditScore >= 740) {
      dtiCompensatingFactors += 3;
      ctx.addRule('DTI_COMP_FACTOR_HIGH_CREDIT');
    }

    if (actualReserves >= requiredReserves + 6) {
      dtiCompensatingFactors += 2;
      ctx.addRule('DTI_COMP_FACTOR_EXTRA_RESERVES');
    }

    if (ltv <= 70) {
      dtiCompensatingFactors += 2;
      ctx.addRule('DTI_COMP_FACTOR_LOW_LTV');
    }

    if (data.loanType === LoanType.FHA && creditScore >= 680) {
      dtiCompensatingFactors += 3;
      ctx.addRule('DTI_COMP_FACTOR_FHA_HIGH_CREDIT');
    }

    maxAllowedDti = Math.min(50, maxAllowedDti + dtiCompensatingFactors);

    if (dti > 50) {
      if (data.loanType === LoanType.VA && creditScore >= 720 && actualReserves >= 6) {
        ctx.addCondition(
          'DTI exceeds 50% but VA residual income check passed. Requires manual underwriting signoff.',
          'RULE_VA_HIGH_DTI_EXCEPTION'
        );
      } else {
        ctx.addRejection(`DTI of ${dti.toFixed(2)}% exceeds the absolute limit of 50.00%.`, 'RULE_REJECT_DTI_HARD_CAP');
      }
    } else if (dti > maxAllowedDti) {
      ctx.addRejection(
        `DTI of ${dti.toFixed(2)}% exceeds calculated maximum threshold of ${maxAllowedDti.toFixed(2)}%.`,
        'RULE_REJECT_DTI_THESHOLD'
      );
    } else if (dti > 43) {
      ctx.addCondition(
        `DTI is ${dti.toFixed(2)}% (above 43%). Mandatory automated underwriting system (AUS) approval required.`,
        'RULE_CONDITION_HIGH_DTI_AUS'
      );
    }
  }

  private determineEligibilityStatus(
    data: EntityBase,
    ctx: EvaluationContext,
    creditScore: number,
    dti: number
  ): EligibilityStatus {
    if (ctx.rejectionReasons.length > 0) {
      return EligibilityStatus.DECLINED;
    }

    const requiresManualReviewTrigger =
      creditScore < 640 ||
      dti > 45 ||
      data.employmentStatus === EmploymentStatus.SELF_EMPLOYED ||
      data.bankruptcyType !== BankruptcyType.NONE ||
      data.hasForeclosureHistory;

    if (requiresManualReviewTrigger) {
      return ctx.conditions.length > 0
        ? EligibilityStatus.MANUAL_UNDERWRITING_REQUIRED
        : EligibilityStatus.CONDITIONAL_APPROVAL;
    }

    return ctx.conditions.length > 0
      ? EligibilityStatus.CONDITIONAL_APPROVAL
      : EligibilityStatus.APPROVED;
  }

  private calculateInterestRate(
    loanType: LoanType,
    creditScore: number,
    ltv: number,
    occupancyType: OccupancyType,
    propertyType: PropertyType
  ): number {
    let baseRate = 6.5;

    if (creditScore >= 760) {
      baseRate -= 0.5;
    } else if (creditScore >= 720) {
      baseRate -= 0.25;
    } else if (creditScore >= 680) {
      baseRate += 0.0;
    } else if (creditScore >= 640) {
      baseRate += 0.5;
    } else if (creditScore >= 620) {
      baseRate += 1.0;
    } else {
      baseRate += 2.0;
    }

    if (ltv > 90) {
      baseRate += 0.375;
    } else if (ltv > 80) {
      baseRate += 0.125;
    }

    switch (loanType) {
      case LoanType.FHA:
        baseRate -= 0.25;
        break;
      case LoanType.VA:
        baseRate -= 0.375;
        break;
      case LoanType.USDA:
        baseRate -= 0.125;
        break;
    }

    switch (occupancyType) {
      case OccupancyType.INVESTMENT_PROPERTY:
        baseRate += 0.75;
        break;
      case OccupancyType.SECONDARY_HOME:
        baseRate += 0.375;
        break;
    }

    switch (propertyType) {
      case PropertyType.CONDO:
        baseRate += 0.125;
        break;
      case PropertyType.MANUFACTURED:
        baseRate += 0.5;
        break;
      case PropertyType.MULTI_FAMILY:
        baseRate += 0.25;
        break;
    }

    return Math.max(3.0, baseRate);
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