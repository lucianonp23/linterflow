import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

export interface Reservation {
  id: string;
  roomId: string;
  guestId: string;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  totalAmount: number;
  status: 'CONFIRMED' | 'CANCELLED';
}

export class CreateReservationDto {
  roomId: string;
  guestId: string;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  totalAmount: number;
}

export class UpdateReservationDto {
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  totalAmount: number;
}

const AVAILABLE_ROOMS: string[] = ['101', '102', '103', '201', '202'];
const MS_PER_DAY = 1000 * 3600 * 24;
const MAX_RESERVATION_DAYS = 30;
const MIN_GUESTS = 1;
const MAX_GUESTS = 5;

const reservationsStore: Reservation[] = [];

@Controller('reservations')
export class ReservationsController {

  @Get()
  findAll(@Query('roomId') roomId?: string): Reservation[] {
    if (roomId) {
      return reservationsStore.filter(r => r.roomId === roomId);
    }
    return reservationsStore;
  }

  @Get(':id')
  findOne(@Param('id') id: string): Reservation {
    const reservation = reservationsStore.find(r => r.id === id);
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  @Post()
  create(@Body() dto: CreateReservationDto): Reservation {
    const checkIn = new Date(dto.checkInDate);
    const checkOut = new Date(dto.checkOutDate);

    this.validateRoomAvailability(dto.roomId);
    this.validateCreateDates(checkIn, checkOut);
    this.validateGuestCapacity(dto.numberOfGuests);
    this.validateTotalAmount(dto.totalAmount);

    if (this.isRoomOverlapping(dto.roomId, checkIn, checkOut)) {
      throw new ConflictException('Room is unavailable for the requested date range');
    }

    const reservation: Reservation = {
      id: this.generateReservationId(),
      roomId: dto.roomId,
      guestId: dto.guestId,
      checkInDate: dto.checkInDate,
      checkOutDate: dto.checkOutDate,
      numberOfGuests: dto.numberOfGuests,
      totalAmount: dto.totalAmount,
      status: 'CONFIRMED',
    };

    reservationsStore.push(reservation);
    return reservation;
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto): Reservation {
    const existingIndex = reservationsStore.findIndex(r => r.id === id);
    if (existingIndex === -1) {
      throw new NotFoundException('Reservation not found');
    }

    const existing = reservationsStore[existingIndex];
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('Cannot modify a cancelled reservation');
    }

    const checkIn = new Date(dto.checkInDate);
    const checkOut = new Date(dto.checkOutDate);

    this.validateDateOrder(checkIn, checkOut);

    if (this.isRoomOverlapping(dto.roomId, checkIn, checkOut, id)) {
      throw new ConflictException('Room is unavailable for the requested date range');
    }

    const updated: Reservation = {
      ...existing,
      roomId: dto.roomId,
      checkInDate: dto.checkInDate,
      checkOutDate: dto.checkOutDate,
      numberOfGuests: dto.numberOfGuests,
      totalAmount: dto.totalAmount,
    };

    reservationsStore[existingIndex] = updated;
    return updated;
  }

  @Delete(':id')
  cancel(@Param('id') id: string): Reservation {
    const reservation = reservationsStore.find(r => r.id === id);
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.status === 'CANCELLED') {
      throw new BadRequestException('Reservation is already cancelled');
    }

    const checkIn = new Date(reservation.checkInDate);
    if (checkIn <= new Date()) {
      throw new BadRequestException('Cannot cancel an active or past reservation');
    }

    reservation.status = 'CANCELLED';
    return reservation;
  }

  private validateRoomAvailability(roomId: string): void {
    if (!AVAILABLE_ROOMS.includes(roomId)) {
      throw new BadRequestException('Invalid room ID');
    }
  }

  private validateCreateDates(checkIn: Date, checkOut: Date): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkIn < today) {
      throw new BadRequestException('Check-in date cannot be in the past');
    }

    this.validateDateOrder(checkIn, checkOut);

    const durationInDays = (checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY;
    if (durationInDays > MAX_RESERVATION_DAYS) {
      throw new BadRequestException('Reservation duration cannot exceed 30 days');
    }
  }

  private validateDateOrder(checkIn: Date, checkOut: Date): void {
    if (checkOut <= checkIn) {
      throw new BadRequestException('Check-out date must be after check-in date');
    }
  }

  private validateGuestCapacity(numberOfGuests: number): void {
    if (numberOfGuests < MIN_GUESTS || numberOfGuests > MAX_GUESTS) {
      throw new BadRequestException('Number of guests must be between 1 and 5');
    }
  }

  private validateTotalAmount(totalAmount: number): void {
    if (totalAmount <= 0) {
      throw new BadRequestException('Total amount must be greater than zero');
    }
  }

  private isRoomOverlapping(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    excludeReservationId?: string
  ): boolean {
    return reservationsStore.some(r => {
      if (
        (excludeReservationId && r.id === excludeReservationId) ||
        r.roomId !== roomId ||
        r.status === 'CANCELLED'
      ) {
        return false;
      }
      const existingIn = new Date(r.checkInDate);
      const existingOut = new Date(r.checkOutDate);
      return checkIn < existingOut && checkOut > existingIn;
    });
  }

  private generateReservationId(): string {
    return Math.random().toString(36).substring(2, 9);
  }
}