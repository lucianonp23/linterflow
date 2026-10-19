import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
  BadRequestException,
  ConflictException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

export interface Event {
  id: string;
  title: string;
  capacity: number;
  bookedCount: number;
  isCancelled: boolean;
  eventDate: Date;
  pricePerTicket: number;
  minAge: number;
}

export interface Booking {
  id: string;
  eventId: string;
  userId: string;
  userAge: number;
  ticketCount: number;
  totalPrice: number;
  status: 'CONFIRMED' | 'CANCELLED';
  refundAmount: number;
  createdAt: Date;
}

export class CreateEventDto {
  title: string;
  capacity: number;
  eventDate: string;
  pricePerTicket: number;
  minAge: number;
}

export class CreateBookingDto {
  eventId: string;
  userId: string;
  userAge: number;
  ticketCount: number;
}

const MS_IN_AN_HOUR = 1000 * 60 * 60;
const MIN_TICKET_LIMIT = 1;
const MAX_TICKET_LIMIT = 10;
const FULL_REFUND_HOURS_THRESHOLD = 48;
const PARTIAL_REFUND_HOURS_THRESHOLD = 24;

@Controller('event-booking')
export class EventBookingController {
  private readonly events: Map<string, Event> = new Map();
  private readonly bookings: Map<string, Booking> = new Map();
  private eventIdCounter = 1;
  private bookingIdCounter = 1;

  @Post('events')
  createEvent(@Body() dto: CreateEventDto): Event {
    this.validateCreateEventDto(dto);

    const eventDate = new Date(dto.eventDate);
    if (isNaN(eventDate.getTime())) {
      throw new BadRequestException('Invalid event date format');
    }

    const id = `evt_${this.eventIdCounter++}`;
    const newEvent: Event = {
      id,
      title: dto.title,
      capacity: dto.capacity,
      bookedCount: 0,
      isCancelled: false,
      eventDate,
      pricePerTicket: dto.pricePerTicket,
      minAge: dto.minAge || 0,
    };

    this.events.set(id, newEvent);
    return newEvent;
  }

  @Get('events')
  getAllEvents(): Event[] {
    return Array.from(this.events.values());
  }

  @Get('events/:id')
  getEvent(@Param('id') id: string): Event {
    return this.findEventOrThrow(id);
  }

  @Post('bookings')
  createBooking(@Body() dto: CreateBookingDto): Booking {
    const event = this.findEventOrThrow(dto.eventId);

    this.validateBookingEligibility(event, dto);

    const totalPrice = event.pricePerTicket * dto.ticketCount;
    event.bookedCount += dto.ticketCount;

    const bookingId = `bk_${this.bookingIdCounter++}`;
    const newBooking: Booking = {
      id: bookingId,
      eventId: event.id,
      userId: dto.userId,
      userAge: dto.userAge,
      ticketCount: dto.ticketCount,
      totalPrice,
      status: 'CONFIRMED',
      refundAmount: 0,
      createdAt: new Date(),
    };

    this.bookings.set(bookingId, newBooking);
    return newBooking;
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelBooking(@Param('id') bookingId: string): Booking {
    const booking = this.findBookingOrThrow(bookingId);

    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('Booking is already cancelled');
    }

    const event = this.events.get(booking.eventId);
    if (!event) {
      throw new NotFoundException(`Associated event with ID ${booking.eventId} not found`);
    }

    const now = Date.now();
    const eventTime = event.eventDate.getTime();

    if (eventTime <= now) {
      throw new BadRequestException('Cannot cancel booking for an event that has already started');
    }

    const hoursUntilEvent = (eventTime - now) / MS_IN_AN_HOUR;
    const refundPercentage = this.calculateRefundPercentage(hoursUntilEvent);

    booking.status = 'CANCELLED';
    booking.refundAmount = booking.totalPrice * refundPercentage;
    event.bookedCount -= booking.ticketCount;

    return booking;
  }

  @Get('bookings/:id')
  getBooking(@Param('id') id: string): Booking {
    return this.findBookingOrThrow(id);
  }

  private findEventOrThrow(id: string): Event {
    const event = this.events.get(id);
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
    return event;
  }

  private findBookingOrThrow(id: string): Booking {
    const booking = this.bookings.get(id);
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }
    return booking;
  }

  private validateCreateEventDto(dto: CreateEventDto): void {
    if (!dto.title || dto.title.trim().length === 0) {
      throw new BadRequestException('Event title is required');
    }
    if (!dto.capacity || dto.capacity <= 0) {
      throw new BadRequestException('Capacity must be greater than zero');
    }
    if (dto.pricePerTicket === undefined || dto.pricePerTicket < 0) {
      throw new BadRequestException('Price per ticket must be non-negative');
    }
  }

  private validateBookingEligibility(event: Event, dto: CreateBookingDto): void {
    if (event.isCancelled) {
      throw new ConflictException('Cannot book tickets for a cancelled event');
    }

    if (event.eventDate.getTime() <= Date.now()) {
      throw new BadRequestException('Cannot book tickets for a past or ongoing event');
    }

    if (!dto.ticketCount || dto.ticketCount < MIN_TICKET_LIMIT || dto.ticketCount > MAX_TICKET_LIMIT) {
      throw new BadRequestException('Ticket count must be between 1 and 10 per booking');
    }

    if (dto.userAge < event.minAge) {
      throw new BadRequestException(`User does not meet minimum age requirement of ${event.minAge}`);
    }

    if (event.bookedCount + dto.ticketCount > event.capacity) {
      throw new ConflictException('Requested ticket count exceeds remaining event capacity');
    }
  }

  private calculateRefundPercentage(hoursUntilEvent: number): number {
    if (hoursUntilEvent >= FULL_REFUND_HOURS_THRESHOLD) {
      return 1.0;
    }
    if (hoursUntilEvent >= PARTIAL_REFUND_HOURS_THRESHOLD) {
      return 0.5;
    }
    return 0.0;
  }
}