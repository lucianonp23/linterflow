import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export interface DeliveryZone {
  id: string;
  name: string;
  baseFee: number;
  perKmRate: number;
  minimumOrderAmount: number;
  maxItemLimit: number;
  isSurgeActive: boolean;
}

export interface Restaurant {
  id: string;
  name: string;
  isOpen: boolean;
}

export interface Customer {
  id: string;
  name: string;
  status: CustomerStatus;
}

export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  customerId: string;
  restaurantId: string;
  zoneId: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  createdAt: Date;
}

export interface PlaceOrderDto {
  customerId: string;
  restaurantId: string;
  zoneId: string;
  distanceKm: number;
  items: OrderItem[];
  promoCode?: string;
}

export interface OrderCalculationResult {
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
}

const SURGE_MULTIPLIER = 1.25;
const MAX_CANCELLATION_WINDOW_MINUTES = 15;
const MS_PER_MINUTE = 60 * 1000;

const PROMO_CODES = {
  FREE_SHIP: 'FREESHIP',
  SAVE_10: 'SAVE10',
} as const;

@Injectable()
export class FoodDeliveryOrderService {
  private readonly zones: Map<string, DeliveryZone> = new Map([
    [
      'zone-downtown',
      {
        id: 'zone-downtown',
        name: 'Downtown',
        baseFee: 3.5,
        perKmRate: 1.2,
        minimumOrderAmount: 15.0,
        maxItemLimit: 20,
        isSurgeActive: false,
      },
    ],
    [
      'zone-suburbs',
      {
        id: 'zone-suburbs',
        name: 'Suburbs',
        baseFee: 5.0,
        perKmRate: 1.5,
        minimumOrderAmount: 25.0,
        maxItemLimit: 15,
        isSurgeActive: true,
      },
    ],
  ]);

  private readonly restaurants: Map<string, Restaurant> = new Map([
    ['rest-1', { id: 'rest-1', name: 'Burger Palace', isOpen: true }],
    ['rest-2', { id: 'rest-2', name: 'Noodle House', isOpen: false }],
  ]);

  private readonly customers: Map<string, Customer> = new Map([
    ['cust-1', { id: 'cust-1', name: 'Alice', status: CustomerStatus.ACTIVE }],
    ['cust-2', { id: 'cust-2', name: 'Bob', status: CustomerStatus.SUSPENDED }],
  ]);

  private readonly orders: Map<string, Order> = new Map();

  public placeOrder(dto: PlaceOrderDto): Order {
    const customer = this.validateAndGetCustomer(dto.customerId);
    const restaurant = this.validateAndGetRestaurant(dto.restaurantId);
    
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    const zone = this.validateAndGetZone(dto.zoneId);
    this.validateOrderItemsAgainstZone(dto.items, zone);

    const subtotal = this.calculateSubtotal(dto.items);
    const calculation = this.calculateFeeAndTotal(zone, dto.distanceKm, subtotal, dto.promoCode);

    const order: Order = {
      id: this.generateOrderId(),
      customerId: customer.id,
      restaurantId: restaurant.id,
      zoneId: zone.id,
      items: dto.items,
      subtotal,
      deliveryFee: calculation.deliveryFee,
      total: calculation.total,
      status: OrderStatus.PENDING,
      createdAt: new Date(),
    };

    this.orders.set(order.id, order);
    return order;
  }

  public cancelOrder(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    const isCancellableStatus =
      order.status === OrderStatus.PENDING || order.status === OrderStatus.CONFIRMED;

    if (!isCancellableStatus) {
      throw new UnprocessableEntityException('Order cannot be cancelled in its current status');
    }

    const timeDiffMinutes = (Date.now() - order.createdAt.getTime()) / MS_PER_MINUTE;
    if (timeDiffMinutes > MAX_CANCELLATION_WINDOW_MINUTES) {
      throw new UnprocessableEntityException('Order cancellation window has expired');
    }

    order.status = OrderStatus.CANCELLED;
    this.orders.set(order.id, order);
    return order;
  }

  public calculateFeeAndTotal(
    zone: DeliveryZone,
    distanceKm: number,
    subtotal: number,
    promoCode?: string,
  ): OrderCalculationResult {
    if (distanceKm <= 0) {
      throw new BadRequestException('Distance must be greater than zero');
    }

    let deliveryFee = zone.baseFee + distanceKm * zone.perKmRate;
    if (zone.isSurgeActive) {
      deliveryFee *= SURGE_MULTIPLIER;
    }

    let discount = 0;
    if (promoCode === PROMO_CODES.FREE_SHIP) {
      discount = deliveryFee;
    } else if (promoCode === PROMO_CODES.SAVE_10) {
      discount = subtotal * 0.1;
    }

    const finalDeliveryFee = Math.max(
      0,
      deliveryFee - (promoCode === PROMO_CODES.FREE_SHIP ? discount : 0),
    );
    const finalSubtotalDiscount = promoCode === PROMO_CODES.SAVE_10 ? discount : 0;
    const total = subtotal - finalSubtotalDiscount + finalDeliveryFee;

    return {
      subtotal,
      deliveryFee: this.roundToTwoDecimals(finalDeliveryFee),
      discount: this.roundToTwoDecimals(discount),
      total: this.roundToTwoDecimals(total),
    };
  }

  private validateAndGetCustomer(customerId: string): Customer {
    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    if (customer.status !== CustomerStatus.ACTIVE) {
      throw new BadRequestException('Customer account is suspended or inactive');
    }
    return customer;
  }

  private validateAndGetRestaurant(restaurantId: string): Restaurant {
    const restaurant = this.restaurants.get(restaurantId);
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    if (!restaurant.isOpen) {
      throw new BadRequestException('Restaurant is currently closed');
    }
    return restaurant;
  }

  private validateAndGetZone(zoneId: string): DeliveryZone {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      throw new NotFoundException('Delivery address is in an unsupported zone');
    }
    return zone;
  }

  private validateOrderItemsAgainstZone(items: OrderItem[], zone: DeliveryZone): void {
    const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalItemCount > zone.maxItemLimit) {
      throw new UnprocessableEntityException('Order exceeds maximum item limit for delivery zone');
    }

    const subtotal = this.calculateSubtotal(items);
    if (subtotal < zone.minimumOrderAmount) {
      throw new UnprocessableEntityException('Order subtotal does not meet minimum zone requirement');
    }
  }

  private calculateSubtotal(items: OrderItem[]): number {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  private roundToTwoDecimals(value: number): number {
    return Number(value.toFixed(2));
  }

  private generateOrderId(): string {
    return `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}