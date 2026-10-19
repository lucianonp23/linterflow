/**
 * Contract for project-level duplication measurement.
 *
 * Kept separate from `core/types.ts` (the pipeline's contract) because this is
 * a different measurement with a different unit: the pipeline's
 * `AnalysisReport.duplicationRate` describes ONE file scanned against itself,
 * while these describe a whole folder scanned against itself. Reporting the two
 * side by side as if they were the same number is the mistake this separation
 * exists to make harder.
 */

/** One file's share of duplicated lines. */
export interface FileDuplicationStat {
  file: string;
  duplicatedLines: number;
  totalLines: number;
  rate: number;
}

/** Two files (possibly the same one twice) and how much they echo each other. */
export interface FilePairStat {
  files: [string, string];
  clones: number;
  lines: number;
}

export interface ProjectDuplicationResult {
  directory: string;
  filesScanned: number;
  totalLines: number;
  clonePairs: number;
  /** Unique duplicated lines, both sides of every pair attributed. */
  duplicatedLines: number;
  /** Percentage 0–100. Bounded by construction; needs no clamp. */
  duplicationRate: number;
  /** Files with at least one duplicated line, worst first. */
  worstFiles: FileDuplicationStat[];
  /** Which files echo which, worst first. */
  topFilePairs: FilePairStat[];
  thresholds: { minLines: number; minTokens: number };
}

/** A before/after pair plus the deltas between them. */
export interface DuplicationComparison {
  before: ProjectDuplicationResult;
  after: ProjectDuplicationResult;
  delta: {
    filesScanned: number;
    totalLines: number;
    clonePairs: number;
    duplicatedLines: number;
    duplicationRate: number;
  };
}
