import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

export interface PlantWateringReminder {
  id: string;
  plantName: string;
  wateringIntervalDays: number;
  lastWateredAt: Date;
  nextWateringAt: Date;
}

export interface CreateReminderDto {
  plantName: string;
  wateringIntervalDays: number;
  lastWateredAt?: Date;
}

export interface UpdateReminderDto {
  plantName?: string;
  wateringIntervalDays?: number;
  lastWateredAt?: Date;
}

const MS_PER_DAY = 86_400_000;

@Injectable()
export class PlantWateringReminderRepository {
  private readonly reminders = new Map<string, PlantWateringReminder>();

  create(dto: CreateReminderDto): PlantWateringReminder {
    this.validateCreateDto(dto);

    const id = this.generateId();
    const lastWateredAt = dto.lastWateredAt ? new Date(dto.lastWateredAt) : new Date();
    const nextWateringAt = this.calculateNextWateringAt(lastWateredAt, dto.wateringIntervalDays);

    const reminder: PlantWateringReminder = {
      id,
      plantName: dto.plantName,
      wateringIntervalDays: dto.wateringIntervalDays,
      lastWateredAt,
      nextWateringAt,
    };

    this.reminders.set(id, reminder);
    return reminder;
  }

  findAll(): PlantWateringReminder[] {
    return Array.from(this.reminders.values());
  }

  findOne(id: string): PlantWateringReminder {
    const reminder = this.reminders.get(id);
    if (!reminder) {
      throw new NotFoundException(`Reminder with ID ${id} not found`);
    }
    return reminder;
  }

  update(id: string, dto: UpdateReminderDto): PlantWateringReminder {
    const existing = this.findOne(id);

    const plantName = dto.plantName ?? existing.plantName;
    const wateringIntervalDays = dto.wateringIntervalDays ?? existing.wateringIntervalDays;
    const lastWateredAt = dto.lastWateredAt ? new Date(dto.lastWateredAt) : existing.lastWateredAt;

    if (wateringIntervalDays <= 0) {
      throw new BadRequestException('Watering interval must be greater than zero');
    }

    const nextWateringAt = this.calculateNextWateringAt(lastWateredAt, wateringIntervalDays);

    const updated: PlantWateringReminder = {
      id,
      plantName,
      wateringIntervalDays,
      lastWateredAt,
      nextWateringAt,
    };

    this.reminders.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    this.findOne(id);
    this.reminders.delete(id);
  }

  private validateCreateDto(dto: CreateReminderDto): void {
    if (!dto.plantName || !dto.wateringIntervalDays || dto.wateringIntervalDays <= 0) {
      throw new BadRequestException('Invalid reminder data');
    }
  }

  private calculateNextWateringAt(lastWateredAt: Date, intervalDays: number): Date {
    return new Date(lastWateredAt.getTime() + intervalDays * MS_PER_DAY);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }
}