import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsArray,
  IsOptional,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';

export enum PaymentMethod {
  CREDIT_CARD = 'CREDIT_CARD',
  FINANCIAL_AID = 'FINANCIAL_AID',
  SCHOLARSHIP = 'SCHOLARSHIP',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export enum StudentStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  GRADUATED = 'GRADUATED',
  WITHDRAWN = 'WITHDRAWN',
}

export class ScheduleSlotDto {
  @IsString()
  @IsNotEmpty()
  dayOfWeek: string;

  @IsString()
  @IsNotEmpty()
  startTime: string;

  @IsString()
  @IsNotEmpty()
  endTime: string;
}

export class EnrollCourseDto {
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @IsUUID()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  semester: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsInt()
  @Min(1)
  credits: number;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  prerequisiteCourseIds?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleSlotDto)
  schedule: ScheduleSlotDto[];
}

export interface StudentCourseRecord {
  courseId: string;
  grade: string;
  semester: string;
}

export interface StudentCurrentEnrollment {
  courseId: string;
  semester: string;
  credits: number;
  schedule: ScheduleSlotDto[];
}

export interface StudentProfile {
  id: string;
  status: StudentStatus;
  maxCreditsPerSemester: number;
  hasFinancialHold: boolean;
  completedCourses: StudentCourseRecord[];
  currentEnrollments: StudentCurrentEnrollment[];
}

export interface CourseDetail {
  id: string;
  code: string;
  credits: number;
  capacity: number;
  enrolledCount: number;
  prerequisiteCourseIds: string[];
  schedule: ScheduleSlotDto[];
}

export interface EnrollmentPeriod {
  semester: string;
  startDate: Date;
  endDate: Date;
}

const PASSING_GRADES = new Set(['A', 'B', 'C']);

export class CourseEnrollmentValidator {
  public validateEnrollment(
    student: StudentProfile,
    targetCourse: CourseDetail,
    dto: EnrollCourseDto,
    enrollmentPeriod: EnrollmentPeriod,
    currentDate: Date = new Date()
  ): void {
    this.verifyEnrollmentPeriod(enrollmentPeriod, currentDate);
    this.verifyStudentStatus(student.status);
    this.verifyFinancialHold(student.hasFinancialHold, dto.paymentMethod);
    this.verifyCourseCapacity(targetCourse.enrolledCount, targetCourse.capacity);
    this.verifyPrerequisites(student.completedCourses, targetCourse.prerequisiteCourseIds);

    const semesterEnrollments = student.currentEnrollments.filter(
      (enrollment) => enrollment.semester === dto.semester
    );

    this.verifyCreditLimit(semesterEnrollments, targetCourse.credits, student.maxCreditsPerSemester);
    this.verifyScheduleConflict(semesterEnrollments, targetCourse.schedule);
  }

  private verifyEnrollmentPeriod(period: EnrollmentPeriod, currentDate: Date): void {
    if (currentDate < period.startDate || currentDate > period.endDate) {
      throw new BadRequestException('Enrollment period is closed for this semester');
    }
  }

  private verifyStudentStatus(status: StudentStatus): void {
    if (status !== StudentStatus.ACTIVE) {
      throw new ForbiddenException(`Student account is not active. Current status: ${status}`);
    }
  }

  private verifyFinancialHold(hasFinancialHold: boolean, paymentMethod: PaymentMethod): void {
    if (hasFinancialHold && paymentMethod !== PaymentMethod.SCHOLARSHIP) {
      throw new ForbiddenException('Student has financial holds blocking registration without a scholarship');
    }
  }

  private verifyCourseCapacity(enrolledCount: number, capacity: number): void {
    if (enrolledCount >= capacity) {
      throw new ConflictException('Course section has reached maximum capacity');
    }
  }

  private verifyPrerequisites(completedCourses: StudentCourseRecord[], prerequisiteCourseIds: string[]): void {
    if (!prerequisiteCourseIds.length) {
      return;
    }

    const completedCourseIds = new Set(
      completedCourses
        .filter((rec) => PASSING_GRADES.has(rec.grade.toUpperCase()))
        .map((rec) => rec.courseId)
    );

    const missingPrerequisites = prerequisiteCourseIds.filter(
      (prereqId) => !completedCourseIds.has(prereqId)
    );

    if (missingPrerequisites.length > 0) {
      throw new BadRequestException(`Missing required prerequisite course(s): ${missingPrerequisites.join(', ')}`);
    }
  }

  private verifyCreditLimit(
    semesterEnrollments: StudentCurrentEnrollment[],
    targetCredits: number,
    maxCredits: number
  ): void {
    const currentCredits = semesterEnrollments.reduce((sum, enrollment) => sum + enrollment.credits, 0);

    if (currentCredits + targetCredits > maxCredits) {
      throw new BadRequestException(
        `Enrolling in this course exceeds maximum allowed limit of ${maxCredits} credits`
      );
    }
  }

  private verifyScheduleConflict(
    semesterEnrollments: StudentCurrentEnrollment[],
    targetSchedule: ScheduleSlotDto[]
  ): void {
    const existingSchedules = semesterEnrollments.flatMap((enrollment) => enrollment.schedule);

    const hasTimeConflict = targetSchedule.some((newSlot) =>
      existingSchedules.some((existingSlot) => this.isSlotConflicting(newSlot, existingSlot))
    );

    if (hasTimeConflict) {
      throw new ConflictException('Course schedule conflicts with an already registered course in this semester');
    }
  }

  private isSlotConflicting(slotA: ScheduleSlotDto, slotB: ScheduleSlotDto): boolean {
    return (
      slotA.dayOfWeek === slotB.dayOfWeek &&
      slotA.startTime < slotB.endTime &&
      slotA.endTime > slotB.startTime
    );
  }
}