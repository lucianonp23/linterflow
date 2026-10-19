// O relatório que o Evaluator gera
export interface AnalysisReport {
  filePath: string;
  metrics: FileMetrics;
  duplications: DuplicationIssue[];
  // Taxa de duplicação em percentagem (0–100): (linhas duplicadas / total linhas) * 100
  duplicationRate: number;
}

/**
 * Quality thresholds from the dissertation. Shared so the Evaluator (which
 * counts violations) and the Feedback (which decides whether to prompt) can
 * never drift apart.
 */
export const MAX_CYCLOMATIC_COMPLEXITY = 10;
export const MIN_MAINTAINABILITY_INDEX = 65;
/** Percentage (0–100), not a fraction. */
export const MAX_DUPLICATION_RATE = 3;

/**
 * Complexity metrics for a single file.
 *
 * On the choice of aggregation: McCabe (1976) defines Cyclomatic Complexity
 * PER FUNCTION, and every mainstream instrument applies it that way — ESLint's
 * `complexity` rule, SonarQube, and Pylint's R0912 (too-many-branches), the
 * very check Blyth et al. (SCAM 2025) report as one of only three issues that
 * got WORSE after ten rounds of LLM-driven refactoring.
 *
 * Hence the split below:
 *  - `cyclomaticComplexity` (max) is the GATE. A file is healthy when no single
 *    function exceeds the threshold. Summing across the file instead would make
 *    complexity grow with file length, so no real NestJS file could ever pass;
 *    averaging would let a CC-30 function hide behind a dozen trivial getters.
 *  - `cyclomaticViolations` is the primary dependent variable. Counting
 *    offending functions is the same unit the static-analysis literature
 *    reports, which makes the results directly comparable.
 *  - `totalCyclomaticComplexity` distinguishes complexity that was REMOVED from
 *    complexity that was merely REDISTRIBUTED: Extract Method drives the max
 *    down while leaving the total flat or higher.
 */
export interface FileMetrics {
  /** GATE — highest CC among the file's functions. */
  cyclomaticComplexity: number;
  maintainabilityIndex: number;
  /** How many functions exceed MAX_CYCLOMATIC_COMPLEXITY. Zero ⟺ gate passes. */
  cyclomaticViolations: number;
  /** Sum of CC over all functions. Read together with `functionCount`. */
  totalCyclomaticComplexity: number;
  /** Functions found (top-level + class methods). Gives the sum its context. */
  functionCount: number;
  /**
   * The functions above the threshold, worst first — the ones the refactoring
   * prompt should name. Empty when the file passes.
   *
   * Deliberately NOT copied into the Reporter's snapshots: MitigationReport is
   * persisted in every user's run history, and a per-function array there would
   * grow that store for something only the prompt consumes.
   */
  violatingFunctions: ViolatingFunction[];
}

export interface ViolatingFunction {
  /** escomplex names unnamed functions `<anon method-N>`; kept verbatim. */
  name: string;
  cyclomaticComplexity: number;
}

export interface DuplicationIssue {
  lines: string;
  fragment: string;
}

/**
 * Why the last candidate was thrown away, fed back into the next prompt.
 *
 * Without it a rejection makes the loop resend an identical request against
 * identical code: the file is rolled back, so the analysis, the metrics and the
 * prompt all come out the same. The budget then buys up to five near-duplicate
 * calls whose only source of variation is sampling noise.
 */
export interface RejectedAttempt {
  iteration: number;
  reason: string;
}

// O resultado que o Feedback (Reflector) gera para o Producer
export interface RefactoringPrompt {
  targetFilePath: string;
  suggestedPrompt: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}