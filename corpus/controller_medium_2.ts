import { Controller, Get, Post, Put, Delete, Body, Param, Query, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

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

const availableRooms: string[] = ['101', '102', '103', '201', '202'];
const reservationsStore: Reservation[] = [];

@Controller('reservations')
export class ReservationsController {

  @Get()
  findAll(@Query('roomId') roomId?: string) {
    if (roomId) {
      return reservationsStore.filter(r => r.roomId === roomId);
    }
    return reservationsStore;
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    const reservation = reservationsStore.find(r => r.id === id);
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  @Post()
  create(@Body() dto: CreateReservationDto) {
    const checkIn = new Date(dto.checkInDate);
    const checkOut = new Date(dto.checkOutDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!availableRooms.includes(dto.roomId)) {
      throw new BadRequestException('Invalid room ID');
    }

    if (checkIn < today) {
      throw new BadRequestException('Check-in date cannot be in the past');
    }

    if (checkOut <= checkIn) {
      throw new BadRequestException('Check-out date must be after check-in date');
    }

    const durationInDays = (checkOut.getTime() - checkIn.getTime()) / (1000 * 3600 * 24);
    if (durationInDays > 30) {
      throw new BadRequestException('Reservation duration cannot exceed 30 days');
    }

    if (dto.numberOfGuests <= 0 || dto.numberOfGuests > 5) {
      throw new BadRequestException('Number of guests must be between 1 and 5');
    }

    if (dto.totalAmount <= 0) {
      throw new BadRequestException('Total amount must be greater than zero');
    }

    const isOverlapping = reservationsStore.some(r => {
      if (r.roomId !== dto.roomId || r.status === 'CANCELLED') {
        return false;
      }
      const existingIn = new Date(r.checkInDate);
      const existingOut = new Date(r.checkOutDate);
      return checkIn < existingOut && checkOut > existingIn;
    });

    if (isOverlapping) {
      throw new ConflictException('Room is unavailable for the requested date range');
    }

    const reservation: Reservation = {
      id: Math.random().toString(36).substring(2, 9),
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
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto) {
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

    if (checkOut <= checkIn) {
      throw new BadRequestException('Check-out date must be after check-in date');
    }

    const isOverlapping = reservationsStore.some(r => {
      if (r.id === id || r.roomId !== dto.roomId || r.status === 'CANCELLED') {
        return false;
      }
      const existingIn = new Date(r.checkInDate);
      const existingOut = new Date(r.checkOutDate);
      return checkIn < existingOut && checkOut > existingIn;
    });

    if (isOverlapping) {
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
  cancel(@Param('id') id: string) {
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
}
