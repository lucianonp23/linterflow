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

@Injectable()
export class WaterIntakeService {
  private readonly entries: WaterLogEntry[] = [];

  logWaterIntake(userId: string, date: string, amountMl: number): WaterLogEntry {
    const entry: WaterLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
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

  getDailySummary(userId: string, date: string, goalMl: number = 2000): DailySummary {
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
    const initialLength = this.entries.length;
    const remaining = this.entries.filter((entry) => entry.id !== id);
    this.entries.length = 0;
    this.entries.push(...remaining);
    return remaining.length < initialLength;
  }
}
