import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

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
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  tags?: string[];
}

export class CreateSavedSearchDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID('4')
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @IsEnum(SavedSearchCategory)
  category?: SavedSearchCategory = SavedSearchCategory.DEFAULT;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean = false;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => SearchCriteriaDto)
  criteria!: SearchCriteriaDto;
}

export class UpdateSavedSearchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(SavedSearchCategory)
  category?: SavedSearchCategory;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SearchCriteriaDto)
  criteria?: SearchCriteriaDto;
}

export class SavedSearchQueryDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsEnum(SavedSearchCategory)
  category?: SavedSearchCategory;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  isPinned?: boolean;

  @IsOptional()
  @IsString()
  searchTerm?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;
}

export class SavedSearchResponseDto {
  @IsUUID('4')
  id!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
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