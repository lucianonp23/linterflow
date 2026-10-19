import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  inStock: boolean;
}

export interface Coupon {
  code: string;
  discountPercent: number;
  minSpend: number;
  expiresAt: Date;
  isActive: boolean;
}

export interface Cart {
  id: string;
  status: 'ACTIVE' | 'CHECKED_OUT' | 'EXPIRED';
  items: CartItem[];
  appliedCoupon?: Coupon;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  expiresAt: Date;
}

export class AddItemDto {
  id: string;
  name: string;
  price: number;
  quantity: number;
  inStock: boolean;
}

export class UpdateQuantityDto {
  quantity: number;
}

export class ApplyCouponDto {
  code: string;
}

export class CheckoutDto {
  paymentMethodId: string;
  shippingAddress: string;
}

@Controller('carts')
export class ShoppingCartController {
  private carts: Map<string, Cart> = new Map();
  private coupons: Map<string, Coupon> = new Map([
    [
      'SAVE10',
      {
        code: 'SAVE10',
        discountPercent: 10,
        minSpend: 50,
        expiresAt: new Date(Date.now() + 86400000),
        isActive: true,
      },
    ],
    [
      'EXPIRED20',
      {
        code: 'EXPIRED20',
        discountPercent: 20,
        minSpend: 30,
        expiresAt: new Date(Date.now() - 86400000),
        isActive: true,
      },
    ],
  ]);

  @Post()
  createCart(): Cart {
    const cartId = `cart_${Date.now()}`;
    const newCart: Cart = {
      id: cartId,
      status: 'ACTIVE',
      items: [],
      subtotal: 0,
      discountTotal: 0,
      grandTotal: 0,
      expiresAt: new Date(Date.now() + 3600000),
    };
    this.carts.set(cartId, newCart);
    return newCart;
  }

  @Get(':id')
  getCart(@Param('id') id: string): Cart {
    const cart = this.carts.get(id);
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    return cart;
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: AddItemDto): Cart {
    const cart = this.carts.get(id);

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    if (cart.status !== 'ACTIVE') {
      throw new BadRequestException('Cart is not active');
    }
    if (dto.quantity <= 0) {
      throw new BadRequestException('Item quantity must be greater than zero');
    }
    if (dto.price <= 0) {
      throw new BadRequestException('Item price must be greater than zero');
    }
    if (cart.items.length >= 10 && !cart.items.some((i) => i.id === dto.id)) {
      throw new BadRequestException('Cart exceeds maximum capacity of 10 unique items');
    }

    const existingIndex = cart.items.findIndex((item) => item.id === dto.id);
    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += dto.quantity;
    } else {
      cart.items.push({ ...dto });
    }

    this.recalculateCart(cart);
    return cart;
  }

  @Put(':id/items/:itemId')
  updateItemQuantity(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateQuantityDto,
  ): Cart {
    const cart = this.carts.get(id);

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    if (cart.status !== 'ACTIVE') {
      throw new BadRequestException('Cart is not active');
    }

    const item = cart.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException('Item not found in cart');
    }
    if (dto.quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }

    item.quantity = dto.quantity;
    this.recalculateCart(cart);
    return cart;
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string): Cart {
    const cart = this.carts.get(id);

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    if (cart.status !== 'ACTIVE') {
      throw new BadRequestException('Cart is not active');
    }

    const itemIndex = cart.items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) {
      throw new NotFoundException('Item not found in cart');
    }

    cart.items.splice(itemIndex, 1);
    this.recalculateCart(cart);
    return cart;
  }

  @Post(':id/coupon')
  applyCoupon(@Param('id') id: string, @Body() dto: ApplyCouponDto): Cart {
    const cart = this.carts.get(id);
    const coupon = this.coupons.get(dto.code);

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    if (cart.status !== 'ACTIVE') {
      throw new BadRequestException('Cart is not active');
    }
    if (!coupon) {
      throw new NotFoundException('Coupon code is invalid');
    }
    if (!coupon.isActive) {
      throw new BadRequestException('Coupon is no longer active');
    }
    if (coupon.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Coupon has expired');
    }
    if (cart.subtotal < coupon.minSpend) {
      throw new BadRequestException(
        `Cart subtotal does not meet minimum spend of ${coupon.minSpend} for this coupon`,
      );
    }

    cart.appliedCoupon = coupon;
    this.recalculateCart(cart);
    return cart;
  }

  @Post(':id/checkout')
  @HttpCode(HttpStatus.OK)
  checkout(@Param('id') id: string, @Body() dto: CheckoutDto): Cart {
    const cart = this.carts.get(id);

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }
    if (cart.status !== 'ACTIVE') {
      throw new BadRequestException('Cart is not active for checkout');
    }
    if (cart.expiresAt.getTime() < Date.now()) {
      cart.status = 'EXPIRED';
      throw new BadRequestException('Cart session has expired');
    }
    if (cart.items.length === 0) {
      throw new BadRequestException('Cannot checkout an empty cart');
    }
    if (!dto.paymentMethodId) {
      throw new BadRequestException('Payment method is required');
    }
    if (!dto.shippingAddress) {
      throw new BadRequestException('Shipping address is required');
    }
    if (cart.items.some((item) => !item.inStock)) {
      throw new UnprocessableEntityException(
        'One or more items in the cart are out of stock',
      );
    }

    cart.status = 'CHECKED_OUT';
    return cart;
  }

  private recalculateCart(cart: Cart): void {
    cart.subtotal = cart.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    let tierDiscountRatio = 0;
    if (cart.subtotal >= 200) {
      tierDiscountRatio = 0.15;
    } else if (cart.subtotal >= 100) {
      tierDiscountRatio = 0.1;
    } else if (cart.subtotal >= 50) {
      tierDiscountRatio = 0.05;
    }

    const tierDiscountAmount = cart.subtotal * tierDiscountRatio;

    let couponDiscountAmount = 0;
    if (cart.appliedCoupon) {
      const subtotalAfterTier = cart.subtotal - tierDiscountAmount;
      couponDiscountAmount =
        (subtotalAfterTier * cart.appliedCoupon.discountPercent) / 100;
    }

    cart.discountTotal = tierDiscountAmount + couponDiscountAmount;
    cart.grandTotal = Math.max(0, cart.subtotal - cart.discountTotal);
  }
}
