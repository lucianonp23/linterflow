import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  ArrayUnique,
  Min,
  Max,
  Length,
  IsUUID,
  IsDate,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum FaqCategory {
  GENERAL = 'GENERAL',
  BILLING = 'BILLING',
  TECHNICAL = 'TECHNICAL',
  ACCOUNT = 'ACCOUNT',
}

@ValidatorConstraint({ name: 'isTrimmedString', async: false })
export class IsTrimmedStringConstraint implements ValidatorConstraintInterface {
  validate(text: any): boolean {
    return typeof text === 'string' && text.trim() === text;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must not have leading or trailing whitespace`;
  }
}

export function IsTrimmedString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsTrimmedStringConstraint,
    });
  };
}

export class CreateFaqEntryDto {
  @IsString()
  @IsNotEmpty()
  @Length(5, 200)
  @IsTrimmedString()
  question: string;

  @IsString()
  @IsNotEmpty()
  @Length(10, 2000)
  answer: string;

  @IsEnum(FaqCategory)
  category: FaqCategory;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  tags?: string[] = [];

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean = false;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number = 0;
}

export class UpdateFaqEntryDto {
  @IsOptional()
  @IsString()
  @Length(5, 200)
  @IsTrimmedString()
  question?: string;

  @IsOptional()
  @IsString()
  @Length(10, 2000)
  answer?: string;

  @IsOptional()
  @IsEnum(FaqCategory)
  category?: FaqCategory;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class FaqQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(FaqCategory)
  category?: FaqCategory;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class FaqEntryResponseDto {
  @IsUUID()
  id: string;

  @IsString()
  question: string;

  @IsString()
  answer: string;

  @IsEnum(FaqCategory)
  category: FaqCategory;

  @IsArray()
  @IsString({ each: true })
  tags: string[];

  @IsBoolean()
  isPublished: boolean;

  @IsInt()
  displayOrder: number;

  @IsDate()
  createdAt: Date;

  @IsDate()
  updatedAt: Date;
}
