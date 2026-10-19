import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

export type FareClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type SeatStatus = 'AVAILABLE' | 'RESERVED' | 'CONFIRMED';

export interface Seat {
  id: string;
  flightId: string;
  seatNumber: string;
  fareClass: FareClass;
  isExitRow: boolean;
  price: number;
  status: SeatStatus;
  reservedByPassengerId?: string;
  passengerAge?: number;
  flightDepartureTime: Date;
}

export interface CreateSeatDto {
  flightId: string;
  seatNumber: string;
  fareClass: FareClass;
  isExitRow: boolean;
  price: number;
  flightDepartureTime: Date;
}

export interface ReserveSeatDto {
  passengerId: string;
  passengerFareClass: FareClass;
  passengerAge: number;
}

export interface UpdateSeatDto {
  price?: number;
  isExitRow?: boolean;
  fareClass?: FareClass;
}

const MIN_EXIT_ROW_AGE = 15;
const MAX_RESERVATIONS_PER_PASSENGER = 4;
const SELECTION_CLOSURE_WINDOW_MS = 45 * 60 * 1000;

@Injectable()
export class SeatRepository {
  private readonly seats: Map<string, Seat> = new Map();

  async create(dto: CreateSeatDto): Promise<Seat> {
    this.validateCreateDto(dto);

    const id = this.generateId();
    const seat: Seat = {
      id,
      flightId: dto.flightId,
      seatNumber: dto.seatNumber.toUpperCase(),
      fareClass: dto.fareClass,
      isExitRow: dto.isExitRow,
      price: dto.price,
      status: 'AVAILABLE',
      flightDepartureTime: dto.flightDepartureTime,
    };

    this.seats.set(id, seat);
    return this.cloneSeat(seat);
  }

  async findById(id: string): Promise<Seat> {
    const seat = this.getSeatOrThrow(id);
    return this.cloneSeat(seat);
  }

  async findByFlightId(flightId: string): Promise<Seat[]> {
    const flightSeats: Seat[] = [];
    for (const seat of this.seats.values()) {
      if (seat.flightId === flightId) {
        flightSeats.push(this.cloneSeat(seat));
      }
    }
    return flightSeats;
  }

  async reserveSeat(seatId: string, dto: ReserveSeatDto): Promise<Seat> {
    const seat = this.getSeatOrThrow(seatId);

    this.validateReservation(seat, dto);

    seat.status = 'RESERVED';
    seat.reservedByPassengerId = dto.passengerId;
    seat.passengerAge = dto.passengerAge;

    this.seats.set(seatId, seat);
    return this.cloneSeat(seat);
  }

  async update(id: string, dto: UpdateSeatDto): Promise<Seat> {
    const seat = this.getSeatOrThrow(id);

    this.validateUpdateDto(seat, dto);

    if (dto.price !== undefined) {
      seat.price = dto.price;
    }
    if (dto.isExitRow !== undefined) {
      seat.isExitRow = dto.isExitRow;
    }
    if (dto.fareClass !== undefined) {
      seat.fareClass = dto.fareClass;
    }

    this.seats.set(id, seat);
    return this.cloneSeat(seat);
  }

  async cancelReservation(seatId: string, passengerId: string): Promise<Seat> {
    const seat = this.getSeatOrThrow(seatId);

    if (seat.status !== 'RESERVED') {
      throw new BadRequestException('Only reserved seats can have their reservation cancelled');
    }

    if (seat.reservedByPassengerId !== passengerId) {
      throw new ForbiddenException('Passenger does not hold the reservation for this seat');
    }

    seat.status = 'AVAILABLE';
    seat.reservedByPassengerId = undefined;
    seat.passengerAge = undefined;

    this.seats.set(seatId, seat);
    return this.cloneSeat(seat);
  }

  async delete(id: string): Promise<boolean> {
    const seat = this.getSeatOrThrow(id);

    if (seat.status !== 'AVAILABLE') {
      throw new BadRequestException('Cannot delete a seat that is reserved or confirmed');
    }

    return this.seats.delete(id);
  }

  private getSeatOrThrow(id: string): Seat {
    const seat = this.seats.get(id);
    if (!seat) {
      throw new NotFoundException(`Seat with ID "${id}" was not found`);
    }
    return seat;
  }

  private validateCreateDto(dto: CreateSeatDto): void {
    if (!dto.seatNumber || dto.seatNumber.trim() === '') {
      throw new BadRequestException('Seat number is required');
    }

    if (dto.price <= 0) {
      throw new BadRequestException('Seat price must be greater than zero');
    }

    if (dto.flightDepartureTime.getTime() <= Date.now()) {
      throw new BadRequestException('Flight departure time must be in the future');
    }

    if (this.isSeatNumberTaken(dto.flightId, dto.seatNumber)) {
      throw new ConflictException('Seat number already exists for this flight');
    }
  }

  private validateReservation(seat: Seat, dto: ReserveSeatDto): void {
    if (seat.status !== 'AVAILABLE') {
      throw new BadRequestException('Seat is not available for selection');
    }

    if (seat.fareClass !== dto.passengerFareClass) {
      throw new BadRequestException(
        `Seat fare class (${seat.fareClass}) does not match passenger fare class (${dto.passengerFareClass})`,
      );
    }

    if (seat.isExitRow && dto.passengerAge < MIN_EXIT_ROW_AGE) {
      throw new BadRequestException('Passengers under 15 years old cannot select exit row seats');
    }

    if (seat.flightDepartureTime.getTime() - Date.now() < SELECTION_CLOSURE_WINDOW_MS) {
      throw new BadRequestException('Seat selection is closed within 45 minutes of departure');
    }

    if (this.getPassengerReservationCount(dto.passengerId, seat.flightId) >= MAX_RESERVATIONS_PER_PASSENGER) {
      throw new BadRequestException('Passenger cannot reserve more than 4 seats on a single flight');
    }
  }

  private validateUpdateDto(seat: Seat, dto: UpdateSeatDto): void {
    if (dto.price !== undefined && dto.price <= 0) {
      throw new BadRequestException('Price must be greater than zero');
    }

    if (seat.status !== 'AVAILABLE') {
      throw new BadRequestException('Cannot modify configuration of a seat that is reserved or confirmed');
    }
  }

  private isSeatNumberTaken(flightId: string, seatNumber: string): boolean {
    const normalizedNumber = seatNumber.toUpperCase();
    for (const seat of this.seats.values()) {
      if (seat.flightId === flightId && seat.seatNumber === normalizedNumber) {
        return true;
      }
    }
    return false;
  }

  private getPassengerReservationCount(passengerId: string, flightId: string): number {
    let count = 0;
    for (const seat of this.seats.values()) {
      if (
        seat.flightId === flightId &&
        seat.reservedByPassengerId === passengerId &&
        (seat.status === 'RESERVED' || seat.status === 'CONFIRMED')
      ) {
        count++;
      }
    }
    return count;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 11);
  }

  private cloneSeat(seat: Seat): Seat {
    return { ...seat };
  }
}