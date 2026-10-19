import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsNumber,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BadRequestException, Injectable } from '@nestjs/common';

export enum PickListPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum PickListStatus {
  DRAFT = 'DRAFT',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@ValidatorConstraint({ name: 'IsPickedQuantityValid', async: false })
export class IsPickedQuantityValidConstraint implements ValidatorConstraintInterface {
  validate(quantityPicked: number, args: ValidationArguments): boolean {
    const item = args.object as PickItemDto;
    if (quantityPicked === undefined || quantityPicked === null) {
      return true;
    }
    return quantityPicked <= item.quantityRequested;
  }

  defaultMessage(): string {
    return 'Picked quantity cannot exceed requested quantity';
  }
}

export class PickItemDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsInt()
  @Min(1)
  quantityRequested!: number;

  @IsInt()
  @Min(0)
  @Validate(IsPickedQuantityValidConstraint)
  quantityPicked!: number;

  @IsString()
  @IsNotEmpty()
  zoneId!: string;

  @IsString()
  @IsNotEmpty()
  aisle!: string;

  @IsString()
  @IsNotEmpty()
  shelf!: string;

  @IsString()
  @IsNotEmpty()
  bin!: string;

  @IsNumber()
  @Min(0.01)
  unitWeightKg!: number;
}

export class CreateOrderBatchDto {
  @IsString()
  @IsNotEmpty()
  batchCode!: string;

  @IsArray()
  @IsString({ each: true })
  orderIds!: string[];

  @IsArray()
  @IsString({ each: true })
  targetZoneIds!: string[];

  @IsNumber()
  @Min(1)
  @Max(5000)
  maxWeightCapacityKg!: number;

  @IsEnum(PickListPriority)
  priority!: PickListPriority;
}

export class CreatePickListDto {
  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @IsString()
  @IsNotEmpty()
  assignedPickerId!: string;

  @IsEnum(PickListPriority)
  priority!: PickListPriority;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickItemDto)
  items!: PickItemDto[];
}

export class CompletePickListRequestDto {
  @IsString()
  @IsNotEmpty()
  pickListId!: string;

  @IsString()
  @IsNotEmpty()
  pickerId!: string;

  @IsString()
  @IsNotEmpty()
  assignedPickerId!: string;

  @IsEnum(PickListStatus)
  currentStatus!: PickListStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickItemDto)
  items!: PickItemDto[];

  @IsNumber()
  @Min(0)
  totalPickedWeightKg!: number;

  @IsNumber()
  @Min(0)
  maxAllowedWeightKg!: number;

  @IsString()
  @IsNotEmpty()
  stagingBinId!: string;

  @IsBoolean()
  isStagingBinAvailable!: boolean;

  @IsBoolean()
  hasSafetyHalt!: boolean;

  @IsBoolean()
  hasUnresolvedDiscrepancy!: boolean;

  @IsBoolean()
  isWithinShiftWindow!: boolean;
}

@Injectable()
export class WarehousePickListValidator {
  validateCompletion(dto: CompletePickListRequestDto): boolean {
    const errors: string[] = [];

    if (dto.currentStatus !== PickListStatus.IN_PROGRESS) {
      errors.push('Pick-list must be in IN_PROGRESS status to be completed');
    }

    if (dto.pickerId !== dto.assignedPickerId) {
      errors.push('Pick-list can only be completed by the assigned picker');
    }

    if (dto.totalPickedWeightKg > dto.maxAllowedWeightKg) {
      errors.push('Total picked weight exceeds maximum allowed equipment capacity');
    }

    if (!dto.isStagingBinAvailable) {
      errors.push('Target staging bin is currently unavailable or occupied');
    }

    if (dto.hasSafetyHalt) {
      errors.push('Cannot complete pick-list while active safety halt flag exists');
    }

    if (dto.hasUnresolvedDiscrepancy) {
      errors.push('Cannot complete pick-list with unresolved item quantity discrepancies');
    }

    if (!dto.isWithinShiftWindow) {
      errors.push('Completion timestamp falls outside active shift window');
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    return true;
  }

  validateBatchAssignment(dto: CreateOrderBatchDto): boolean {
    const errors: string[] = [];

    if (dto.orderIds.length === 0) {
      errors.push('Order batch must contain at least one order');
    }

    if (dto.targetZoneIds.length === 0) {
      errors.push('Order batch must target at least one warehouse zone');
    }

    if (dto.maxWeightCapacityKg <= 0) {
      errors.push('Max weight capacity must be greater than zero');
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    return true;
  }

  validatePickListCreation(dto: CreatePickListDto): boolean {
    const errors: string[] = [];

    if (dto.items.length === 0) {
      errors.push('Pick-list must contain at least one item');
    }

    if (!dto.assignedPickerId) {
      errors.push('Pick-list must be assigned to a picker');
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    return true;
  }
}
