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
  private habits: Habit[] = [];
  private checkIns: HabitCheckIn[] = [];

  createHabit(dto: CreateHabitDto): Habit {
    const habit: Habit = {
      id: Math.random().toString(36).substring(2, 9),
      title: dto.title,
      description: dto.description,
      createdAt: new Date(),
    };
    this.habits.push(habit);
    return habit;
  }

  getAllHabits(): Habit[] {
    return this.habits;
  }

  getHabitById(id: string): Habit {
    const habit = this.habits.find((h) => h.id === id);
    if (!habit) {
      throw new NotFoundException(`Habit with ID ${id} not found`);
    }
    return habit;
  }

  checkIn(dto: CheckInDto): HabitCheckIn {
    this.getHabitById(dto.habitId);
    const checkIn: HabitCheckIn = {
      id: Math.random().toString(36).substring(2, 9),
      habitId: dto.habitId,
      checkInDate: new Date(),
      notes: dto.notes,
    };
    this.checkIns.push(checkIn);
    return checkIn;
  }

  getCheckInsForHabit(habitId: string): HabitCheckIn[] {
    this.getHabitById(habitId);
    return this.checkIns.filter((c) => c.habitId === habitId);
  }

  deleteHabit(id: string): void {
    this.getHabitById(id);
    this.habits = this.habits.filter((h) => h.id !== id);
    this.checkIns = this.checkIns.filter((c) => c.habitId !== id);
  }
}
