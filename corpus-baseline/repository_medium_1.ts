import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

export enum BookingStatus {
  CONFIRMED = 'CONFIRMED',
  WAITLISTED = 'WAITLISTED',
  CANCELLED = 'CANCELLED',
}

export interface GymClass {
  id: string;
  title: string;
  maxCapacity: number;
  maxWaitlist: number;
  startTime: Date;
  isActive: boolean;
}

export interface GymClassBooking {
  id: string;
  classId: string;
  userId: string;
  status: BookingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookingDto {
  classId: string;
  userId: string;
  isMembershipValid: boolean;
}

export interface UpdateBookingDto {
  status: BookingStatus;
}

@Injectable()
export class GymBookingRepository {
  private readonly classes = new Map<string, GymClass>();
  private readonly bookings = new Map<string, GymClassBooking>();

  public addClass(gymClass: GymClass): void {
    this.classes.set(gymClass.id, gymClass);
  }

  public findClassById(id: string): GymClass | undefined {
    return this.classes.get(id);
  }

  public findById(id: string): GymClassBooking {
    const booking = this.getBookingOrThrow(id);
    return this.cloneBooking(booking);
  }

  public findAll(): GymClassBooking[] {
    return Array.from(this.bookings.values()).map(this.cloneBooking);
  }

  public findByUserId(userId: string): GymClassBooking[] {
    return Array.from(this.bookings.values())
      .filter((booking) => booking.userId === userId)
      .map(this.cloneBooking);
  }

  public create(dto: CreateBookingDto): GymClassBooking {
    const gymClass = this.getGymClassOrThrow(dto.classId);
    this.validateClassEligibility(gymClass, dto.isMembershipValid);

    const activeBookings = this.getActiveBookingsForClass(dto.classId);
    this.ensureUserNotAlreadyBooked(activeBookings, dto.userId);

    const newStatus = this.determineNewBookingStatus(gymClass, activeBookings);

    const booking = this.createAndStoreBooking(dto.classId, dto.userId, newStatus);
    return this.cloneBooking(booking);
  }

  public updateStatus(id: string, dto: UpdateBookingDto): GymClassBooking {
    const booking = this.getBookingOrThrow(id);

    if (booking.status === dto.status) {
      throw new BadRequestException(`Booking is already in ${dto.status} status.`);
    }

    const previousStatus = booking.status;
    booking.status = dto.status;
    booking.updatedAt = new Date();
    this.bookings.set(id, booking);

    if (previousStatus === BookingStatus.CONFIRMED && dto.status === BookingStatus.CANCELLED) {
      this.promoteWaitlistUser(booking.classId);
    }

    return this.cloneBooking(booking);
  }

  public delete(id: string): boolean {
    const booking = this.getBookingOrThrow(id);

    if (booking.status === BookingStatus.CONFIRMED) {
      this.promoteWaitlistUser(booking.classId);
    }

    return this.bookings.delete(id);
  }

  private promoteWaitlistUser(classId: string): void {
    const oldestWaitlisted = Array.from(this.bookings.values())
      .filter((booking) => booking.classId === classId && booking.status === BookingStatus.WAITLISTED)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (oldestWaitlisted) {
      oldestWaitlisted.status = BookingStatus.CONFIRMED;
      oldestWaitlisted.updatedAt = new Date();
      this.bookings.set(oldestWaitlisted.id, oldestWaitlisted);
    }
  }

  private getBookingOrThrow(id: string): GymClassBooking {
    const booking = this.bookings.get(id);
    if (!booking) {
      throw new NotFoundException(`Booking with ID "${id}" was not found.`);
    }
    return booking;
  }

  private getGymClassOrThrow(classId: string): GymClass {
    const gymClass = this.classes.get(classId);
    if (!gymClass) {
      throw new NotFoundException(`Gym class with ID "${classId}" does not exist.`);
    }
    return gymClass;
  }

  private validateClassEligibility(gymClass: GymClass, isMembershipValid: boolean): void {
    if (!gymClass.isActive) {
      throw new BadRequestException(`Gym class "${gymClass.title}" is currently inactive.`);
    }

    if (gymClass.startTime.getTime() <= Date.now()) {
      throw new BadRequestException('Cannot book a gym class that has already started or ended.');
    }

    if (!isMembershipValid) {
      throw new BadRequestException('User membership is not valid or has expired.');
    }
  }

  private getActiveBookingsForClass(classId: string): GymClassBooking[] {
    return Array.from(this.bookings.values()).filter(
      (b) => b.classId === classId && b.status !== BookingStatus.CANCELLED,
    );
  }

  private ensureUserNotAlreadyBooked(activeBookings: GymClassBooking[], userId: string): void {
    const userExistingBooking = activeBookings.find((b) => b.userId === userId);
    if (userExistingBooking) {
      throw new ConflictException('User already has an active or waitlisted booking for this class.');
    }
  }

  private determineNewBookingStatus(gymClass: GymClass, activeBookings: GymClassBooking[]): BookingStatus {
    const confirmedCount = activeBookings.filter((b) => b.status === BookingStatus.CONFIRMED).length;
    const waitlistCount = activeBookings.filter((b) => b.status === BookingStatus.WAITLISTED).length;

    if (confirmedCount >= gymClass.maxCapacity && waitlistCount >= gymClass.maxWaitlist) {
      throw new BadRequestException('Both class capacity and waitlist capacity have been reached.');
    }

    return confirmedCount < gymClass.maxCapacity ? BookingStatus.CONFIRMED : BookingStatus.WAITLISTED;
  }

  private createAndStoreBooking(classId: string, userId: string, status: BookingStatus): GymClassBooking {
    const id = this.generateBookingId();
    const now = new Date();

    const booking: GymClassBooking = {
      id,
      classId,
      userId,
      status,
      createdAt: now,
      updatedAt: now,
    };

    this.bookings.set(id, booking);
    return booking;
  }

  private generateBookingId(): string {
    return `booking-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private cloneBooking(booking: GymClassBooking): GymClassBooking {
    return { ...booking };
  }
}