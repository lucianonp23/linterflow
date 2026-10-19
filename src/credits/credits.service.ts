import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { glob } from 'glob';

export type FileSizeCategory = 'medium' | 'long' | 'very-long';

export interface FileCostEstimate {
  filePath: string;
  loc: number;
  category: FileSizeCategory;
  cost: number;
}

export interface RunCostEstimate {
  files: FileCostEstimate[];
  totalCost: number;
}

/**
 * Size thresholds follow the prevailing community convention for file length:
 * ESLint's `max-lines` rule defaults to 300 lines, and most style guides flag
 * files beyond ~300–600 lines as needing a split. Hence:
 *
 *   ≤ 300 LOC  → up to "medium"  → 1 credit  (the pricing unit)
 *   301–600    → "long"          → 2 credits
 *   > 600      → "very long"     → 3 credits
 *
 * LOC counts non-blank lines, so formatting alone never changes the price.
 */
export const MEDIUM_FILE_MAX_LOC = 300;
export const LONG_FILE_MAX_LOC = 600;

export const CREDIT_COST: Record<FileSizeCategory, number> = {
  medium: 1,
  long: 2,
  'very-long': 3,
};

/** Must stay in sync with ProducerService.orchestrateFolder's glob ignore. */
const PIPELINE_IGNORE = [
  '**/node_modules/**',
  '**/*.d.ts',
  '**/*.spec.ts',
  '**/*.bak',
];

@Injectable()
export class CreditsService {
  public countLoc(sourceCode: string): number {
    return sourceCode.split('\n').filter((line) => line.trim().length > 0).length;
  }

  public categorize(loc: number): FileSizeCategory {
    if (loc <= MEDIUM_FILE_MAX_LOC) return 'medium';
    if (loc <= LONG_FILE_MAX_LOC) return 'long';
    return 'very-long';
  }

  public costForLoc(loc: number): number {
    return CREDIT_COST[this.categorize(loc)];
  }

  /**
   * Prices a pipeline run by resolving the exact same file set the Producer
   * will process and summing the per-file cost.
   */
  public async estimateRun(
    targetDirectory: string,
    filePattern = '**/*.ts',
  ): Promise<RunCostEstimate> {
    const files = await glob(filePattern, {
      cwd: targetDirectory,
      absolute: true,
      ignore: PIPELINE_IGNORE,
    });

    const estimates: FileCostEstimate[] = files.map((filePath) => {
      const loc = this.countLoc(fs.readFileSync(filePath, 'utf-8'));
      const category = this.categorize(loc);
      return { filePath, loc, category, cost: CREDIT_COST[category] };
    });

    return {
      files: estimates,
      totalCost: estimates.reduce((sum, f) => sum + f.cost, 0),
    };
  }
}
