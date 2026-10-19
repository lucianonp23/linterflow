import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  IsDate,
  Min,
  ValidateNested,
  ArrayMinSize,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum UserTier {
  STANDARD = 'STANDARD',
  VIP = 'VIP',
  PREMIUM = 'PREMIUM',
}

export class CartItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsNumber()
  @Min(0.01)
  price: number;

  @IsNumber()
  @Min(1)
  quantity: number;
}

export class ApplyPromoCodesDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(UserTier)
  userTier: UserTier;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  promoCodes: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  cartItems: CartItemDto[];

  @IsNumber()
  @Min(0)
  cartTotal: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  requestDate?: Date;
}

export class PromoCodeDefinitionDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsBoolean()
  isActive: boolean;

  @IsBoolean()
  isStackable: boolean;

  @IsNumber()
  @Min(0)
  minSpend: number;

  @IsNumber()
  @Min(1)
  maxUsageLimit: number;

  @IsNumber()
  @Min(0)
  currentUsageCount: number;

  @IsDate()
  @Type(() => Date)
  startDate: Date;

  @IsDate()
  @Type(() => Date)
  endDate: Date;

  @IsArray()
  @IsEnum(UserTier, { each: true })
  allowedTiers: UserTier[];

  @IsArray()
  @IsString({ each: true })
  restrictedCategories: string[];
}

export interface ValidationFailure {
  code: string;
  reason: string;
}

export interface PromoValidationResult {
  isValid: boolean;
  appliedCodes: string[];
  failedCodes: ValidationFailure[];
}

export class PromoCodeEngineValidator {
  public validateSinglePromo(
    code: string,
    promo: PromoCodeDefinitionDto | undefined,
    currentDate: Date
  ): ValidationFailure | null {
    if (!promo) {
      return { code, reason: 'Promo code does not exist.' };
    }

    if (!promo.isActive) {
      return { code, reason: 'Promo code is inactive.' };
    }

    if (currentDate < promo.startDate || currentDate > promo.endDate) {
      return { code, reason: 'Promo code is expired or not yet active.' };
    }

    if (promo.currentUsageCount >= promo.maxUsageLimit) {
      return { code, reason: 'Promo code usage limit has been reached.' };
    }

    return null;
  }

  public validatePromoStack(
    dto: ApplyPromoCodesDto,
    availablePromos: Map<string, PromoCodeDefinitionDto>
  ): PromoValidationResult {
    const currentDate = dto.requestDate || new Date();
    const appliedCodes: string[] = [];
    const failedCodes: ValidationFailure[] = [];
    const activeStack: PromoCodeDefinitionDto[] = [];

    for (const code of dto.promoCodes) {
      const promo = availablePromos.get(code);

      const basicFailure = this.validateSinglePromo(code, promo, currentDate);
      if (basicFailure) {
        failedCodes.push(basicFailure);
        continue;
      }

      const activePromo = promo!;

      if (dto.cartTotal < activePromo.minSpend) {
        failedCodes.push({ code, reason: 'Cart total does not meet minimum spend.' });
        continue;
      }

      if (activePromo.allowedTiers.length > 0 && !activePromo.allowedTiers.includes(dto.userTier)) {
        failedCodes.push({ code, reason: 'User tier is not eligible for this promo code.' });
        continue;
      }

      const hasRestrictedCategory = dto.cartItems.some(item =>
        activePromo.restrictedCategories.includes(item.category)
      );
      if (hasRestrictedCategory) {
        failedCodes.push({ code, reason: 'Cart contains items from restricted categories.' });
        continue;
      }

      const isStackingAllowed = this.canStack(activePromo, activeStack);
      if (!isStackingAllowed) {
        failedCodes.push({ code, reason: 'Promo code cannot be stacked with active codes.' });
        continue;
      }

      appliedCodes.push(code);
      activeStack.push(activePromo);
    }

    return {
      isValid: failedCodes.length === 0,
      appliedCodes,
      failedCodes,
    };
  }

  private canStack(
    targetPromo: PromoCodeDefinitionDto,
    existingStack: PromoCodeDefinitionDto[]
  ): boolean {
    if (existingStack.length === 0) {
      return true;
    }

    if (!targetPromo.isStackable) {
      return false;
    }

    for (const existing of existingStack) {
      if (!existing.isStackable) {
        return false;
      }
    }

    return true;
  }
}
