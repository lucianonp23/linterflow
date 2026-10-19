import { Injectable, NestMiddleware, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const APPOINTMENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);

interface TimeContext {
  start: Date;
  end: Date;
  now: Date;
}

interface ValidationRule {
  isInvalid: (ctx: TimeContext) => boolean;
  errorMessage: string;
}

const BUSINESS_RULES: ValidationRule[] = [
  {
    isInvalid: ({ start, end }) => start >= end,
    errorMessage: 'Appointment start time must precede end time',
  },
  {
    isInvalid: ({ start, now }) => start.getTime() - now.getTime() < 2 * 60 * 60 * 1000,
    errorMessage: 'Appointments must be scheduled at least 2 hours in advance',
  },
  {
    isInvalid: ({ start, end }) => (end.getTime() - start.getTime()) / (1000 * 60) > 120,
    errorMessage: 'Appointment duration cannot exceed 120 minutes',
  },
  {
    isInvalid: ({ start }) => start.getDay() === 0 || start.getDay() === 6,
    errorMessage: 'Appointments cannot be scheduled on weekends',
  },
  {
    isInvalid: ({ start, end }) => {
      const startHour = start.getHours();
      const endHour = end.getHours();
      const endMinutes = end.getMinutes();
      return startHour < 8 || endHour > 18 || (endHour === 18 && endMinutes > 0);
    },
    errorMessage: 'Appointments must be within standard working hours (08:00 - 18:00)',
  },
];

function hasMissingFields(body: any): boolean {
  const { startTime, endTime, providerId, clientId } = body || {};
  return !(startTime && endTime && providerId && clientId);
}

function areInvalidDates(start: Date, end: Date): boolean {
  return isNaN(start.getTime()) || isNaN(end.getTime());
}

@Injectable()
export class AppointmentValidationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (!APPOINTMENT_METHODS.has(req.method)) {
      return next();
    }

    if (hasMissingFields(req.body)) {
      throw new BadRequestException('Missing required appointment fields: startTime, endTime, providerId, or clientId');
    }

    const start = new Date(req.body.startTime);
    const end = new Date(req.body.endTime);

    if (areInvalidDates(start, end)) {
      throw new BadRequestException('Invalid date format provided for startTime or endTime');
    }

    this.validateBusinessRules({ start, end, now: new Date() });

    next();
  }

  private validateBusinessRules(context: TimeContext): void {
    for (const rule of BUSINESS_RULES) {
      if (rule.isInvalid(context)) {
        throw new UnprocessableEntityException(rule.errorMessage);
      }
    }
  }
}