import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  Max,
  Matches,
  IsDefined,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
  ArrayMinSize,
  IsDateString
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum CustomerType {
  RESIDENTIAL = 'RESIDENTIAL',
  COMMERCIAL = 'COMMERCIAL',
  INDUSTRIAL = 'INDUSTRIAL',
  AGRICULTURAL = 'AGRICULTURAL'
}

export enum VoltageLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  EXTRA_HIGH = 'EXTRA_HIGH'
}

export enum MeterType {
  SINGLE_RATE = 'SINGLE_RATE',
  DUAL_RATE = 'DUAL_RATE',
  SMART_TIME_OF_USE = 'SMART_TIME_OF_USE'
}

export enum Season {
  SUMMER = 'SUMMER',
  WINTER = 'WINTER',
  SHOULDER = 'SHOULDER'
}

export enum DayType {
  WEEKDAY = 'WEEKDAY',
  WEEKEND = 'WEEKEND',
  HOLIDAY = 'HOLIDAY'
}

export enum TouRateType {
  PEAK = 'PEAK',
  OFF_PEAK = 'OFF_PEAK',
  SHOULDER = 'SHOULDER',
  CRITICAL_PEAK = 'CRITICAL_PEAK'
}

export enum SurchargeType {
  FIXED_MONTHLY = 'FIXED_MONTHLY',
  PERCENTAGE = 'PERCENTAGE',
  PER_KWH = 'PER_KWH',
  RENEWABLE_ENERGY = 'RENEWABLE_ENERGY',
  PEAK_DEMAND = 'PEAK_DEMAND'
}

export enum RebateType {
  SOLAR_FEED_IN = 'SOLAR_FEED_IN',
  LOW_INCOME = 'LOW_INCOME',
  EV_INCENTIVE = 'EV_INCENTIVE',
  HIGH_EFFICIENCY_EQUIPMENT = 'HIGH_EFFICIENCY_EQUIPMENT'
}

function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  return hours * 60 + minutes;
}

@ValidatorConstraint({ name: 'IsContinuousTiers', async: false })
export class IsContinuousTiersConstraint implements ValidatorConstraintInterface {
  validate(tiers: any[], args: ValidationArguments): boolean {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      return true;
    }

    const sorted = [...tiers].sort((a, b) => (a.minKwh ?? 0) - (b.minKwh ?? 0));

    if (sorted[0].minKwh !== 0) {
      return false;
    }

    return sorted.every((tier, i) => this.isValidTier(tier, sorted[i + 1]));
  }

  private isValidTier(current: any, next?: any): boolean {
    if (typeof current?.minKwh !== 'number' || current.minKwh < 0) {
      return false;
    }
    return next ? this.validateMiddleTier(current, next) : this.validateLastTier(current);
  }

  private validateMiddleTier(current: any, next: any): boolean {
    return typeof current.maxKwh === 'number' && current.maxKwh === next.minKwh;
  }

  private validateLastTier(current: any): boolean {
    if (current.maxKwh == null) {
      return true;
    }
    return typeof current.maxKwh === 'number' && current.maxKwh > current.minKwh;
  }

  defaultMessage(args: ValidationArguments): string {
    return 'Consumption tiers must start at 0 and be continuous without gaps or overlaps.';
  }
}

export function IsContinuousTiers(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsContinuousTiersConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'IsNonOverlappingTouWindows', async: false })
export class IsNonOverlappingTouWindowsConstraint implements ValidatorConstraintInterface {
  validate(rates: any[], args: ValidationArguments): boolean {
    if (!Array.isArray(rates) || rates.length === 0) {
      return true;
    }

    const seasons = Object.values(Season);
    const dayTypes = Object.values(DayType);

    for (const season of seasons) {
      for (const dayType of dayTypes) {
        const timeIntervals = this.collectIntervals(rates, season as Season, dayType as DayType);
        if (this.hasOverlap(timeIntervals)) {
          return false;
        }
      }
    }

    return true;
  }

  private collectIntervals(rates: any[], season: Season, dayType: DayType) {
    const timeIntervals: { start: number; end: number; rateName: string }[] = [];
    for (const rate of rates) {
      if (this.isRateApplicable(rate, season, dayType)) {
        this.addRateWindows(timeIntervals, rate);
      }
    }
    return timeIntervals;
  }

  private isRateApplicable(rate: any, season: Season, dayType: DayType): boolean {
    return Array.isArray(rate?.applicableSeasons) && rate.applicableSeasons.includes(season) &&
           Array.isArray(rate?.applicableDays) && rate.applicableDays.includes(dayType) &&
           Array.isArray(rate?.timeWindows);
  }

  private addRateWindows(intervals: { start: number; end: number; rateName: string }[], rate: any): void {
    for (const window of rate.timeWindows) {
      if (!window?.startTime || !window?.endTime) {
        continue;
      }
      const start = timeToMinutes(window.startTime);
      const end = timeToMinutes(window.endTime);

      if (start >= end) {
        intervals.push({ start, end: 1440, rateName: rate.name });
        intervals.push({ start: 0, end, rateName: rate.name });
      } else {
        intervals.push({ start, end, rateName: rate.name });
      }
    }
  }

  private hasOverlap(timeIntervals: { start: number; end: number; rateName: string }[]): boolean {
    timeIntervals.sort((a, b) => a.start - b.start);

    for (let i = 0; i < timeIntervals.length - 1; i++) {
      if (timeIntervals[i].end > timeIntervals[i + 1].start) {
        return true;
      }
    }

    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    return 'Time-Of-Use rate windows overlap for the same season and day type combination.';
  }
}

export function IsNonOverlappingTouWindows(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNonOverlappingTouWindowsConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'IsValidTariffEffectiveDates', async: false })
export class IsValidTariffEffectiveDatesConstraint implements ValidatorConstraintInterface {
  validate(effectiveTo: any, args: ValidationArguments): boolean {
    const object = args.object as any;
    if (!object.effectiveFrom || !effectiveTo) {
      return true;
    }
    const from = new Date(object.effectiveFrom);
    const to = new Date(effectiveTo);
    return to.getTime() > from.getTime();
  }

  defaultMessage(args: ValidationArguments): string {
    return 'Effective end date (effectiveTo) must be strictly after effective start date (effectiveFrom).';
  }
}

export class TimeWindowDto {
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be in HH:mm format' })
  startTime: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be in HH:mm format' })
  endTime: string;
}

export class TouRateDto {
  @IsString()
  name: string;

  @IsEnum(TouRateType)
  rateType: TouRateType;

  @IsNumber()
  @Min(0)
  ratePerKwh: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeWindowDto)
  @ArrayMinSize(1)
  timeWindows: TimeWindowDto[];

  @IsArray()
  @IsEnum(DayType, { each: true })
  @ArrayMinSize(1)
  applicableDays: DayType[];

  @IsArray()
  @IsEnum(Season, { each: true })
  @ArrayMinSize(1)
  applicableSeasons: Season[];
}

export class ConsumptionTierDto {
  @IsNumber()
  @Min(1)
  tierNumber: number;

  @IsNumber()
  @Min(0)
  minKwh: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxKwh?: number | null;

  @IsNumber()
  @Min(0)
  ratePerKwh: number;
}

export class DemandChargeConfigDto {
  @IsNumber()
  @Min(0)
  ratePerKw: number;

  @IsNumber()
  @Min(0)
  thresholdKw: number;

  @IsBoolean()
  peakOnly: boolean;

  @IsNumber()
  @Min(0)
  minBilledDemandKw: number;
}

export class SurchargeConfigDto {
  @IsString()
  name: string;

  @IsEnum(SurchargeType)
  surchargeType: SurchargeType;

  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minUsageThresholdKwh?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(CustomerType, { each: true })
  applicableCustomerTypes?: CustomerType[];
}

export class RebateConfigDto {
  @IsString()
  name: string;

  @IsEnum(RebateType)
  rebateType: RebateType;

  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minGenerationKwh?: number;
}

export class IntervalReadingDto {
  @IsDateString()
  timestamp: string;

  @IsNumber()
  @Min(0)
  kwhConsumption: number;

  @IsNumber()
  @Min(0)
  kwPeakDemand: number;
}

export class CustomerProfileDto {
  @IsEnum(CustomerType)
  type: CustomerType;

  @IsEnum(VoltageLevel)
  voltageLevel: VoltageLevel;

  @IsBoolean()
  isLowIncome: boolean;

  @IsBoolean()
  hasSolar: boolean;

  @IsNumber()
  @Min(0)
  solarCapacityKw: number;

  @IsNumber()
  @Min(1)
  phaseCount: number;

  @IsNumber()
  @Min(0)
  contractDemandKw: number;
}

export class TariffCalculationRequestDto {
  @IsString()
  tariffId: string;

  @ValidateNested()
  @Type(() => CustomerProfileDto)
  @IsDefined()
  customerProfile: CustomerProfileDto;

  @IsEnum(MeterType)
  meterType: MeterType;

  @IsDateString()
  effectiveFrom: string;

  @IsDateString()
  @Validate(IsValidTariffEffectiveDatesConstraint)
  effectiveTo: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsumptionTierDto)
  @IsContinuousTiers()
  tiers?: ConsumptionTierDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TouRateDto)
  @IsNonOverlappingTouWindows()
  touRates?: TouRateDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DemandChargeConfigDto)
  demandCharge?: DemandChargeConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SurchargeConfigDto)
  surcharges?: SurchargeConfigDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RebateConfigDto)
  rebates?: RebateConfigDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntervalReadingDto)
  @ArrayMinSize(1)
  intervalReadings: IntervalReadingDto[];

  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePercent: number;
}

export interface BillLineItem {
  category: 'ENERGY_TIER' | 'ENERGY_TOU' | 'DEMAND' | 'SURCHARGE' | 'REBATE' | 'TAX';
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

export interface DetailedBillCalculation {
  subtotalEnergy: number;
  subtotalDemand: number;
  subtotalSurcharges: number;
  subtotalRebates: number;
  subtotalBeforeTax: number;
  taxAmount: number;
  totalBillAmount: number;
  totalKwh: number;
  peakDemandKw: number;
  lineItems: BillLineItem[];
}

interface SurchargeCalculator {
  calculate(surchargeValue: number, totalKwh: number, subtotalEnergy: number, peakDemandKw: number): { qty: number; unitPrice: number; amount: number };
}

const SURCHARGE_STRATEGIES: Record<SurchargeType, SurchargeCalculator> = {
  [SurchargeType.FIXED_MONTHLY]: {
    calculate: (val) => ({ qty: 1, unitPrice: val, amount: val })
  },
  [SurchargeType.PER_KWH]: {
    calculate: (val, totalKwh) => ({ qty: totalKwh, unitPrice: val, amount: totalKwh * val })
  },
  [SurchargeType.PERCENTAGE]: {
    calculate: (val, _, subtotalEnergy) => ({ qty: subtotalEnergy, unitPrice: val / 100, amount: subtotalEnergy * (val / 100) })
  },
  [SurchargeType.PEAK_DEMAND]: {
    calculate: (val, _, __, peakDemandKw) => ({ qty: peakDemandKw, unitPrice: val, amount: peakDemandKw * val })
  },
  [SurchargeType.RENEWABLE_ENERGY]: {
    calculate: (val, totalKwh) => ({ qty: totalKwh, unitPrice: val, amount: totalKwh * val })
  }
};

interface RebateCalculator {
  isEligible(profile: CustomerProfileDto): boolean;
  calculateBaseAmount(value: number, totalKwh: number): number;
}

const REBATE_STRATEGIES: Record<RebateType, RebateCalculator> = {
  [RebateType.SOLAR_FEED_IN]: {
    isEligible: (profile) => profile.hasSolar,
    calculateBaseAmount: (val, totalKwh) => totalKwh * val
  },
  [RebateType.LOW_INCOME]: {
    isEligible: (profile) => profile.isLowIncome,
    calculateBaseAmount: (val) => val
  },
  [RebateType.EV_INCENTIVE]: {
    isEligible: () => true,
    calculateBaseAmount: (val) => val
  },
  [RebateType.HIGH_EFFICIENCY_EQUIPMENT]: {
    isEligible: () => true,
    calculateBaseAmount: (val) => val
  }
};

export class EnergyTariffEngine {
  public calculateBill(request: TariffCalculationRequestDto): DetailedBillCalculation {
    const { totalKwh, peakDemandKw } = this.aggregateReadings(request.intervalReadings);

    const energy = this.calculateEnergy(request, totalKwh);
    const demand = this.calculateDemand(request.demandCharge, peakDemandKw);
    const surcharges = this.calculateSurcharges(request, totalKwh, energy.total, peakDemandKw);
    const rebates = this.calculateRebates(request, totalKwh);

    const subtotalBeforeTax = energy.total + demand.total + surcharges.total - rebates.total;
    const effectiveSubtotal = Math.max(subtotalBeforeTax, 0);
    const tax = this.calculateTax(effectiveSubtotal, request.taxRatePercent);

    const lineItems: BillLineItem[] = [
      ...energy.lineItems,
      ...demand.lineItems,
      ...surcharges.lineItems,
      ...rebates.lineItems,
      ...(tax.lineItem ? [tax.lineItem] : [])
    ];

    return {
      subtotalEnergy: energy.total,
      subtotalDemand: demand.total,
      subtotalSurcharges: surcharges.total,
      subtotalRebates: rebates.total,
      subtotalBeforeTax,
      taxAmount: tax.taxAmount,
      totalBillAmount: effectiveSubtotal + tax.taxAmount,
      totalKwh,
      peakDemandKw,
      lineItems
    };
  }

  private aggregateReadings(readings: IntervalReadingDto[]): { totalKwh: number; peakDemandKw: number } {
    let totalKwh = 0;
    let peakDemandKw = 0;

    for (const reading of readings) {
      totalKwh += reading.kwhConsumption;
      if (reading.kwPeakDemand > peakDemandKw) {
        peakDemandKw = reading.kwPeakDemand;
      }
    }

    return { totalKwh, peakDemandKw };
  }

  private calculateEnergy(request: TariffCalculationRequestDto, totalKwh: number): { total: number; lineItems: BillLineItem[] } {
    if (request.meterType === MeterType.SINGLE_RATE && request.tiers?.length) {
      return this.calculateTieredEnergy(request.tiers, totalKwh);
    }
    const isTouMeter = request.meterType === MeterType.SMART_TIME_OF_USE || request.meterType === MeterType.DUAL_RATE;
    if (isTouMeter && request.touRates?.length) {
      return this.calculateTouEnergy(request.touRates, request.intervalReadings);
    }
    return { total: 0, lineItems: [] };
  }

  private calculateTieredEnergy(tiers: ConsumptionTierDto[], totalKwh: number): { total: number; lineItems: BillLineItem[] } {
    const lineItems: BillLineItem[] = [];
    let subtotalEnergy = 0;
    const sortedTiers = [...tiers].sort((a, b) => a.minKwh - b.minKwh);
    let remainingKwh = totalKwh;

    for (const tier of sortedTiers) {
      if (remainingKwh <= 0) break;

      const tierCapacity = (tier.maxKwh !== null && tier.maxKwh !== undefined) 
        ? tier.maxKwh - tier.minKwh 
        : Infinity;
      
      const kwhInTier = Math.min(remainingKwh, tierCapacity);
      const tierCost = kwhInTier * tier.ratePerKwh;
      subtotalEnergy += tierCost;

      lineItems.push({
        category: 'ENERGY_TIER',
        description: `Tier ${tier.tierNumber} (${tier.minKwh} - ${tier.maxKwh ?? '∞'} kWh)`,
        quantity: kwhInTier,
        unitPrice: tier.ratePerKwh,
        totalAmount: tierCost
      });

      remainingKwh -= kwhInTier;
    }

    return { total: subtotalEnergy, lineItems };
  }

  private calculateTouEnergy(touRates: TouRateDto[], readings: IntervalReadingDto[]): { total: number; lineItems: BillLineItem[] } {
    const lineItems: BillLineItem[] = [];
    let subtotalEnergy = 0;
    const touConsumption = new Map<string, { rate: TouRateDto; kwh: number }>();

    for (const touRate of touRates) {
      touConsumption.set(touRate.name, { rate: touRate, kwh: 0 });
    }

    for (const reading of readings) {
      const matchedRate = this.matchTouRate(reading, touRates);
      const entry = touConsumption.get(matchedRate.name)!;
      entry.kwh += reading.kwhConsumption;
    }

    for (const [name, data] of touConsumption.entries()) {
      if (data.kwh > 0) {
        const cost = data.kwh * data.rate.ratePerKwh;
        subtotalEnergy += cost;
        lineItems.push({
          category: 'ENERGY_TOU',
          description: `TOU Rate: ${name} (${data.rate.rateType})`,
          quantity: data.kwh,
          unitPrice: data.rate.ratePerKwh,
          totalAmount: cost
        });
      }
    }

    return { total: subtotalEnergy, lineItems };
  }

  private matchTouRate(reading: IntervalReadingDto, touRates: TouRateDto[]): TouRateDto {
    const date = new Date(reading.timestamp);
    const season = this.getSeasonFromDate(date);
    const dayType = this.getDayTypeFromDate(date);
    const minutes = date.getHours() * 60 + date.getMinutes();

    for (const touRate of touRates) {
      if (!touRate.applicableSeasons.includes(season)) continue;
      if (!touRate.applicableDays.includes(dayType)) continue;

      for (const window of touRate.timeWindows) {
        const start = timeToMinutes(window.startTime);
        const end = timeToMinutes(window.endTime);
        const inWindow = start >= end 
          ? (minutes >= start || minutes < end)
          : (minutes >= start && minutes < end);

        if (inWindow) return touRate;
      }
    }

    return touRates[0];
  }

  private calculateDemand(demandCharge?: DemandChargeConfigDto, peakDemandKw: number = 0): { total: number; lineItems: BillLineItem[] } {
    if (!demandCharge) return { total: 0, lineItems: [] };

    const billableDemand = Math.max(peakDemandKw - demandCharge.thresholdKw, demandCharge.minBilledDemandKw, 0);
    if (billableDemand <= 0) return { total: 0, lineItems: [] };

    const total = billableDemand * demandCharge.ratePerKw;
    const lineItems: BillLineItem[] = [{
      category: 'DEMAND',
      description: `Peak Demand Charge (Above ${demandCharge.thresholdKw} kW)`,
      quantity: billableDemand,
      unitPrice: demandCharge.ratePerKw,
      totalAmount: total
    }];

    return { total, lineItems };
  }

  private calculateSurcharges(request: TariffCalculationRequestDto, totalKwh: number, subtotalEnergy: number, peakDemandKw: number): { total: number; lineItems: BillLineItem[] } {
    let total = 0;
    const lineItems: BillLineItem[] = [];
    if (!request.surcharges) return { total, lineItems };

    for (const surcharge of request.surcharges) {
      if (!this.isSurchargeApplicable(surcharge, request.customerProfile.type, totalKwh)) continue;

      const strategy = SURCHARGE_STRATEGIES[surcharge.surchargeType];
      const { qty, unitPrice, amount } = strategy.calculate(surcharge.value, totalKwh, subtotalEnergy, peakDemandKw);

      total += amount;
      lineItems.push({
        category: 'SURCHARGE',
        description: `Surcharge: ${surcharge.name}`,
        quantity: qty,
        unitPrice,
        totalAmount: amount
      });
    }

    return { total, lineItems };
  }

  private isSurchargeApplicable(surcharge: SurchargeConfigDto, customerType: CustomerType, totalKwh: number): boolean {
    if (surcharge.applicableCustomerTypes?.length && !surcharge.applicableCustomerTypes.includes(customerType)) {
      return false;
    }
    if (surcharge.minUsageThresholdKwh && totalKwh < surcharge.minUsageThresholdKwh) {
      return false;
    }
    return true;
  }

  private calculateRebates(request: TariffCalculationRequestDto, totalKwh: number): { total: number; lineItems: BillLineItem[] } {
    let total = 0;
    const lineItems: BillLineItem[] = [];
    if (!request.rebates) return { total, lineItems };

    for (const rebate of request.rebates) {
      const strategy = REBATE_STRATEGIES[rebate.rebateType];
      if (!strategy?.isEligible(request.customerProfile)) continue;
      if (rebate.minGenerationKwh && totalKwh < rebate.minGenerationKwh) continue;

      let amount = strategy.calculateBaseAmount(rebate.value, totalKwh);
      if (rebate.capAmount && amount > rebate.capAmount) {
        amount = rebate.capAmount;
      }

      total += amount;
      lineItems.push({
        category: 'REBATE',
        description: `Rebate: ${rebate.name}`,
        quantity: 1,
        unitPrice: amount,
        totalAmount: -amount
      });
    }

    return { total, lineItems };
  }

  private calculateTax(effectiveSubtotal: number, taxRatePercent: number): { taxAmount: number; lineItem?: BillLineItem } {
    const taxAmount = effectiveSubtotal * (taxRatePercent / 100);
    if (taxAmount <= 0) return { taxAmount: 0 };

    return {
      taxAmount,
      lineItem: {
        category: 'TAX',
        description: `Tax (${taxRatePercent}%)`,
        quantity: effectiveSubtotal,
        unitPrice: taxRatePercent / 100,
        totalAmount: taxAmount
      }
    };
  }

  private getSeasonFromDate(date: Date): Season {
    const month = date.getMonth() + 1;
    if (month >= 6 && month <= 8) {
      return Season.SUMMER;
    } else if (month === 12 || month === 1 || month === 2) {
      return Season.WINTER;
    } else {
      return Season.SHOULDER;
    }
  }

  private getDayTypeFromDate(date: Date): DayType {
    const day = date.getDay();
    if (day === 0 || day === 6) {
      return DayType.WEEKEND;
    }
    return DayType.WEEKDAY;
  }
}