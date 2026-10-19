import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
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

interface TaxBracket {
  min: number;
  rate: number;
  baseTax: number;
}

const FIT_BRACKETS: TaxBracket[] = [
  { min: 578125, rate: 0.37, baseTax: 174238.5 },
  { min: 231250, rate: 0.35, baseTax: 52832.25 },
  { min: 182100, rate: 0.32, baseTax: 37104.25 },
  { min: 95375, rate: 0.24, baseTax: 16290.25 },
  { min: 44725, rate: 0.22, baseTax: 5147.25 },
  { min: 11000, rate: 0.12, baseTax: 1100.0 },
  { min: 0, rate: 0.1, baseTax: 0 },
];

const CA_BRACKETS: TaxBracket[] = [
  { min: 677275, rate: 0.123, baseTax: 67232.0 },
  { min: 406364, rate: 0.113, baseTax: 36619.0 },
  { min: 338639, rate: 0.103, baseTax: 29643.0 },
  { min: 66295, rate: 0.093, baseTax: 4310.0 },
  { min: 52443, rate: 0.08, baseTax: 3202.0 },
  { min: 37788, rate: 0.06, baseTax: 2323.0 },
  { min: 23942, rate: 0.04, baseTax: 1769.0 },
  { min: 10099, rate: 0.02, baseTax: 1214.0 },
  { min: 0, rate: 0.01, baseTax: 0 },
];

const NY_BRACKETS: TaxBracket[] = [
  { min: 5000000, rate: 0.109, baseTax: 482103.0 },
  { min: 1077550, rate: 0.0965, baseTax: 104036.0 },
  { min: 215400, rate: 0.0685, baseTax: 13091.0 },
  { min: 80650, rate: 0.0625, baseTax: 4669.0 },
  { min: 13900, rate: 0.0585, baseTax: 764.0 },
  { min: 0, rate: 0.04, baseTax: 0 },
];

interface WorkedHours {
  regular: number;
  overtime: number;
  doubleTime: number;
  holiday: number;
  nightShift: number;
  onCall: number;
}

interface PayBreakdown {
  regularPay: number;
  otPay: number;
  dtPay: number;
  holidayPay: number;
  nightShiftDifferentialPay: number;
  onCallPay: number;
  bonusPay: number;
  taxableStipends: number;
  nonTaxableStipends: number;
  grossPay: number;
}

interface PreTaxDeductions {
  k401: number;
  hsa: number;
  health: number;
  dental: number;
  vision: number;
  fsa: number;
  total: number;
  remaining401kAllowed: number;
}

interface TaxesResult {
  federalTax: number;
  stateTax: number;
  socialSecurityTax: number;
  medicareTax: number;
  sdiTax: number;
  totalTaxes: number;
  taxableIncomeForTaxes: number;
}

interface PostTaxDeductions {
  garnishments: number;
  roth401k: number;
  unionDues: number;
  total: number;
}

interface EmployerContributions {
  socialSecurityMatch: number;
  medicareMatch: number;
  futaTax: number;
  sutaTax: number;
  matching401k: number;
  healthContribution: number;
  totalEmployerCost: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateBracketTax(baseAmount: number, brackets: TaxBracket[]): number {
  const bracket = brackets.find((b) => baseAmount > b.min) || brackets[brackets.length - 1];
  return (baseAmount - bracket.min) * bracket.rate + bracket.baseTax;
}

function validatePayrollDto(dto: PayrollCalculationDto): void {
  if (!dto.employeeId) {
    throw new BadRequestException('Employee ID is required');
  }
  if (dto.age < 14 || dto.age > 100) {
    throw new BadRequestException('Invalid employee age');
  }
}

function processCaShift(hours: number, consecutiveDays: number, hoursAcc: WorkedHours): void {
  if (consecutiveDays === 7) {
    if (hours > 8) {
      hoursAcc.doubleTime += hours - 8;
      hoursAcc.overtime += 8;
    } else {
      hoursAcc.overtime += hours;
    }
  } else {
    if (hours > 12) {
      hoursAcc.doubleTime += hours - 12;
      hoursAcc.overtime += 4;
      hoursAcc.regular += 8;
    } else if (hours > 8) {
      hoursAcc.overtime += hours - 8;
      hoursAcc.regular += 8;
    } else {
      hoursAcc.regular += hours;
    }
  }
}

function processStandardShift(
  hours: number,
  weeklyAccumulatedHours: number,
  hoursAcc: WorkedHours,
): number {
  const updatedWeeklyHours = weeklyAccumulatedHours + hours;
  if (updatedWeeklyHours > 40) {
    if (weeklyAccumulatedHours >= 40) {
      hoursAcc.overtime += hours;
    } else {
      const overtimePart = updatedWeeklyHours - 40;
      const regularPart = hours - overtimePart;
      hoursAcc.overtime += overtimePart;
      hoursAcc.regular += regularPart;
    }
  } else {
    hoursAcc.regular += hours;
  }
  return updatedWeeklyHours;
}

function getFallbackWorkedHours(dto: PayrollCalculationDto): WorkedHours {
  return {
    regular: dto.regularHours || 0,
    overtime: dto.isExempt ? 0 : dto.overtimeHours || 0,
    doubleTime: dto.isExempt ? 0 : dto.doubleTimeHours || 0,
    holiday: dto.holidayHours || 0,
    nightShift: dto.nightShiftHours || 0,
    onCall: dto.onCallHours || 0,
  };
}

function processShiftItem(
  shift: DailyShiftDto,
  isExempt: boolean,
  isCaState: boolean,
  state: { consecutiveDays: number; weeklyAccumulatedHours: number },
  hoursAcc: WorkedHours,
): void {
  const hours = shift.hoursWorked;
  state.consecutiveDays = hours > 0 ? state.consecutiveDays + 1 : 0;

  if (shift.isNightShift) hoursAcc.nightShift += hours;
  if (shift.isOnCall) hoursAcc.onCall += hours;

  if (shift.isHoliday) {
    hoursAcc.holiday += hours;
    return;
  }

  if (isExempt) {
    hoursAcc.regular += hours;
    return;
  }

  if (isCaState) {
    processCaShift(hours, state.consecutiveDays, hoursAcc);
  } else {
    state.weeklyAccumulatedHours = processStandardShift(hours, state.weeklyAccumulatedHours, hoursAcc);
  }
}

function calculateWorkedHours(dto: PayrollCalculationDto): WorkedHours {
  if (!dto.dailyShifts?.length) {
    return getFallbackWorkedHours(dto);
  }

  const hoursAcc: WorkedHours = {
    regular: 0,
    overtime: 0,
    doubleTime: 0,
    holiday: 0,
    nightShift: 0,
    onCall: 0,
  };

  const state = { consecutiveDays: 0, weeklyAccumulatedHours: 0 };
  const isCaState = dto.state === USState.CA;

  for (const shift of dto.dailyShifts) {
    processShiftItem(shift, dto.isExempt, isCaState, state, hoursAcc);
  }

  return hoursAcc;
}

function calculatePayBreakdown(
  dto: PayrollCalculationDto,
  hours: WorkedHours,
  freqFactor: number,
): PayBreakdown {
  const hasSalary = Boolean(dto.annualSalary && dto.annualSalary > 0);
  const baseHourlyRate = hasSalary
    ? (dto.annualSalary as number) / (freqFactor * 40)
    : dto.hourlyRate || 0;

  const regularPay = hasSalary
    ? (dto.annualSalary as number) / freqFactor
    : hours.regular * baseHourlyRate;

  const otPay = hours.overtime * baseHourlyRate * 1.5;
  const dtPay = hours.doubleTime * baseHourlyRate * 2.0;
  const holidayPay = hours.holiday * baseHourlyRate * 1.5;
  const nightShiftDifferentialPay = hours.nightShift * baseHourlyRate * 0.15;
  const onCallPay = hours.onCall * baseHourlyRate * 0.5;
  const bonusPay = dto.hasRelocationBonus && dto.relocationBonusAmount ? dto.relocationBonusAmount : 0;
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

  return {
    regularPay,
    otPay,
    dtPay,
    holidayPay,
    nightShiftDifferentialPay,
    onCallPay,
    bonusPay,
    taxableStipends,
    nonTaxableStipends,
    grossPay,
  };
}

function calculatePreTaxDeductions(
  dto: PayrollCalculationDto,
  grossPay: number,
  freqFactor: number,
): PreTaxDeductions {
  const max401kCap = dto.age >= 50 ? 30000 : 22500;
  const remaining401kAllowed = Math.max(0, max401kCap - dto.ytd401kContribution);
  const k401 = dto.percent401k > 0
    ? Math.min(grossPay * (dto.percent401k / 100), remaining401kAllowed)
    : 0;

  const maxHsaCap = dto.dependentsCount > 0 ? 7750 : 3850;
  const remainingHsaAllowed = Math.max(0, maxHsaCap - dto.ytdHsaContribution);
  const hsa = Math.min(dto.hsaContribution || 0, remainingHsaAllowed);

  const premiumMultiplier = dto.employmentType === EmploymentType.PART_TIME ? 1.25 : 1.0;
  const health = (dto.healthInsurancePremium || 0) * premiumMultiplier;
  const dental = (dto.dentalInsurancePremium || 0) * premiumMultiplier;
  const vision = (dto.visionInsurancePremium || 0) * premiumMultiplier;

  const fsa = Math.min(dto.fsaContribution || 0, 3050 / freqFactor);
  const total = k401 + hsa + health + dental + vision + fsa;

  return { k401, hsa, health, dental, vision, fsa, total, remaining401kAllowed };
}

function getFitStandardDeduction(status: FilingStatus): number {
  if (status === FilingStatus.MARRIED_JOINT) return 27700;
  if (status === FilingStatus.HEAD_OF_HOUSEHOLD) return 20800;
  return 13850;
}

function calculateStateTaxAndSdi(
  state: USState,
  filingStatus: FilingStatus,
  annualizedTaxableIncome: number,
  taxableIncomeForTaxes: number,
  ytdGrossPay: number,
  freqFactor: number,
): { stateTax: number; sdiTax: number } {
  let annualSit = 0;
  let sdiTax = 0;

  if (state === USState.CA) {
    const caStdDeduction = filingStatus === FilingStatus.MARRIED_JOINT ? 10404 : 5202;
    const caTaxableBase = Math.max(0, annualizedTaxableIncome - caStdDeduction);
    annualSit = calculateBracketTax(caTaxableBase, CA_BRACKETS);
    if (caTaxableBase > 1000000) {
      annualSit += (caTaxableBase - 1000000) * 0.01;
    }
    if (ytdGrossPay < 153164) {
      const sdiWage = Math.min(taxableIncomeForTaxes, 153164 - ytdGrossPay);
      sdiTax = sdiWage * 0.011;
    }
  } else if (state === USState.NY) {
    const nyStdDeduction = filingStatus === FilingStatus.MARRIED_JOINT ? 16050 : 8000;
    const nyTaxableBase = Math.max(0, annualizedTaxableIncome - nyStdDeduction);
    annualSit = calculateBracketTax(nyTaxableBase, NY_BRACKETS);
    const nyPflWage = Math.min(taxableIncomeForTaxes, 1688.19);
    sdiTax = nyPflWage * 0.00455;
  } else if (state === USState.TX || state === USState.FL || state === USState.WA) {
    annualSit = 0;
  } else {
    annualSit = annualizedTaxableIncome * 0.045;
  }

  return {
    stateTax: Math.max(0, annualSit / freqFactor),
    sdiTax,
  };
}

function calculateMandatoryTaxes(
  dto: PayrollCalculationDto,
  grossPay: number,
  totalPreTaxDeductions: number,
  freqFactor: number,
): TaxesResult {
  const taxableIncomeForTaxes = Math.max(0, grossPay - totalPreTaxDeductions);

  let socialSecurityTax = 0;
  if (dto.ytdGrossPay < 160200) {
    const ssTaxableWage = Math.min(taxableIncomeForTaxes, 160200 - dto.ytdGrossPay);
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
  const fitStandardDeduction = getFitStandardDeduction(dto.filingStatus);
  const annualizedFitBase = Math.max(
    0,
    annualizedTaxableIncome - fitStandardDeduction - dto.dependentsCount * 2000,
  );

  const federalTax = Math.max(0, calculateBracketTax(annualizedFitBase, FIT_BRACKETS) / freqFactor);

  const stateResult = calculateStateTaxAndSdi(
    dto.state,
    dto.filingStatus,
    annualizedTaxableIncome,
    taxableIncomeForTaxes,
    dto.ytdGrossPay,
    freqFactor,
  );

  const totalTaxes = federalTax + stateResult.stateTax + socialSecurityTax + medicareTax + stateResult.sdiTax;

  return {
    federalTax,
    stateTax: stateResult.stateTax,
    socialSecurityTax,
    medicareTax,
    sdiTax: stateResult.sdiTax,
    totalTaxes,
    taxableIncomeForTaxes,
  };
}

function calculateGarnishment(
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
      const exemptAmount = 13850 / freqFactor + (dto.dependentsCount * 4300) / freqFactor;
      return Math.min(dto.garnishmentAmount, Math.max(0, disposablePay - exemptAmount));
    }
    default:
      return 0;
  }
}

function calculatePostTaxDeductions(
  dto: PayrollCalculationDto,
  disposablePay: number,
  preTax401k: number,
  remaining401kAllowed: number,
  regularPay: number,
  freqFactor: number,
): PostTaxDeductions {
  const garnishments = calculateGarnishment(dto, disposablePay, freqFactor);

  let roth401k = 0;
  if (dto.flatRoth401k && dto.flatRoth401k > 0) {
    const maxRothAllowed = Math.max(0, remaining401kAllowed - preTax401k);
    roth401k = Math.min(dto.flatRoth401k, maxRothAllowed);
  }

  const unionDues = dto.isUnionMember ? regularPay * 0.015 : 0;
  const total = garnishments + roth401k + unionDues;

  return { garnishments, roth401k, unionDues, total };
}

function calculateEmployerContributions(
  dto: PayrollCalculationDto,
  grossPay: number,
  taxableIncomeForTaxes: number,
  calculated401kPreTax: number,
  socialSecurityTax: number,
  healthPrem: number,
  nonTaxableStipends: number,
  freqFactor: number,
): EmployerContributions {
  const eligibleCompFor401kMatch = Math.min(grossPay, 330000 / freqFactor);
  const emp401kPct = grossPay > 0 ? calculated401kPreTax / grossPay : 0;

  let matching401k = 0;
  if (emp401kPct > 0) {
    const tier1Match = Math.min(emp401kPct, 0.03) * eligibleCompFor401kMatch;
    const tier2Match = Math.max(0, Math.min(emp401kPct, 0.05) - 0.03) * 0.5 * eligibleCompFor401kMatch;
    matching401k = tier1Match + tier2Match;
  }

  const socialSecurityMatch = socialSecurityTax;
  const medicareMatch = taxableIncomeForTaxes * 0.0145;

  const futaTax = dto.ytdGrossPay < 7000
    ? Math.min(grossPay, 7000 - dto.ytdGrossPay) * 0.006
    : 0;

  const sutaCap = dto.state === USState.CA ? 7000 : dto.state === USState.NY ? 12300 : 9000;
  const sutaTax = dto.ytdGrossPay < sutaCap
    ? Math.min(grossPay, sutaCap - dto.ytdGrossPay) * 0.027
    : 0;

  let healthContribution = 0;
  if (dto.employmentType === EmploymentType.FULL_TIME) {
    healthContribution = healthPrem * 4;
  } else if (dto.employmentType === EmploymentType.PART_TIME) {
    healthContribution = healthPrem * 1.5;
  }

  const totalEmployerCost =
    grossPay +
    socialSecurityMatch +
    medicareMatch +
    futaTax +
    sutaTax +
    matching401k +
    healthContribution +
    nonTaxableStipends;

  return {
    socialSecurityMatch,
    medicareMatch,
    futaTax,
    sutaTax,
    matching401k,
    healthContribution,
    totalEmployerCost,
  };
}

function calculateContractorPaystub(dto: PayrollCalculationDto, freqFactor: number) {
  const gross = dto.annualSalary
    ? dto.annualSalary / freqFactor
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

function buildPaystubResponse(
  dto: PayrollCalculationDto,
  payBreakdown: PayBreakdown,
  preTax: PreTaxDeductions,
  taxes: TaxesResult,
  postTax: PostTaxDeductions,
  netPay: number,
  employer: EmployerContributions,
) {
  return {
    employeeId: dto.employeeId,
    payFrequency: dto.payFrequency,
    grossPayRound: round2(payBreakdown.grossPay),
    breakdown: {
      regularPay: round2(payBreakdown.regularPay),
      overtimePay: round2(payBreakdown.otPay),
      doubleTimePay: round2(payBreakdown.dtPay),
      holidayPay: round2(payBreakdown.holidayPay),
      nightShiftDifferentialPay: round2(payBreakdown.nightShiftDifferentialPay),
      onCallPay: round2(payBreakdown.onCallPay),
      bonusPay: round2(payBreakdown.bonusPay),
      taxableStipends: round2(payBreakdown.taxableStipends),
      nonTaxableStipends: round2(payBreakdown.nonTaxableStipends),
    },
    preTaxDeductions: {
      k401: round2(preTax.k401),
      hsa: round2(preTax.hsa),
      fsa: round2(preTax.fsa),
      health: round2(preTax.health),
      dental: round2(preTax.dental),
      vision: round2(preTax.vision),
      total: round2(preTax.total),
    },
    taxes: {
      federalIncomeTax: round2(taxes.federalTax),
      stateIncomeTax: round2(taxes.stateTax),
      socialSecurityTax: round2(taxes.socialSecurityTax),
      medicareTax: round2(taxes.medicareTax),
      sdiOrPflTax: round2(taxes.sdiTax),
      totalTaxes: round2(taxes.totalTaxes),
    },
    postTaxDeductions: {
      garnishments: round2(postTax.garnishments),
      roth401k: round2(postTax.roth401k),
      unionDues: round2(postTax.unionDues),
      total: round2(postTax.total),
    },
    netPay: round2(netPay),
    employerContributions: {
      socialSecurityMatch: round2(employer.socialSecurityMatch),
      medicareMatch: round2(employer.medicareMatch),
      futaTax: round2(employer.futaTax),
      sutaTax: round2(employer.sutaTax),
      matching401k: round2(employer.matching401k),
      healthContribution: round2(employer.healthContribution),
      totalEmployerCost: round2(employer.totalEmployerCost),
    },
  };
}

@Controller('payroll')
export class PayrollController {
  private draftStore = new Map<string, any>();
  private adjustmentStore = new Map<string, PayrollAdjustmentDto[]>();

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  calculatePaystub(@Body() dto: PayrollCalculationDto) {
    validatePayrollDto(dto);

    const freqFactor = this.getPayFrequencyFactor(dto.payFrequency);

    if (dto.employmentType === EmploymentType.CONTRACTOR) {
      return calculateContractorPaystub(dto, freqFactor);
    }

    const hours = calculateWorkedHours(dto);
    const payBreakdown = calculatePayBreakdown(dto, hours, freqFactor);
    const preTax = calculatePreTaxDeductions(dto, payBreakdown.grossPay, freqFactor);
    const taxes = calculateMandatoryTaxes(dto, payBreakdown.grossPay, preTax.total, freqFactor);

    const disposablePay = Math.max(0, payBreakdown.grossPay - taxes.totalTaxes);
    const postTax = calculatePostTaxDeductions(
      dto,
      disposablePay,
      preTax.k401,
      preTax.remaining401kAllowed,
      payBreakdown.regularPay,
      freqFactor,
    );

    const netPay = disposablePay - postTax.total + payBreakdown.nonTaxableStipends;
    if (netPay < 0) {
      throw new UnprocessableEntityException('Payroll results in negative net pay');
    }

    const employer = calculateEmployerContributions(
      dto,
      payBreakdown.grossPay,
      taxes.taxableIncomeForTaxes,
      preTax.k401,
      taxes.socialSecurityTax,
      preTax.health,
      payBreakdown.nonTaxableStipends,
      freqFactor,
    );

    return buildPaystubResponse(dto, payBreakdown, preTax, taxes, postTax, netPay, employer);
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