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

@Injectable()
export class FoodDeliveryOrderService {
  private zones: Map<string, DeliveryZone> = new Map([
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

  private restaurants: Map<string, Restaurant> = new Map([
    ['rest-1', { id: 'rest-1', name: 'Burger Palace', isOpen: true }],
    ['rest-2', { id: 'rest-2', name: 'Noodle House', isOpen: false }],
  ]);

  private customers: Map<string, Customer> = new Map([
    ['cust-1', { id: 'cust-1', name: 'Alice', status: CustomerStatus.ACTIVE }],
    ['cust-2', { id: 'cust-2', name: 'Bob', status: CustomerStatus.SUSPENDED }],
  ]);

  private orders: Map<string, Order> = new Map();

  public placeOrder(dto: PlaceOrderDto): Order {
    const customer = this.customers.get(dto.customerId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.status !== CustomerStatus.ACTIVE) {
      throw new BadRequestException('Customer account is suspended or inactive');
    }

    const restaurant = this.restaurants.get(dto.restaurantId);
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (!restaurant.isOpen) {
      throw new BadRequestException('Restaurant is currently closed');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    const zone = this.zones.get(dto.zoneId);
    if (!zone) {
      throw new NotFoundException('Delivery address is in an unsupported zone');
    }

    const totalItemCount = dto.items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalItemCount > zone.maxItemLimit) {
      throw new UnprocessableEntityException('Order exceeds maximum item limit for delivery zone');
    }

    const subtotal = dto.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (subtotal < zone.minimumOrderAmount) {
      throw new UnprocessableEntityException('Order subtotal does not meet minimum zone requirement');
    }

    const calculation = this.calculateFeeAndTotal(zone, dto.distanceKm, subtotal, dto.promoCode);

    const order: Order = {
      id: `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      customerId: dto.customerId,
      restaurantId: dto.restaurantId,
      zoneId: dto.zoneId,
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

    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.CONFIRMED) {
      throw new UnprocessableEntityException('Order cannot be cancelled in its current status');
    }

    const timeDiffMinutes = (Date.now() - order.createdAt.getTime()) / (1000 * 60);
    if (timeDiffMinutes > 15) {
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
      deliveryFee *= 1.25;
    }

    let discount = 0;
    if (promoCode === 'FREESHIP') {
      discount = deliveryFee;
    } else if (promoCode === 'SAVE10') {
      discount = subtotal * 0.1;
    }

    const finalDeliveryFee = Math.max(0, deliveryFee - (promoCode === 'FREESHIP' ? discount : 0));
    const finalSubtotalDiscount = promoCode === 'SAVE10' ? discount : 0;
    const total = subtotal - finalSubtotalDiscount + finalDeliveryFee;

    return {
      subtotal,
      deliveryFee: Number(finalDeliveryFee.toFixed(2)),
      discount: Number(discount.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }
}
