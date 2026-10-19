import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export enum EmploymentType {
  FULL_TIME = 'FULL_TIME',
  PART_TIME = 'PART_TIME',
  CONTRACTOR = 'CONTRACTOR',
  INTERN = 'INTERN',
}

export enum PayFrequency {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  SEMIMONTHLY = 'SEMIMONTHLY',
  MONTHLY = 'MONTHLY',
}

export enum FilingStatus {
  SINGLE = 'SINGLE',
  MARRIED_JOINT = 'MARRIED_JOINT',
  MARRIED_SEPARATE = 'MARRIED_SEPARATE',
  HEAD_OF_HOUSEHOLD = 'HEAD_OF_HOUSEHOLD',
}

export enum USState {
  CA = 'CA',
  NY = 'NY',
  TX = 'TX',
  FL = 'FL',
  IL = 'IL',
  PA = 'PA',
  WA = 'WA',
}

export enum GarnishmentType {
  CHILD_SUPPORT = 'CHILD_SUPPORT',
  CREDITOR_GARNISHMENT = 'CREDITOR_GARNISHMENT',
  FEDERAL_TAX_LEVY = 'FEDERAL_TAX_LEVY',
}

export interface DailyShiftDto {
  date: string;
  hoursWorked: number;
  isHoliday?: boolean;
  isNightShift?: boolean;
  isOnCall?: boolean;
}

export interface PayrollCalculationDto {
  employeeId: string;
  age: number;
  employmentType: EmploymentType;
  isExempt: boolean;
  payFrequency: PayFrequency;
  hourlyRate?: number;
  annualSalary?: number;
  filingStatus: FilingStatus;
  state: USState;
  dependentsCount: number;
  dailyShifts?: DailyShiftDto[];
  regularHours?: number;
  overtimeHours?: number;
  doubleTimeHours?: number;
  holidayHours?: number;
  nightShiftHours?: number;
  onCallHours?: number;
  ytdGrossPay: number;
  ytdSocialSecurityTax: number;
  ytdMedicareTax: number;
  ytd401kContribution: number;
  ytdHsaContribution: number;
  percent401k: number;
  flatRoth401k: number;
  hsaContribution: number;
  healthInsurancePremium: number;
  dentalInsurancePremium: number;
  visionInsurancePremium: number;
  fsaContribution: number;
  isUnionMember: boolean;
  garnishmentType?: GarnishmentType;
  garnishmentAmount?: number;
  hasOtherDependentsForGarnishment?: boolean;
  hasRelocationBonus?: boolean;
  relocationBonusAmount?: number;
  gymStipend?: number;
  cellPhoneStipend?: number;
}

export interface BatchPayrollDto {
  batchId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  employees: PayrollCalculationDto[];
}

export interface PayrollAdjustmentDto {
  adjustmentId: string;
  employeeId: string;
  manualGrossBonus?: number;
  discretionaryDeduction?: number;
  taxExemptionOverride?: boolean;
  notes?: string;
}

@Controller('payroll')
export class PayrollController {
  private draftStore = new Map<string, any>();
  private adjustmentStore = new Map<string, PayrollAdjustmentDto[]>();

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  calculatePaystub(@Body() dto: PayrollCalculationDto) {
    this.validateCalculationInput(dto);

    if (dto.employmentType === EmploymentType.CONTRACTOR) {
      return this.calculateContractorPaystub(dto);
    }

    const freqFactor = this.getPayFrequencyFactor(dto.payFrequency);
    const baseHourlyRate = this.calculateBaseHourlyRate(dto, freqFactor);
    const hours = this.calculateHours(dto);

    const regularPay = dto.annualSalary && dto.annualSalary > 0
      ? dto.annualSalary / freqFactor
      : hours.regularHours * baseHourlyRate;

    const otPay = hours.overtimeHours * baseHourlyRate * 1.5;
    const dtPay = hours.doubleTimeHours * baseHourlyRate * 2.0;
    const holidayPay = hours.holidayHours * baseHourlyRate * 1.5;
    const nightShiftDifferentialPay = hours.nightShiftHours * baseHourlyRate * 0.15;
    const onCallPay = hours.onCallHours * baseHourlyRate * 0.5;

    const bonusPay = (dto.hasRelocationBonus && dto.relocationBonusAmount) ? dto.relocationBonusAmount : 0;
    const taxableStipends = dto.gymStipend || 0;
    const nonTaxableStipends = dto.cellPhoneStipend || 0;

    const grossPay =
      regularPay +
      otPay +
      dtPay +
      holidayPay +
      nightShiftDifferentialPay +
      onCallPay +
      bonusPay +
      taxableStipends;

    const preTax = this.calculatePreTaxDeductions(dto, grossPay, freqFactor);
    const taxableIncomeForTaxes = Math.max(0, grossPay - preTax.totalPreTaxDeductions);

    const socialSecurityTax = this.calculateSocialSecurityTax(dto.ytdGrossPay, taxableIncomeForTaxes);
    const medicareTax = this.calculateMedicareTax(dto.ytdGrossPay, taxableIncomeForTaxes, dto.filingStatus);

    const annualizedTaxableIncome = taxableIncomeForTaxes * freqFactor;
    const federalTax = this.calculateFederalTax(annualizedTaxableIncome, dto.filingStatus, dto.dependentsCount, freqFactor);
    const { stateTax, sdiTax } = this.calculateStateTaxAndSdi(
      dto.state,
      dto.filingStatus,
      annualizedTaxableIncome,
      taxableIncomeForTaxes,
      dto.ytdGrossPay,
      freqFactor,
    );

    const totalMandatoryTaxes = federalTax + stateTax + socialSecurityTax + medicareTax + sdiTax;
    const disposablePay = Math.max(0, grossPay - totalMandatoryTaxes);

    const garnishmentDeduction = this.calculateGarnishments(dto, disposablePay, freqFactor);
    const roth401kDeduction = this.calculateRoth401k(dto, preTax.calculated401kPreTax, preTax.remaining401kAllowed);
    const unionDues = dto.isUnionMember ? regularPay * 0.015 : 0;

    const totalPostTaxDeductions = garnishmentDeduction + roth401kDeduction + unionDues;
    const netPay = disposablePay - totalPostTaxDeductions + nonTaxableStipends;

    if (netPay < 0) {
      throw new UnprocessableEntityException('Payroll results in negative net pay');
    }

    const employerCosts = this.calculateEmployerCosts(
      dto,
      grossPay,
      taxableIncomeForTaxes,
      preTax.calculated401kPreTax,
      preTax.healthPrem,
      socialSecurityTax,
      nonTaxableStipends,
      freqFactor,
    );

    return {
      employeeId: dto.employeeId,
      payFrequency: dto.payFrequency,
      grossPayRound: this.round(grossPay),
      breakdown: {
        regularPay: this.round(regularPay),
        overtimePay: this.round(otPay),
        doubleTimePay: this.round(dtPay),
        holidayPay: this.round(holidayPay),
        nightShiftDifferentialPay: this.round(nightShiftDifferentialPay),
        onCallPay: this.round(onCallPay),
        bonusPay: this.round(bonusPay),
        taxableStipends: this.round(taxableStipends),
        nonTaxableStipends: this.round(nonTaxableStipends),
      },
      preTaxDeductions: {
        k401: this.round(preTax.calculated401kPreTax),
        hsa: this.round(preTax.calculatedHsaPreTax),
        fsa: this.round(preTax.calculatedFsaPreTax),
        health: this.round(preTax.healthPrem),
        dental: this.round(preTax.dentalPrem),
        vision: this.round(preTax.visionPrem),
        total: this.round(preTax.totalPreTaxDeductions),
      },
      taxes: {
        federalIncomeTax: this.round(federalTax),
        stateIncomeTax: this.round(stateTax),
        socialSecurityTax: this.round(socialSecurityTax),
        medicareTax: this.round(medicareTax),
        sdiOrPflTax: this.round(sdiTax),
        totalTaxes: this.round(totalMandatoryTaxes),
      },
      postTaxDeductions: {
        garnishments: this.round(garnishmentDeduction),
        roth401k: this.round(roth401kDeduction),
        unionDues: this.round(unionDues),
        total: this.round(totalPostTaxDeductions),
      },
      netPay: this.round(netPay),
      employerContributions: {
        socialSecurityMatch: this.round(employerCosts.socialSecurityMatch),
        medicareMatch: this.round(employerCosts.medicareMatch),
        futaTax: this.round(employerCosts.futaTax),
        sutaTax: this.round(employerCosts.sutaTax),
        matching401k: this.round(employerCosts.matching401k),
        healthContribution: this.round(employerCosts.employerHealthContribution),
        totalEmployerCost: this.round(employerCosts.totalEmployerCost),
      },
    };
  }

  @Post('batch-calculate')
  @HttpCode(HttpStatus.OK)
  batchCalculate(@Body() batchDto: BatchPayrollDto) {
    if (!batchDto.employees || batchDto.employees.length === 0) {
      throw new BadRequestException('Batch contains no employees');
    }

    const results = [];
    const errors = [];
    let totalBatchGross = 0;
    let totalBatchNet = 0;
    let totalBatchEmployerCost = 0;

    for (const emp of batchDto.employees) {
      try {
        const calculated = this.calculatePaystub(emp);
        results.push(calculated);
        totalBatchGross += calculated.grossPayRound;
        totalBatchNet += calculated.netPay;
        totalBatchEmployerCost += calculated.employerContributions.totalEmployerCost;
      } catch (err: any) {
        errors.push({
          employeeId: emp.employeeId,
          error: err.message || 'Failed to calculate payroll',
        });
      }
    }

    const draftRecord = {
      batchId: batchDto.batchId,
      payPeriodStart: batchDto.payPeriodStart,
      payPeriodEnd: batchDto.payPeriodEnd,
      summary: {
        totalEmployeesProcessed: results.length,
        totalErrors: errors.length,
        totalBatchGross: this.round(totalBatchGross),
        totalBatchNet: this.round(totalBatchNet),
        totalBatchEmployerCost: this.round(totalBatchEmployerCost),
      },
      results,
      errors,
    };

    this.draftStore.set(batchDto.batchId, draftRecord);

    return draftRecord;
  }

  @Get('tax-brackets/:region')
  getTaxBrackets(@Param('region') region: string) {
    const uppercaseRegion = region.toUpperCase();

    if (uppercaseRegion === 'FEDERAL') {
      return {
        region: 'FEDERAL',
        standardDeductions: {
          SINGLE: 13850,
          MARRIED_JOINT: 27700,
          HEAD_OF_HOUSEHOLD: 20800,
        },
        brackets: [
          { rate: 0.1, min: 0, max: 11000 },
          { rate: 0.12, min: 11000, max: 44725 },
          { rate: 0.22, min: 44725, max: 95375 },
          { rate: 0.24, min: 95375, max: 182100 },
          { rate: 0.32, min: 182100, max: 231250 },
          { rate: 0.35, min: 231250, max: 578125 },
          { rate: 0.37, min: 578125, max: Infinity },
        ],
        fica: {
          socialSecurityRate: 0.062,
          socialSecurityCap: 160200,
          medicareBaseRate: 0.0145,
          additionalMedicareRate: 0.009,
          additionalMedicareThresholdSingle: 200000,
          additionalMedicareThresholdMarried: 250000,
        },
      };
    }

    if (uppercaseRegion === USState.CA) {
      return {
        region: USState.CA,
        standardDeductionSingle: 5202,
        standardDeductionMarried: 10404,
        sdiRate: 0.011,
        sdiWageCap: 153164,
        brackets: [
          { rate: 0.01, min: 0, max: 10099 },
          { rate: 0.02, min: 10099, max: 23942 },
          { rate: 0.04, min: 23942, max: 37788 },
          { rate: 0.06, min: 37788, max: 52443 },
          { rate: 0.08, min: 52443, max: 66295 },
          { rate: 0.093, min: 66295, max: 338639 },
          { rate: 0.103, min: 338639, max: 406364 },
          { rate: 0.113, min: 406364, max: 677275 },
          { rate: 0.123, min: 677275, max: Infinity },
        ],
        surcharges: [{ name: 'Mental Health Services Tax', threshold: 1000000, rate: 0.01 }],
      };
    }

    if (uppercaseRegion === USState.NY) {
      return {
        region: USState.NY,
        standardDeductionSingle: 8000,
        standardDeductionMarried: 16050,
        pflRate: 0.00455,
        pflMaxCap: 899.47,
        brackets: [
          { rate: 0.04, min: 0, max: 8500 },
          { rate: 0.045, min: 8500, max: 11700 },
          { rate: 0.0525, min: 11700, max: 13900 },
          { rate: 0.0585, min: 13900, max: 80650 },
          { rate: 0.0625, min: 80650, max: 215400 },
          { rate: 0.0685, min: 215400, max: 1077550 },
          { rate: 0.0965, min: 1077550, max: 5000000 },
          { rate: 0.109, min: 5000000, max: Infinity },
        ],
      };
    }

    if (
      uppercaseRegion === USState.TX ||
      uppercaseRegion === USState.FL ||
      uppercaseRegion === USState.WA
    ) {
      return {
        region: uppercaseRegion,
        hasStateIncomeTax: false,
        rate: 0,
      };
    }

    return {
      region: uppercaseRegion,
      hasStateIncomeTax: true,
      flatRate: 0.045,
    };
  }

  @Put('adjustments/:employeeId')
  applyAdjustment(
    @Param('employeeId') employeeId: string,
    @Body() adjustmentDto: PayrollAdjustmentDto,
  ) {
    if (!employeeId) {
      throw new BadRequestException('Employee ID is required');
    }

    const existing = this.adjustmentStore.get(employeeId) || [];
    existing.push({
      ...adjustmentDto,
      employeeId,
    });

    this.adjustmentStore.set(employeeId, existing);

    return {
      message: `Adjustment successfully applied for employee ${employeeId}`,
      totalAdjustments: existing.length,
      adjustments: existing,
    };
  }

  @Delete('drafts/:draftId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDraft(@Param('draftId') draftId: string) {
    if (!this.draftStore.has(draftId)) {
      throw new NotFoundException(`Payroll draft batch with ID ${draftId} not found`);
    }

    this.draftStore.delete(draftId);
  }

  private validateCalculationInput(dto: PayrollCalculationDto): void {
    if (!dto.employeeId) {
      throw new BadRequestException('Employee ID is required');
    }

    if (dto.age < 14 || dto.age > 100) {
      throw new BadRequestException('Invalid employee age');
    }
  }

  private calculateContractorPaystub(dto: PayrollCalculationDto) {
    const gross = dto.annualSalary
      ? dto.annualSalary / this.getPayFrequencyFactor(dto.payFrequency)
      : (dto.regularHours || 0) * (dto.hourlyRate || 0);

    return {
      employeeId: dto.employeeId,
      employmentType: dto.employmentType,
      grossPay: gross,
      federalTax: 0,
      stateTax: 0,
      socialSecurityTax: 0,
      medicareTax: 0,
      totalPreTaxDeductions: 0,
      totalPostTaxDeductions: 0,
      netPay: gross,
      employerCosts: {
        socialSecurityMatch: 0,
        medicareMatch: 0,
        futa: 0,
        suta: 0,
        matching401k: 0,
        totalEmployerCost: gross,
      },
      warnings: ['Contractor payment: No withholdings applied.'],
    };
  }

  private calculateBaseHourlyRate(dto: PayrollCalculationDto, freqFactor: number): number {
    if (dto.annualSalary && dto.annualSalary > 0) {
      return dto.annualSalary / (freqFactor * 40);
    }
    return dto.hourlyRate || 0;
  }

  private calculateHours(dto: PayrollCalculationDto) {
    let regularHours = 0;
    let overtimeHours = 0;
    let doubleTimeHours = 0;
    let holidayHours = 0;
    let nightShiftHours = 0;
    let onCallHours = 0;

    if (dto.dailyShifts && dto.dailyShifts.length > 0) {
      let weeklyAccumulatedHours = 0;
      let consecutiveDays = 0;

      for (const shift of dto.dailyShifts) {
        const hours = shift.hoursWorked;

        consecutiveDays = hours > 0 ? consecutiveDays + 1 : 0;

        if (shift.isNightShift) nightShiftHours += hours;
        if (shift.isOnCall) onCallHours += hours;

        if (shift.isHoliday) {
          holidayHours += hours;
          continue;
        }

        if (dto.isExempt) {
          regularHours += hours;
          continue;
        }

        if (dto.state === USState.CA) {
          if (consecutiveDays === 7) {
            if (hours > 8) {
              doubleTimeHours += hours - 8;
              overtimeHours += 8;
            } else {
              overtimeHours += hours;
            }
          } else {
            if (hours > 12) {
              doubleTimeHours += hours - 12;
              overtimeHours += 4;
              regularHours += 8;
            } else if (hours > 8) {
              overtimeHours += hours - 8;
              regularHours += 8;
            } else {
              regularHours += hours;
            }
          }
        } else {
          weeklyAccumulatedHours += hours;
          if (weeklyAccumulatedHours > 40) {
            const previousHours = weeklyAccumulatedHours - hours;
            if (previousHours >= 40) {
              overtimeHours += hours;
            } else {
              const otPart = weeklyAccumulatedHours - 40;
              const regPart = hours - otPart;
              overtimeHours += otPart;
              regularHours += regPart;
            }
          } else {
            regularHours += hours;
          }
        }
      }
    } else {
      regularHours = dto.regularHours || 0;
      overtimeHours = dto.isExempt ? 0 : dto.overtimeHours || 0;
      doubleTimeHours = dto.isExempt ? 0 : dto.doubleTimeHours || 0;
      holidayHours = dto.holidayHours || 0;
      nightShiftHours = dto.nightShiftHours || 0;
      onCallHours = dto.onCallHours || 0;
    }

    return {
      regularHours,
      overtimeHours,
      doubleTimeHours,
      holidayHours,
      nightShiftHours,
      onCallHours,
    };
  }

  private calculatePreTaxDeductions(dto: PayrollCalculationDto, grossPay: number, freqFactor: number) {
    const isSenior50 = dto.age >= 50;
    const max401kAnnualCap = isSenior50 ? 30000 : 22500;
    const remaining401kAllowed = Math.max(0, max401kAnnualCap - dto.ytd401kContribution);

    let calculated401kPreTax = 0;
    if (dto.percent401k > 0) {
      const requested401k = grossPay * (dto.percent401k / 100);
      calculated401kPreTax = Math.min(requested401k, remaining401kAllowed);
    }

    const maxHsaAnnualCap = dto.dependentsCount > 0 ? 7750 : 3850;
    const remainingHsaAllowed = Math.max(0, maxHsaAnnualCap - dto.ytdHsaContribution);
    const calculatedHsaPreTax = Math.min(dto.hsaContribution || 0, remainingHsaAllowed);

    let healthPrem = dto.healthInsurancePremium || 0;
    let dentalPrem = dto.dentalInsurancePremium || 0;
    let visionPrem = dto.visionInsurancePremium || 0;

    if (dto.employmentType === EmploymentType.PART_TIME) {
      healthPrem *= 1.25;
      dentalPrem *= 1.25;
      visionPrem *= 1.25;
    }

    const maxFsaAnnualCap = 3050;
    const calculatedFsaPreTax = Math.min(dto.fsaContribution || 0, maxFsaAnnualCap / freqFactor);

    const totalPreTaxDeductions =
      calculated401kPreTax +
      calculatedHsaPreTax +
      healthPrem +
      dentalPrem +
      visionPrem +
      calculatedFsaPreTax;

    return {
      calculated401kPreTax,
      remaining401kAllowed,
      calculatedHsaPreTax,
      healthPrem,
      dentalPrem,
      visionPrem,
      calculatedFsaPreTax,
      totalPreTaxDeductions,
    };
  }

  private calculateSocialSecurityTax(ytdGrossPay: number, taxableIncomeForTaxes: number): number {
    const ssCap = 160200;
    if (ytdGrossPay < ssCap) {
      const ssTaxableWage = Math.min(taxableIncomeForTaxes, ssCap - ytdGrossPay);
      return ssTaxableWage * 0.062;
    }
    return 0;
  }

  private calculateMedicareTax(
    ytdGrossPay: number,
    taxableIncomeForTaxes: number,
    filingStatus: FilingStatus,
  ): number {
    let medicareTax = taxableIncomeForTaxes * 0.0145;
    const addMedThreshold = filingStatus === FilingStatus.MARRIED_JOINT ? 250000 : 200000;
    const newYtdGross = ytdGrossPay + taxableIncomeForTaxes;

    if (newYtdGross > addMedThreshold) {
      const addMedTaxableWage = Math.min(
        taxableIncomeForTaxes,
        newYtdGross - Math.max(addMedThreshold, ytdGrossPay),
      );
      medicareTax += addMedTaxableWage * 0.009;
    }

    return medicareTax;
  }

  private calculateFederalTax(
    annualizedTaxableIncome: number,
    filingStatus: FilingStatus,
    dependentsCount: number,
    freqFactor: number,
  ): number {
    let fitStandardDeduction = 13850;
    if (filingStatus === FilingStatus.MARRIED_JOINT) {
      fitStandardDeduction = 27700;
    } else if (filingStatus === FilingStatus.HEAD_OF_HOUSEHOLD) {
      fitStandardDeduction = 20800;
    }

    const annualizedFitBase = Math.max(
      0,
      annualizedTaxableIncome - fitStandardDeduction - dependentsCount * 2000,
    );

    let annualFit = 0;
    if (annualizedFitBase > 578125) {
      annualFit += (annualizedFitBase - 578125) * 0.37 + 174238.5;
    } else if (annualizedFitBase > 231250) {
      annualFit += (annualizedFitBase - 231250) * 0.35 + 52832.25;
    } else if (annualizedFitBase > 182100) {
      annualFit += (annualizedFitBase - 182100) * 0.32 + 37104.25;
    } else if (annualizedFitBase > 95375) {
      annualFit += (annualizedFitBase - 95375) * 0.24 + 16290.25;
    } else if (annualizedFitBase > 44725) {
      annualFit += (annualizedFitBase - 44725) * 0.22 + 5147.25;
    } else if (annualizedFitBase > 11000) {
      annualFit += (annualizedFitBase - 11000) * 0.12 + 1100.0;
    } else {
      annualFit += annualizedFitBase * 0.1;
    }

    return Math.max(0, annualFit / freqFactor);
  }

  private calculateStateTaxAndSdi(
    state: USState,
    filingStatus: FilingStatus,
    annualizedTaxableIncome: number,
    taxableIncomeForTaxes: number,
    ytdGrossPay: number,
    freqFactor: number,
  ) {
    let annualSit = 0;
    let sdiTax = 0;

    switch (state) {
      case USState.TX:
      case USState.FL:
      case USState.WA:
        annualSit = 0;
        break;

      case USState.CA: {
        const caStdDeduction = filingStatus === FilingStatus.MARRIED_JOINT ? 10404 : 5202;
        const caTaxableBase = Math.max(0, annualizedTaxableIncome - caStdDeduction);

        if (caTaxableBase > 677275) {
          annualSit = (caTaxableBase - 677275) * 0.123 + 67232.0;
        } else if (caTaxableBase > 406364) {
          annualSit = (caTaxableBase - 406364) * 0.113 + 36619.0;
        } else if (caTaxableBase > 338639) {
          annualSit = (caTaxableBase - 338639) * 0.103 + 29643.0;
        } else if (caTaxableBase > 66295) {
          annualSit = (caTaxableBase - 66295) * 0.093 + 4310.0;
        } else if (caTaxableBase > 52443) {
          annualSit = (caTaxableBase - 52443) * 0.08 + 3202.0;
        } else if (caTaxableBase > 37788) {
          annualSit = (caTaxableBase - 37788) * 0.06 + 2323.0;
        } else if (caTaxableBase > 23942) {
          annualSit = (caTaxableBase - 23942) * 0.04 + 1769.0;
        } else if (caTaxableBase > 10099) {
          annualSit = (caTaxableBase - 10099) * 0.02 + 1214.0;
        } else {
          annualSit = caTaxableBase * 0.01;
        }

        if (caTaxableBase > 1000000) {
          annualSit += (caTaxableBase - 1000000) * 0.01;
        }

        const caSdiCap = 153164;
        if (ytdGrossPay < caSdiCap) {
          const sdiWage = Math.min(taxableIncomeForTaxes, caSdiCap - ytdGrossPay);
          sdiTax = sdiWage * 0.011;
        }
        break;
      }

      case USState.NY: {
        const nyStdDeduction = filingStatus === FilingStatus.MARRIED_JOINT ? 16050 : 8000;
        const nyTaxableBase = Math.max(0, annualizedTaxableIncome - nyStdDeduction);

        if (nyTaxableBase > 5000000) {
          annualSit = (nyTaxableBase - 5000000) * 0.109 + 482103.0;
        } else if (nyTaxableBase > 1077550) {
          annualSit = (nyTaxableBase - 1077550) * 0.0965 + 104036.0;
        } else if (nyTaxableBase > 215400) {
          annualSit = (nyTaxableBase - 215400) * 0.0685 + 13091.0;
        } else if (nyTaxableBase > 80650) {
          annualSit = (nyTaxableBase - 80650) * 0.0625 + 4669.0;
        } else if (nyTaxableBase > 13900) {
          annualSit = (nyTaxableBase - 13900) * 0.0585 + 764.0;
        } else {
          annualSit = nyTaxableBase * 0.04;
        }

        const nyPflWage = Math.min(taxableIncomeForTaxes, 1688.19);
        sdiTax = nyPflWage * 0.00455;
        break;
      }

      default: {
        annualSit = annualizedTaxableIncome * 0.045;
        break;
      }
    }

    const stateTax = Math.max(0, annualSit / freqFactor);
    return { stateTax, sdiTax };
  }

  private calculateGarnishments(
    dto: PayrollCalculationDto,
    disposablePay: number,
    freqFactor: number,
  ): number {
    if (!dto.garnishmentType || !dto.garnishmentAmount || dto.garnishmentAmount <= 0) {
      return 0;
    }

    switch (dto.garnishmentType) {
      case GarnishmentType.CHILD_SUPPORT: {
        const maxGarnishmentPct = dto.hasOtherDependentsForGarnishment ? 0.5 : 0.6;
        return Math.min(dto.garnishmentAmount, disposablePay * maxGarnishmentPct);
      }
      case GarnishmentType.CREDITOR_GARNISHMENT: {
        const maxCreditorPct = disposablePay * 0.25;
        const minWageThreshold = (40 / 52) * freqFactor * 7.25 * 30;
        const protectedDisposable = Math.max(0, disposablePay - minWageThreshold);
        return Math.min(dto.garnishmentAmount, maxCreditorPct, protectedDisposable);
      }
      case GarnishmentType.FEDERAL_TAX_LEVY: {
        const exemptAmount = (13850 / freqFactor) + (dto.dependentsCount * 4300 / freqFactor);
        return Math.min(dto.garnishmentAmount, Math.max(0, disposablePay - exemptAmount));
      }
    }
  }

  private calculateRoth401k(
    dto: PayrollCalculationDto,
    calculated401kPreTax: number,
    remaining401kAllowed: number,
  ): number {
    if (dto.flatRoth401k && dto.flatRoth401k > 0) {
      const maxRothAllowed = Math.max(0, remaining401kAllowed - calculated401kPreTax);
      return Math.min(dto.flatRoth401k, maxRothAllowed);
    }
    return 0;
  }

  private calculateEmployerCosts(
    dto: PayrollCalculationDto,
    grossPay: number,
    taxableIncomeForTaxes: number,
    calculated401kPreTax: number,
    healthPrem: number,
    socialSecurityTax: number,
    nonTaxableStipends: number,
    freqFactor: number,
  ) {
    const eligibleCompFor401kMatch = Math.min(grossPay, 330000 / freqFactor);
    let employer401kMatch = 0;
    const emp401kPct = grossPay > 0 ? calculated401kPreTax / grossPay : 0;

    if (emp401kPct > 0) {
      const tier1Match = Math.min(emp401kPct, 0.03) * eligibleCompFor401kMatch;
      const tier2Match =
        Math.max(0, Math.min(emp401kPct, 0.05) - 0.03) * 0.5 * eligibleCompFor401kMatch;
      employer401kMatch = tier1Match + tier2Match;
    }

    const employerSSMatch = socialSecurityTax;
    const employerMedicareMatch = taxableIncomeForTaxes * 0.0145;

    const futaCap = 7000;
    let futaTax = 0;
    if (dto.ytdGrossPay < futaCap) {
      const futaWage = Math.min(grossPay, futaCap - dto.ytdGrossPay);
      futaTax = futaWage * 0.006;
    }

    let sutaCap = 9000;
    if (dto.state === USState.CA) sutaCap = 7000;
    if (dto.state === USState.NY) sutaCap = 12300;

    let sutaTax = 0;
    if (dto.ytdGrossPay < sutaCap) {
      const sutaWage = Math.min(grossPay, sutaCap - dto.ytdGrossPay);
      sutaTax = sutaWage * 0.027;
    }

    let employerHealthContribution = 0;
    if (dto.employmentType === EmploymentType.FULL_TIME) {
      employerHealthContribution = healthPrem * 4;
    } else if (dto.employmentType === EmploymentType.PART_TIME) {
      employerHealthContribution = healthPrem * 1.5;
    }

    const totalEmployerCost =
      grossPay +
      employerSSMatch +
      employerMedicareMatch +
      futaTax +
      sutaTax +
      employer401kMatch +
      employerHealthContribution +
      nonTaxableStipends;

    return {
      socialSecurityMatch: employerSSMatch,
      medicareMatch: employerMedicareMatch,
      futaTax,
      sutaTax,
      matching401k: employer401kMatch,
      employerHealthContribution,
      totalEmployerCost,
    };
  }

  private round(val: number): number {
    return Math.round(val * 100) / 100;
  }

  private getPayFrequencyFactor(freq: PayFrequency): number {
    switch (freq) {
      case PayFrequency.WEEKLY:
        return 52;
      case PayFrequency.BIWEEKLY:
        return 26;
      case PayFrequency.SEMIMONTHLY:
        return 24;
      case PayFrequency.MONTHLY:
        return 12;
      default:
        return 26;
    }
  }
}