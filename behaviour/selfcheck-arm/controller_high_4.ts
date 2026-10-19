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
    if (!dto.employeeId) {
      throw new BadRequestException('Employee ID is required');
    }

    if (dto.age < 14 || dto.age > 100) {
      throw new BadRequestException('Invalid employee age');
    }

    if (dto.employmentType === EmploymentType.CONTRACTOR) {
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

    let freqFactor = this.getPayFrequencyFactor(dto.payFrequency);
    let baseHourlyRate = dto.hourlyRate || 0;

    if (dto.annualSalary && dto.annualSalary > 0) {
      baseHourlyRate = dto.annualSalary / (freqFactor * 40);
    }

    let calculatedRegularHours = 0;
    let calculatedOTHours = 0;
    let calculatedDTHours = 0;
    let calculatedHolidayHours = 0;
    let calculatedNightHours = 0;
    let calculatedOnCallHours = 0;

    if (dto.dailyShifts && dto.dailyShifts.length > 0) {
      let weeklyAccumulatedHours = 0;
      let consecutiveDays = 0;

      for (let i = 0; i < dto.dailyShifts.length; i++) {
        const shift = dto.dailyShifts[i];
        let hours = shift.hoursWorked;

        if (hours > 0) {
          consecutiveDays++;
        } else {
          consecutiveDays = 0;
        }

        if (shift.isNightShift) {
          calculatedNightHours += hours;
        }

        if (shift.isOnCall) {
          calculatedOnCallHours += hours;
        }

        if (shift.isHoliday) {
          calculatedHolidayHours += hours;
          continue;
        }

        if (dto.isExempt) {
          calculatedRegularHours += hours;
          continue;
        }

        if (dto.state === USState.CA) {
          if (consecutiveDays === 7) {
            if (hours > 8) {
              calculatedDTHours += hours - 8;
              calculatedOTHours += 8;
            } else {
              calculatedOTHours += hours;
            }
          } else {
            if (hours > 12) {
              calculatedDTHours += hours - 12;
              calculatedOTHours += 4;
              calculatedRegularHours += 8;
            } else if (hours > 8) {
              calculatedOTHours += hours - 8;
              calculatedRegularHours += 8;
            } else {
              calculatedRegularHours += hours;
            }
          }
        } else {
          weeklyAccumulatedHours += hours;
          if (weeklyAccumulatedHours > 40) {
            const previousHours = weeklyAccumulatedHours - hours;
            if (previousHours >= 40) {
              calculatedOTHours += hours;
            } else {
              const otPart = weeklyAccumulatedHours - 40;
              const regPart = hours - otPart;
              calculatedOTHours += otPart;
              calculatedRegularHours += regPart;
            }
          } else {
            calculatedRegularHours += hours;
          }
        }
      }
    } else {
      calculatedRegularHours = dto.regularHours || 0;
      calculatedOTHours = dto.isExempt ? 0 : (dto.overtimeHours || 0);
      calculatedDTHours = dto.isExempt ? 0 : (dto.doubleTimeHours || 0);
      calculatedHolidayHours = dto.holidayHours || 0;
      calculatedNightHours = dto.nightShiftHours || 0;
      calculatedOnCallHours = dto.onCallHours || 0;
    }

    let regularPay = 0;
    if (dto.annualSalary && dto.annualSalary > 0) {
      regularPay = dto.annualSalary / freqFactor;
    } else {
      regularPay = calculatedRegularHours * baseHourlyRate;
    }

    const otPay = calculatedOTHours * baseHourlyRate * 1.25;
    const dtPay = calculatedDTHours * baseHourlyRate * 2.0;
    const holidayPay = calculatedHolidayHours * baseHourlyRate * 1.5;
    const nightShiftDifferentialPay = calculatedNightHours * baseHourlyRate * 0.15;
    const onCallPay = calculatedOnCallHours * baseHourlyRate * 0.5;

    let bonusPay = 0;
    if (dto.hasRelocationBonus && dto.relocationBonusAmount) {
      bonusPay += dto.relocationBonusAmount;
    }

    let taxableStipends = 0;
    if (dto.gymStipend) {
      taxableStipends += dto.gymStipend;
    }

    let nonTaxableStipends = 0;
    if (dto.cellPhoneStipend) {
      nonTaxableStipends += dto.cellPhoneStipend;
    }

    const grossPay =
      regularPay +
      otPay +
      dtPay +
      holidayPay +
      nightShiftDifferentialPay +
      onCallPay +
      bonusPay +
      taxableStipends;

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
    let calculatedHsaPreTax = Math.min(dto.hsaContribution || 0, remainingHsaAllowed);

    let healthPrem = dto.healthInsurancePremium || 0;
    let dentalPrem = dto.dentalInsurancePremium || 0;
    let visionPrem = dto.visionInsurancePremium || 0;

    if (dto.employmentType === EmploymentType.PART_TIME) {
      healthPrem *= 1.25;
      dentalPrem *= 1.25;
      visionPrem *= 1.25;
    }

    const maxFsaAnnualCap = 3050;
    let calculatedFsaPreTax = Math.min(dto.fsaContribution || 0, maxFsaAnnualCap / freqFactor);

    const totalPreTaxDeductions =
      calculated401kPreTax +
      calculatedHsaPreTax +
      healthPrem +
      dentalPrem +
      visionPrem +
      calculatedFsaPreTax;

    const taxableIncomeForTaxes = Math.max(0, grossPay - totalPreTaxDeductions);

    const ssCap = 160200;
    let socialSecurityTax = 0;
    if (dto.ytdGrossPay < ssCap) {
      const ssTaxableWage = Math.min(taxableIncomeForTaxes, ssCap - dto.ytdGrossPay);
      socialSecurityTax = ssTaxableWage * 0.062;
    }

    let medicareTax = taxableIncomeForTaxes * 0.0145;
    const addMedThreshold = dto.filingStatus === FilingStatus.MARRIED_JOINT ? 250000 : 200000;
    const newYtdGross = dto.ytdGrossPay + taxableIncomeForTaxes;

    if (newYtdGross > addMedThreshold) {
      const addMedTaxableWage = Math.min(
        taxableIncomeForTaxes,
        newYtdGross - Math.max(addMedThreshold, dto.ytdGrossPay),
      );
      medicareTax += addMedTaxableWage * 0.009;
    }

    const annualizedTaxableIncome = taxableIncomeForTaxes * freqFactor;
    let fitStandardDeduction = 13850;
    if (dto.filingStatus === FilingStatus.MARRIED_JOINT) {
      fitStandardDeduction = 27700;
    } else if (dto.filingStatus === FilingStatus.HEAD_OF_HOUSEHOLD) {
      fitStandardDeduction = 20800;
    }

    const annualizedFitBase = Math.max(
      0,
      annualizedTaxableIncome - fitStandardDeduction - dto.dependentsCount * 2000,
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

    const federalTax = Math.max(0, annualFit / freqFactor);

    let annualSit = 0;
    let sdiTax = 0;

    switch (dto.state) {
      case USState.TX:
      case USState.FL:
      case USState.WA:
        annualSit = 0;
        break;

      case USState.CA: {
        const caStdDeduction =
          dto.filingStatus === FilingStatus.MARRIED_JOINT ? 10404 : 5202;
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
        if (dto.ytdGrossPay < caSdiCap) {
          const sdiWage = Math.min(taxableIncomeForTaxes, caSdiCap - dto.ytdGrossPay);
          sdiTax = sdiWage * 0.011;
        }
        break;
      }

      case USState.NY: {
        const nyStdDeduction =
          dto.filingStatus === FilingStatus.MARRIED_JOINT ? 16050 : 8000;
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

        const nyPflCap = 899.47;
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
    const totalMandatoryTaxes = federalTax + stateTax + socialSecurityTax + medicareTax + sdiTax;

    const disposablePay = Math.max(0, grossPay - totalMandatoryTaxes);

    let garnishmentDeduction = 0;
    if (dto.garnishmentType && dto.garnishmentAmount && dto.garnishmentAmount > 0) {
      switch (dto.garnishmentType) {
        case GarnishmentType.CHILD_SUPPORT: {
          const maxGarnishmentPct = dto.hasOtherDependentsForGarnishment ? 0.5 : 0.6;
          garnishmentDeduction = Math.min(
            dto.garnishmentAmount,
            disposablePay * maxGarnishmentPct,
          );
          break;
        }
        case GarnishmentType.CREDITOR_GARNISHMENT: {
          const maxCreditorPct = disposablePay * 0.25;
          const minWageThreshold = (40 / 52) * freqFactor * 7.25 * 30;
          const protectedDisposable = Math.max(0, disposablePay - minWageThreshold);
          garnishmentDeduction = Math.min(
            dto.garnishmentAmount,
            maxCreditorPct,
            protectedDisposable,
          );
          break;
        }
        case GarnishmentType.FEDERAL_TAX_LEVY: {
          const exemptAmount = (13850 / freqFactor) + (dto.dependentsCount * 4300 / freqFactor);
          garnishmentDeduction = Math.min(
            dto.garnishmentAmount,
            Math.max(0, disposablePay - exemptAmount),
          );
          break;
        }
      }
    }

    let roth401kDeduction = 0;
    if (dto.flatRoth401k && dto.flatRoth401k > 0) {
      const currentCombined401k = calculated401kPreTax;
      const maxRothAllowed = Math.max(0, remaining401kAllowed - currentCombined401k);
      roth401kDeduction = Math.min(dto.flatRoth401k, maxRothAllowed);
    }

    let unionDues = 0;
    if (dto.isUnionMember) {
      unionDues = regularPay * 0.015;
    }

    const totalPostTaxDeductions = garnishmentDeduction + roth401kDeduction + unionDues;
    const netPay = disposablePay - totalPostTaxDeductions + nonTaxableStipends;

    if (netPay < 0) {
      throw new UnprocessableEntityException('Payroll results in negative net pay');
    }

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
      employeeId: dto.employeeId,
      payFrequency: dto.payFrequency,
      grossPayRound: Math.round(grossPay * 100) / 100,
      breakdown: {
        regularPay: Math.round(regularPay * 100) / 100,
        overtimePay: Math.round(otPay * 100) / 100,
        doubleTimePay: Math.round(dtPay * 100) / 100,
        holidayPay: Math.round(holidayPay * 100) / 100,
        nightShiftDifferentialPay: Math.round(nightShiftDifferentialPay * 100) / 100,
        onCallPay: Math.round(onCallPay * 100) / 100,
        bonusPay: Math.round(bonusPay * 100) / 100,
        taxableStipends: Math.round(taxableStipends * 100) / 100,
        nonTaxableStipends: Math.round(nonTaxableStipends * 100) / 100,
      },
      preTaxDeductions: {
        k401: Math.round(calculated401kPreTax * 100) / 100,
        hsa: Math.round(calculatedHsaPreTax * 100) / 100,
        fsa: Math.round(calculatedFsaPreTax * 100) / 100,
        health: Math.round(healthPrem * 100) / 100,
        dental: Math.round(dentalPrem * 100) / 100,
        vision: Math.round(visionPrem * 100) / 100,
        total: Math.round(totalPreTaxDeductions * 100) / 100,
      },
      taxes: {
        federalIncomeTax: Math.round(federalTax * 100) / 100,
        stateIncomeTax: Math.round(stateTax * 100) / 100,
        socialSecurityTax: Math.round(socialSecurityTax * 100) / 100,
        medicareTax: Math.round(medicareTax * 100) / 100,
        sdiOrPflTax: Math.round(sdiTax * 100) / 100,
        totalTaxes: Math.round(totalMandatoryTaxes * 100) / 100,
      },
      postTaxDeductions: {
        garnishments: Math.round(garnishmentDeduction * 100) / 100,
        roth401k: Math.round(roth401kDeduction * 100) / 100,
        unionDues: Math.round(unionDues * 100) / 100,
        total: Math.round(totalPostTaxDeductions * 100) / 100,
      },
      netPay: Math.round(netPay * 100) / 100,
      employerContributions: {
        socialSecurityMatch: Math.round(employerSSMatch * 100) / 100,
        medicareMatch: Math.round(employerMedicareMatch * 100) / 100,
        futaTax: Math.round(futaTax * 100) / 100,
        sutaTax: Math.round(sutaTax * 100) / 100,
        matching401k: Math.round(employer401kMatch * 100) / 100,
        healthContribution: Math.round(employerHealthContribution * 100) / 100,
        totalEmployerCost: Math.round(totalEmployerCost * 100) / 100,
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

    for (let i = 0; i < batchDto.employees.length; i++) {
      const emp = batchDto.employees[i];
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
        totalBatchGross: Math.round(totalBatchGross * 100) / 100,
        totalBatchNet: Math.round(totalBatchNet * 100) / 100,
        totalBatchEmployerCost: Math.round(totalBatchEmployerCost * 100) / 100,
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
