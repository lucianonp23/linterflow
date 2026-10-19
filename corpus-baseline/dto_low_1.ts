import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const QUESTION_MIN_LENGTH = 5;
const QUESTION_MAX_LENGTH = 200;
const ANSWER_MIN_LENGTH = 10;
const ANSWER_MAX_LENGTH = 2000;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export enum FaqCategory {
  GENERAL = 'GENERAL',
  BILLING = 'BILLING',
  TECHNICAL = 'TECHNICAL',
  ACCOUNT = 'ACCOUNT',
}

@ValidatorConstraint({ name: 'isTrimmedString', async: false })
export class IsTrimmedStringConstraint implements ValidatorConstraintInterface {
  validate(text: unknown): boolean {
    return typeof text === 'string' && text.trim() === text;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must not have leading or trailing whitespace`;
  }
}

export function IsTrimmedString(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: IsTrimmedStringConstraint,
    });
  };
}

export class CreateFaqEntryDto {
  @IsString()
  @IsNotEmpty()
  @Length(QUESTION_MIN_LENGTH, QUESTION_MAX_LENGTH)
  @IsTrimmedString()
  question!: string;

  @IsString()
  @IsNotEmpty()
  @Length(ANSWER_MIN_LENGTH, ANSWER_MAX_LENGTH)
  answer!: string;

  @IsEnum(FaqCategory)
  category!: FaqCategory;

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
  @Length(QUESTION_MIN_LENGTH, QUESTION_MAX_LENGTH)
  @IsTrimmedString()
  question?: string;

  @IsOptional()
  @IsString()
  @Length(ANSWER_MIN_LENGTH, ANSWER_MAX_LENGTH)
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
  @Transform(({ value }: { value: unknown }) => {
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
  page?: number = DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;
}

export class FaqEntryResponseDto {
  @IsUUID()
  id!: string;

  @IsString()
  question!: string;

  @IsString()
  answer!: string;

  @IsEnum(FaqCategory)
  category!: FaqCategory;

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsBoolean()
  isPublished!: boolean;

  @IsInt()
  displayOrder!: number;

  @IsDate()
  createdAt!: Date;

  @IsDate()
  updatedAt!: Date;
}