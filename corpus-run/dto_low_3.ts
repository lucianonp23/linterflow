import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsObject,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  Max,
  IsEnum,
  ArrayMaxSize,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  Validate,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export enum SavedSearchCategory {
  DEFAULT = 'DEFAULT',
  PROPERTY = 'PROPERTY',
  USER = 'USER',
  AUDIT = 'AUDIT',
}

@ValidatorConstraint({ name: 'isValidCriteriaKeys', async: false })
export class IsValidCriteriaKeys implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every((key) => key.trim().length > 0);
  }

  defaultMessage(): string {
    return 'Search criteria must be a non-empty object with valid non-empty keys.';
  }
}

export class SearchCriteriaDto {
  @IsObject()
  @IsNotEmpty()
  @Validate(IsValidCriteriaKeys)
  filters!: Record<string, unknown>;

  @IsOptional()
  @IsString({ each: true })
  @IsArray()
  @ArrayMaxSize(20)
  tags?: string[];
}

export class CreateSavedSearchDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID('4')
  @IsNotEmpty()
  userId!: string;

  @IsEnum(SavedSearchCategory)
  @IsOptional()
  category?: SavedSearchCategory = SavedSearchCategory.DEFAULT;

  @IsBoolean()
  @IsOptional()
  isPinned?: boolean = false;

  @ValidateNested()
  @Type(() => SearchCriteriaDto)
  @IsNotEmpty()
  criteria!: SearchCriteriaDto;
}

export class UpdateSavedSearchDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(SavedSearchCategory)
  @IsOptional()
  category?: SavedSearchCategory;

  @IsBoolean()
  @IsOptional()
  isPinned?: boolean;

  @ValidateNested()
  @Type(() => SearchCriteriaDto)
  @IsOptional()
  criteria?: SearchCriteriaDto;
}

export class SavedSearchQueryDto {
  @IsUUID('4')
  @IsOptional()
  userId?: string;

  @IsEnum(SavedSearchCategory)
  @IsOptional()
  category?: SavedSearchCategory;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  isPinned?: boolean;

  @IsString()
  @IsOptional()
  searchTerm?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  offset?: number = 0;

  @IsEnum(SortOrder)
  @IsOptional()
  sortOrder?: SortOrder = SortOrder.DESC;
}

export class SavedSearchResponseDto {
  @IsUUID('4')
  id!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID('4')
  userId!: string;

  @IsEnum(SavedSearchCategory)
  category!: SavedSearchCategory;

  @IsBoolean()
  isPinned!: boolean;

  @ValidateNested()
  @Type(() => SearchCriteriaDto)
  criteria!: SearchCriteriaDto;

  @IsString()
  createdAt!: string;

  @IsString()
  updatedAt!: string;
}
