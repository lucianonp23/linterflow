import {
  IsString,
  IsNotEmpty,
  IsDate,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsBoolean,
  IsEmail,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_BOOKING_DURATION_MINUTES = 15;
const MAX_BOOKING_DURATION_MINUTES = 480;
const MAX_ADVANCE_BOOKING_DAYS = 90;
const MAX_ADVANCE_BOOKING_MS = MAX_ADVANCE_BOOKING_DAYS * MS_PER_DAY;

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  CONFLICTED = 'CONFLICTED',
}

export enum RoomType {
  CONFERENCE = 'CONFERENCE',
  HUDDLE = 'HUDDLE',
  BOARDROOM = 'BOARDROOM',
  AUDITORIUM = 'AUDITORIUM',
}

export enum ConflictResolutionStrategy {
  AUTO_RESCHEDULE = 'AUTO_RESCHEDULE',
  MOVE_ROOM = 'MOVE_ROOM',
  SPLIT_SLOT = 'SPLIT_SLOT',
  FORCE_OVERRIDE = 'FORCE_OVERRIDE',
}

@ValidatorConstraint({ name: 'isAfterProperty', async: false })
export class IsAfterPropertyConstraint implements ValidatorConstraintInterface {
  public validate(value: unknown, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints;
    const object = args.object as Record<string, unknown> | undefined;
    const relatedValue = object ? object[relatedPropertyName] : undefined;

    if (!(value instanceof Date) || !(relatedValue instanceof Date)) {
      return false;
    }
    return value.getTime() > relatedValue.getTime();
  }

  public defaultMessage(args: ValidationArguments): string {
    const [relatedPropertyName] = args.constraints;
    return `${args.property} must be strictly after ${relatedPropertyName}`;
  }
}

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  roomId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsEmail()
  organizerEmail!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  attendeeCount!: number;

  @Type(() => Date)
  @IsDate()
  startTime!: Date;

  @Type(() => Date)
  @IsDate()
  @Validate(IsAfterPropertyConstraint, ['startTime'])
  endTime!: Date;

  @IsEnum(RoomType)
  roomType!: RoomType;

  @IsOptional()
  @IsBoolean()
  requiresEquipment?: boolean;
}

export class ResolveConflictDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @IsEnum(ConflictResolutionStrategy)
  strategy!: ConflictResolutionStrategy;

  @IsOptional()
  @IsString()
  alternativeRoomId?: string;

  @Type(() => Date)
  @IsOptional()
  @IsDate()
  proposedStartTime?: Date;

  @Type(() => Date)
  @IsOptional()
  @IsDate()
  @Validate(IsAfterPropertyConstraint, ['proposedStartTime'])
  proposedEndTime?: Date;

  @IsOptional()
  @IsBoolean()
  forceOverride?: boolean;
}

export class SearchRoomDto {
  @IsEnum(RoomType)
  roomType!: RoomType;

  @IsInt()
  @Min(1)
  minCapacity!: number;

  @Type(() => Date)
  @IsDate()
  startTime!: Date;

  @Type(() => Date)
  @IsDate()
  @Validate(IsAfterPropertyConstraint, ['startTime'])
  endTime!: Date;
}

export interface RoomContext {
  id: string;
  capacity: number;
  isMaintenanceMode: boolean;
  openingHourUtc: number;
  closingHourUtc: number;
}

export interface BookingContext {
  id: string;
  status: BookingStatus;
  startTime: Date;
  endTime: Date;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class BookingValidationService {
  public validateCreateBooking(dto: CreateBookingDto, room: RoomContext, now: Date = new Date()): ValidationResult {
    const errors: string[] = [];

    const startTimeMs = dto.startTime.getTime();
    const endTimeMs = dto.endTime.getTime();
    const nowMs = now.getTime();

    if (startTimeMs <= nowMs) {
      errors.push('Booking start time must be in the future.');
    }

    if (endTimeMs <= startTimeMs) {
      errors.push('Booking end time must be after start time.');
    }

    const durationMinutes = (endTimeMs - startTimeMs) / MS_PER_MINUTE;
    if (durationMinutes < MIN_BOOKING_DURATION_MINUTES) {
      errors.push('Booking duration must be at least 15 minutes.');
    }

    if (durationMinutes > MAX_BOOKING_DURATION_MINUTES) {
      errors.push('Booking duration cannot exceed 8 hours.');
    }

    if (dto.attendeeCount > room.capacity) {
      errors.push('Attendee count exceeds room capacity.');
    }

    if (startTimeMs - nowMs > MAX_ADVANCE_BOOKING_MS) {
      errors.push('Booking cannot be made more than 90 days in advance.');
    }

    if (room.isMaintenanceMode) {
      errors.push('Room is currently undergoing maintenance and cannot be booked.');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  public validateConflictResolution(
    dto: ResolveConflictDto,
    existingBooking: BookingContext,
    userIsAdmin: boolean
  ): ValidationResult {
    const errors: string[] = [];

    const isResolvableStatus =
      existingBooking.status === BookingStatus.CONFLICTED || existingBooking.status === BookingStatus.PENDING;

    if (!isResolvableStatus) {
      errors.push('Only conflicted or pending bookings can be resolved.');
    }

    if (dto.strategy === ConflictResolutionStrategy.MOVE_ROOM && !dto.alternativeRoomId) {
      errors.push('Alternative room ID is required when using MOVE_ROOM strategy.');
    }

    if (dto.strategy === ConflictResolutionStrategy.FORCE_OVERRIDE && !userIsAdmin) {
      errors.push('User lacks administrative privilege to force override conflicts.');
    }

    if (
      dto.strategy === ConflictResolutionStrategy.AUTO_RESCHEDULE &&
      (!dto.proposedStartTime || !dto.proposedEndTime)
    ) {
      errors.push('Proposed start and end times are required for AUTO_RESCHEDULE strategy.');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}