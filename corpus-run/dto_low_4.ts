import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsArray,
  IsUrl,
  IsInt,
  Min,
  Max,
  ValidateNested,
  IsBoolean,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PackType {
  STICKER = 'STICKER',
  EMOJI = 'EMOJI',
}

export enum ImageFormat {
  PNG = 'PNG',
  WEBP = 'WEBP',
  GIF = 'GIF',
}

@ValidatorConstraint({ name: 'isSlug', async: false })
export class IsSlugConstraint implements ValidatorConstraintInterface {
  validate(text: string): boolean {
    return typeof text === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text);
  }

  defaultMessage(args: ValidationArguments): string {
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

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(PackType)
  packType!: PackType;

  @IsString()
  @IsNotEmpty()
  authorId!: string;

  @IsBoolean()
  @IsOptional()
  isAnimated?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStickerItemDto)
  items!: CreateStickerItemDto[];
}

export class UpdateStickerPackDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
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
