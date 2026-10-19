import { Injectable, NestMiddleware, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const HTTP_METHODS_TO_VALIDATE = new Set(['POST', 'PUT', 'PATCH']);
const MINIMUM_NOTICE_MS = 2 * 60 * 60 * 1000;
const MAX_DURATION_MINUTES = 120;
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 18;
const MS_PER_MINUTE = 1000 * 60;

interface AppointmentRequestBody {
  startTime?: string | number | Date;
  endTime?: string | number | Date;
  providerId?: unknown;
  clientId?: unknown;
}

@Injectable()
export class AppointmentValidationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (!HTTP_METHODS_TO_VALIDATE.has(req.method)) {
      return next();
    }

    const body: AppointmentRequestBody = req.body || {};
    this.validateRequiredFields(body);

    const start = new Date(body.startTime!);
    const end = new Date(body.endTime!);
    this.validateDateFormats(start, end);

    const now = new Date();
    this.validateBusinessRules(start, end, now);

    next();
  }

  private validateRequiredFields(body: AppointmentRequestBody): void {
    const { startTime, endTime, providerId, clientId } = body;
    if (!startTime || !endTime || !providerId || !clientId) {
      throw new BadRequestException('Missing required appointment fields: startTime, endTime, providerId, or clientId');
    }
  }

  private validateDateFormats(start: Date, end: Date): void {
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format provided for startTime or endTime');
    }
  }

  private validateBusinessRules(start: Date, end: Date, now: Date): void {
    if (start >= end) {
      throw new UnprocessableEntityException('Appointment start time must precede end time');
    }

    if (start.getTime() - now.getTime() < MINIMUM_NOTICE_MS) {
      throw new UnprocessableEntityException('Appointments must be scheduled at least 2 hours in advance');
    }

    const durationMinutes = (end.getTime() - start.getTime()) / MS_PER_MINUTE;
    if (durationMinutes > MAX_DURATION_MINUTES) {
      throw new UnprocessableEntityException('Appointment duration cannot exceed 120 minutes');
    }

    if (this.isWeekend(start)) {
      throw new UnprocessableEntityException('Appointments cannot be scheduled on weekends');
    }

    if (!this.isWithinWorkingHours(start, end)) {
      throw new UnprocessableEntityException('Appointments must be within standard working hours (08:00 - 18:00)');
    }
  }

  private isWeekend(date: Date): boolean {
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
  }

  private isWithinWorkingHours(start: Date, end: Date): boolean {
    const startHour = start.getHours();
    const endHour = end.getHours();
    const endMinutes = end.getMinutes();

    return !(startHour < WORK_START_HOUR || endHour > WORK_END_HOUR || (endHour === WORK_END_HOUR && endMinutes > 0));
  }
}