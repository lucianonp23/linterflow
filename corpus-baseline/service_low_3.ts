import { Injectable } from '@nestjs/common';

export interface WaterLogEntry {
  id: string;
  userId: string;
  date: string;
  amountMl: number;
  timestamp: Date;
}

export interface DailySummary {
  userId: string;
  date: string;
  totalAmountMl: number;
  goalMl: number;
  goalAchieved: boolean;
}

const DEFAULT_GOAL_ML = 2000;

@Injectable()
export class WaterIntakeService {
  private readonly entries: WaterLogEntry[] = [];

  logWaterIntake(userId: string, date: string, amountMl: number): WaterLogEntry {
    const entry: WaterLogEntry = {
      id: this.generateId(),
      userId,
      date,
      amountMl,
      timestamp: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  getDailyLogs(userId: string, date: string): WaterLogEntry[] {
    return this.entries.filter(
      (entry) => entry.userId === userId && entry.date === date,
    );
  }

  getDailySummary(
    userId: string,
    date: string,
    goalMl: number = DEFAULT_GOAL_ML,
  ): DailySummary {
    const dailyLogs = this.getDailyLogs(userId, date);
    const totalAmountMl = dailyLogs.reduce((sum, entry) => sum + entry.amountMl, 0);

    return {
      userId,
      date,
      totalAmountMl,
      goalMl,
      goalAchieved: totalAmountMl >= goalMl,
    };
  }

  deleteLogEntry(id: string): boolean {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return false;
    }
    this.entries.splice(index, 1);
    return true;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }
}