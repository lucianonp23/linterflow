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
  IsDateString,
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

export class CourseEnrollmentValidator {
  public validateEnrollment(
    student: StudentProfile,
    targetCourse: CourseDetail,
    dto: EnrollCourseDto,
    enrollmentPeriod: EnrollmentPeriod,
    currentDate: Date = new Date()
  ): void {
    if (currentDate < enrollmentPeriod.startDate || currentDate > enrollmentPeriod.endDate) {
      throw new BadRequestException('Enrollment period is closed for this semester');
    }

    if (student.status !== StudentStatus.ACTIVE) {
      throw new ForbiddenException(`Student account is not active. Current status: ${student.status}`);
    }

    if (student.hasFinancialHold && dto.paymentMethod !== PaymentMethod.SCHOLARSHIP) {
      throw new ForbiddenException('Student has financial holds blocking registration without a scholarship');
    }

    if (targetCourse.enrolledCount >= targetCourse.capacity) {
      throw new ConflictException('Course section has reached maximum capacity');
    }

    const passingGrades = ['A', 'B', 'C'];
    const completedCourseIds = new Set(
      student.completedCourses
        .filter((rec) => passingGrades.includes(rec.grade.toUpperCase()))
        .map((rec) => rec.courseId)
    );
    const missingPrerequisites = targetCourse.prerequisiteCourseIds.filter(
      (prereqId) => !completedCourseIds.has(prereqId)
    );
    if (missingPrerequisites.length > 0) {
      throw new BadRequestException(`Missing required prerequisite course(s): ${missingPrerequisites.join(', ')}`);
    }

    const semesterEnrollments = student.currentEnrollments.filter(
      (e) => e.semester === dto.semester
    );
    const currentCredits = semesterEnrollments.reduce((sum, e) => sum + e.credits, 0);
    if (currentCredits + targetCourse.credits > student.maxCreditsPerSemester) {
      throw new BadRequestException(
        `Enrolling in this course exceeds maximum allowed limit of ${student.maxCreditsPerSemester} credits`
      );
    }

    const existingSchedules = semesterEnrollments.flatMap((e) => e.schedule);
    const hasTimeConflict = targetCourse.schedule.some((newSlot) =>
      existingSchedules.some(
        (existingSlot) =>
          existingSlot.dayOfWeek === newSlot.dayOfWeek &&
          newSlot.startTime < existingSlot.endTime &&
          newSlot.endTime > existingSlot.startTime
      )
    );
    if (hasTimeConflict) {
      throw new ConflictException('Course schedule conflicts with an already registered course in this semester');
    }
  }
}
