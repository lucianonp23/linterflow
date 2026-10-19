import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  registerDecorator,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export enum UnitType {
  BASE = 'BASE',
  DERIVED = 'DERIVED',
}

@ValidatorConstraint({ name: 'isNotZeroConstraint', async: false })
export class IsNotZeroConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value !== 0;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must not be equal to zero.`;
  }
}

export function IsNotZero(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: IsNotZeroConstraint,
    });
  };
}

export class CreateUnitCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateUnitCategoryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateUnitOfMeasureDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  symbol!: string;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsEnum(UnitType)
  type!: UnitType;

  @IsNumber()
  @IsNotZero()
  conversionFactor!: number;

  @IsNumber()
  @IsOptional()
  offset?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateUnitOfMeasureDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  symbol?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsEnum(UnitType)
  @IsOptional()
  type?: UnitType;

  @IsNumber()
  @IsNotZero()
  @IsOptional()
  conversionFactor?: number;

  @IsNumber()
  @IsOptional()
  offset?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ConvertUnitDto {
  @IsString()
  @IsNotEmpty()
  sourceUnitCode!: string;

  @IsString()
  @IsNotEmpty()
  targetUnitCode!: string;

  @IsNumber()
  value!: number;
}

export class UnitQueryDto {
  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class BulkCreateUnitOfMeasureDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateUnitOfMeasureDto)
  units!: CreateUnitOfMeasureDto[];
}