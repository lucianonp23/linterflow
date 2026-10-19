import { Injectable, NotFoundException } from '@nestjs/common';

export interface Habit {
  id: string;
  title: string;
  description?: string;
  createdAt: Date;
}

export interface HabitCheckIn {
  id: string;
  habitId: string;
  checkInDate: Date;
  notes?: string;
}

export interface CreateHabitDto {
  title: string;
  description?: string;
}

export interface CheckInDto {
  habitId: string;
  notes?: string;
}

@Injectable()
export class HabitTrackerService {
  private readonly habits = new Map<string, Habit>();
  private checkIns: HabitCheckIn[] = [];

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  createHabit(dto: CreateHabitDto): Habit {
    const habit: Habit = {
      id: this.generateId(),
      title: dto.title,
      description: dto.description,
      createdAt: new Date(),
    };
    this.habits.set(habit.id, habit);
    return habit;
  }

  getAllHabits(): Habit[] {
    return Array.from(this.habits.values());
  }

  getHabitById(id: string): Habit {
    const habit = this.habits.get(id);
    if (!habit) {
      throw new NotFoundException(`Habit with ID ${id} not found`);
    }
    return habit;
  }

  checkIn(dto: CheckInDto): HabitCheckIn {
    this.getHabitById(dto.habitId);
    const checkIn: HabitCheckIn = {
      id: this.generateId(),
      habitId: dto.habitId,
      checkInDate: new Date(),
      notes: dto.notes,
    };
    this.checkIns.push(checkIn);
    return checkIn;
  }

  getCheckInsForHabit(habitId: string): HabitCheckIn[] {
    this.getHabitById(habitId);
    return this.checkIns.filter((checkIn) => checkIn.habitId === habitId);
  }

  deleteHabit(id: string): void {
    this.getHabitById(id);
    this.habits.delete(id);
    this.checkIns = this.checkIns.filter((checkIn) => checkIn.habitId !== id);
  }
}