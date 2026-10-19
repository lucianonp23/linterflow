import { Injectable, NestMiddleware, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AppointmentValidationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
      return next();
    }

    const { startTime, endTime, providerId, clientId } = req.body || {};

    if (!startTime || !endTime || !providerId || !clientId) {
      throw new BadRequestException('Missing required appointment fields: startTime, endTime, providerId, or clientId');
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format provided for startTime or endTime');
    }

    if (start >= end) {
      throw new UnprocessableEntityException('Appointment start time must precede end time');
    }

    const minimumNoticeMs = 2 * 60 * 60 * 1000;
    if (start.getTime() - now.getTime() < minimumNoticeMs) {
      throw new UnprocessableEntityException('Appointments must be scheduled at least 2 hours in advance');
    }

    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes > 120) {
      throw new UnprocessableEntityException('Appointment duration cannot exceed 120 minutes');
    }

    const dayOfWeek = start.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      throw new UnprocessableEntityException('Appointments cannot be scheduled on weekends');
    }

    const startHour = start.getHours();
    const endHour = end.getHours();
    const endMinutes = end.getMinutes();
    if (startHour < 8 || endHour > 18 || (endHour === 18 && endMinutes > 0)) {
      throw new UnprocessableEntityException('Appointments must be within standard working hours (08:00 - 18:00)');
    }

    next();
  }
}
