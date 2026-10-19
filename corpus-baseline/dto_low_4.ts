import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export enum PackType {
  STICKER = 'STICKER',
  EMOJI = 'EMOJI',
}

export enum ImageFormat {
  PNG = 'PNG',
  WEBP = 'WEBP',
  GIF = 'GIF',
}

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@ValidatorConstraint({ name: 'isSlug', async: false })
export class IsSlugConstraint implements ValidatorConstraintInterface {
  validate(text: string): boolean {
    return typeof text === 'string' && SLUG_REGEX.test(text);
  }

  defaultMessage(_args?: ValidationArguments): string {
    return 'Value must be a valid lowercase hyphen-separated slug.';
  }
}

export class CreateStickerItemDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsUrl()
  @IsNotEmpty()
  imageUrl!: string;

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsEnum(ImageFormat)
  format!: ImageFormat;
}

export class CreateStickerPackDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @Validate(IsSlugConstraint)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PackType)
  packType!: PackType;

  @IsString()
  @IsNotEmpty()
  authorId!: string;

  @IsOptional()
  @IsBoolean()
  isAnimated?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStickerItemDto)
  items!: CreateStickerItemDto[];
}

export class UpdateStickerPackDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class StickerPackQueryDto {
  @IsOptional()
  @IsEnum(PackType)
  packType?: PackType;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}