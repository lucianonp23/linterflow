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

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      if (typeof current.minKwh !== 'number' || current.minKwh < 0) {
        return false;
      }

      if (i < sorted.length - 1) {
        if (typeof current.maxKwh !== 'number') {
          return false;
        }
        const next = sorted[i + 1];
        if (current.maxKwh !== next.minKwh) {
          return false;
        }
      } else {
        if (current.maxKwh !== null && current.maxKwh !== undefined) {
          if (typeof current.maxKwh !== 'number' || current.maxKwh <= current.minKwh) {
            return false;
          }
        }
      }
    }

    return true;
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
        const timeIntervals: { start: number; end: number; rateName: string }[] = [];

        for (const rate of rates) {
          if (!Array.isArray(rate.applicableSeasons) || !rate.applicableSeasons.includes(season)) {
            continue;
          }
          if (!Array.isArray(rate.applicableDays) || !rate.applicableDays.includes(dayType)) {
            continue;
          }
          if (!Array.isArray(rate.timeWindows)) {
            continue;
          }

          for (const window of rate.timeWindows) {
            if (!window.startTime || !window.endTime) {
              continue;
            }
            const start = timeToMinutes(window.startTime);
            const end = timeToMinutes(window.endTime);

            if (start >= end) {
              timeIntervals.push({ start, end: 1440, rateName: rate.name });
              timeIntervals.push({ start: 0, end, rateName: rate.name });
            } else {
              timeIntervals.push({ start, end, rateName: rate.name });
            }
          }
        }

        timeIntervals.sort((a, b) => a.start - b.start);

        for (let i = 0; i < timeIntervals.length - 1; i++) {
          const current = timeIntervals[i];
          const next = timeIntervals[i + 1];

          if (current.end > next.start) {
            return false;
          }
        }
      }
    }

    return true;
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

export class EnergyTariffEngine {
  public calculateBill(request: TariffCalculationRequestDto): DetailedBillCalculation {
    const lineItems: BillLineItem[] = [];
    let totalKwh = 0;
    let peakDemandKw = 0;

    for (const reading of request.intervalReadings) {
      totalKwh += reading.kwhConsumption;
      if (reading.kwPeakDemand > peakDemandKw) {
        peakDemandKw = reading.kwPeakDemand;
      }
    }

    let subtotalEnergy = 0;

    if (request.meterType === MeterType.SINGLE_RATE && request.tiers && request.tiers.length > 0) {
      const sortedTiers = [...request.tiers].sort((a, b) => a.minKwh - b.minKwh);
      let remainingKwh = totalKwh;

      for (const tier of sortedTiers) {
        if (remainingKwh <= 0) break;

        const tierCapacity = tier.maxKwh !== null && tier.maxKwh !== undefined 
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
    } else if (request.meterType === MeterType.SMART_TIME_OF_USE || request.meterType === MeterType.DUAL_RATE) {
      if (request.touRates && request.touRates.length > 0) {
        const touConsumption: Map<string, { rate: TouRateDto; kwh: number }> = new Map();

        for (const touRate of request.touRates) {
          touConsumption.set(touRate.name, { rate: touRate, kwh: 0 });
        }

        for (const reading of request.intervalReadings) {
          const date = new Date(reading.timestamp);
          const season = this.getSeasonFromDate(date);
          const dayType = this.getDayTypeFromDate(date);
          const minutes = date.getHours() * 60 + date.getMinutes();

          let matched = false;

          for (const touRate of request.touRates) {
            if (!touRate.applicableSeasons.includes(season)) continue;
            if (!touRate.applicableDays.includes(dayType)) continue;

            for (const window of touRate.timeWindows) {
              const start = timeToMinutes(window.startTime);
              const end = timeToMinutes(window.endTime);

              let inWindow = false;
              if (start >= end) {
                inWindow = minutes >= start || minutes < end;
              } else {
                inWindow = minutes >= start && minutes < end;
              }

              if (inWindow) {
                const entry = touConsumption.get(touRate.name)!;
                entry.kwh += reading.kwhConsumption;
                matched = true;
                break;
              }
            }
            if (matched) break;
          }

          if (!matched) {
            const fallbackRate = request.touRates[0];
            const entry = touConsumption.get(fallbackRate.name)!;
            entry.kwh += reading.kwhConsumption;
          }
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
      }
    }

    let subtotalDemand = 0;
    if (request.demandCharge) {
      const config = request.demandCharge;
      const billableDemand = Math.max(peakDemandKw - config.thresholdKw, config.minBilledDemandKw, 0);
      
      if (billableDemand > 0) {
        subtotalDemand = billableDemand * config.ratePerKw;
        lineItems.push({
          category: 'DEMAND',
          description: `Peak Demand Charge (Above ${config.thresholdKw} kW)`,
          quantity: billableDemand,
          unitPrice: config.ratePerKw,
          totalAmount: subtotalDemand
        });
      }
    }

    let subtotalSurcharges = 0;
    if (request.surcharges) {
      for (const surcharge of request.surcharges) {
        if (surcharge.applicableCustomerTypes && surcharge.applicableCustomerTypes.length > 0) {
          if (!surcharge.applicableCustomerTypes.includes(request.customerProfile.type)) {
            continue;
          }
        }

        if (surcharge.minUsageThresholdKwh && totalKwh < surcharge.minUsageThresholdKwh) {
          continue;
        }

        let surchargeAmount = 0;
        let qty = 1;
        let unitPrice = surcharge.value;

        switch (surcharge.surchargeType) {
          case SurchargeType.FIXED_MONTHLY:
            surchargeAmount = surcharge.value;
            break;
          case SurchargeType.PER_KWH:
            qty = totalKwh;
            surchargeAmount = totalKwh * surcharge.value;
            break;
          case SurchargeType.PERCENTAGE:
            qty = subtotalEnergy;
            unitPrice = surcharge.value / 100;
            surchargeAmount = subtotalEnergy * (surcharge.value / 100);
            break;
          case SurchargeType.PEAK_DEMAND:
            qty = peakDemandKw;
            surchargeAmount = peakDemandKw * surcharge.value;
            break;
          case SurchargeType.RENEWABLE_ENERGY:
            qty = totalKwh;
            surchargeAmount = totalKwh * surcharge.value;
            break;
        }

        subtotalSurcharges += surchargeAmount;
        lineItems.push({
          category: 'SURCHARGE',
          description: `Surcharge: ${surcharge.name}`,
          quantity: qty,
          unitPrice: unitPrice,
          totalAmount: surchargeAmount
        });
      }
    }

    let subtotalRebates = 0;
    if (request.rebates) {
      for (const rebate of request.rebates) {
        let isEligible = true;

        if (rebate.rebateType === RebateType.SOLAR_FEED_IN && !request.customerProfile.hasSolar) {
          isEligible = false;
        }

        if (rebate.rebateType === RebateType.LOW_INCOME && !request.customerProfile.isLowIncome) {
          isEligible = false;
        }

        if (rebate.minGenerationKwh && totalKwh < rebate.minGenerationKwh) {
          isEligible = false;
        }

        if (!isEligible) continue;

        let rebateAmount = rebate.value;
        if (rebate.rebateType === RebateType.SOLAR_FEED_IN) {
          rebateAmount = totalKwh * rebate.value;
        }

        if (rebate.capAmount && rebateAmount > rebate.capAmount) {
          rebateAmount = rebate.capAmount;
        }

        subtotalRebates += rebateAmount;
        lineItems.push({
          category: 'REBATE',
          description: `Rebate: ${rebate.name}`,
          quantity: 1,
          unitPrice: rebateAmount,
          totalAmount: -rebateAmount
        });
      }
    }

    const subtotalBeforeTax = subtotalEnergy + subtotalDemand + subtotalSurcharges - subtotalRebates;
    const effectiveSubtotal = Math.max(subtotalBeforeTax, 0);
    const taxAmount = effectiveSubtotal * (request.taxRatePercent / 100);

    if (taxAmount > 0) {
      lineItems.push({
        category: 'TAX',
        description: `Tax (${request.taxRatePercent}%)`,
        quantity: effectiveSubtotal,
        unitPrice: request.taxRatePercent / 100,
        totalAmount: taxAmount
      });
    }

    const totalBillAmount = effectiveSubtotal + taxAmount;

    return {
      subtotalEnergy,
      subtotalDemand,
      subtotalSurcharges,
      subtotalRebates,
      subtotalBeforeTax,
      taxAmount,
      totalBillAmount,
      totalKwh,
      peakDemandKw,
      lineItems
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
