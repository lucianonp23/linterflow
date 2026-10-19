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

@Controller('event-booking')
export class EventBookingController {
  private events: Map<string, Event> = new Map();
  private bookings: Map<string, Booking> = new Map();
  private eventIdCounter = 1;
  private bookingIdCounter = 1;

  @Post('events')
  createEvent(@Body() dto: CreateEventDto): Event {
    if (!dto.title || dto.title.trim().length === 0) {
      throw new BadRequestException('Event title is required');
    }
    if (!dto.capacity || dto.capacity <= 0) {
      throw new BadRequestException('Capacity must be greater than zero');
    }
    if (dto.pricePerTicket === undefined || dto.pricePerTicket < 0) {
      throw new BadRequestException('Price per ticket must be non-negative');
    }

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
    const event = this.events.get(id);
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
    return event;
  }

  @Post('bookings')
  createBooking(@Body() dto: CreateBookingDto): Booking {
    const event = this.events.get(dto.eventId);

    if (!event) {
      throw new NotFoundException(`Event with ID ${dto.eventId} not found`);
    }

    if (event.isCancelled) {
      throw new ConflictException('Cannot book tickets for a cancelled event');
    }

    if (event.eventDate.getTime() <= Date.now()) {
      throw new BadRequestException('Cannot book tickets for a past or ongoing event');
    }

    if (!dto.ticketCount || dto.ticketCount < 1 || dto.ticketCount > 10) {
      throw new BadRequestException('Ticket count must be between 1 and 10 per booking');
    }

    if (dto.userAge < event.minAge) {
      throw new BadRequestException(`User does not meet minimum age requirement of ${event.minAge}`);
    }

    if (event.bookedCount + dto.ticketCount > event.capacity) {
      throw new ConflictException('Requested ticket count exceeds remaining event capacity');
    }

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
    const booking = this.bookings.get(bookingId);

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

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

    const hoursUntilEvent = (eventTime - now) / (1000 * 60 * 60);
    let refundPercentage = 0;

    if (hoursUntilEvent >= 48) {
      refundPercentage = 1.0;
    } else if (hoursUntilEvent >= 24) {
      refundPercentage = 0.5;
    } else {
      refundPercentage = 0.0;
    }

    booking.status = 'CANCELLED';
    booking.refundAmount = booking.totalPrice * refundPercentage;
    event.bookedCount -= booking.ticketCount;

    return booking;
  }

  @Get('bookings/:id')
  getBooking(@Param('id') id: string): Booking {
    const booking = this.bookings.get(id);
    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }
    return booking;
  }
}
