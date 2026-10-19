import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { FileMetrics } from '../core/types';

/**
 * A snapshot of the quality metrics of a single file at one point in time.
 */
export interface MetricsSnapshot {
  /** Max CC over the file's functions — the gate. */
  cyclomaticComplexity: number;
  maintainabilityIndex: number;
  duplicationRate: number;
  /** Functions above the CC threshold. Primary dependent variable. */
  cyclomaticViolations: number;
  /** Sum of CC over all functions. */
  totalCyclomaticComplexity: number;
  functionCount: number;
}

/**
 * The delta (post − pre) for each metric. A negative CC/violations/duplication
 * delta and a positive MI delta indicate an improvement.
 *
 * Read `totalCyclomaticComplexity` together with `cyclomaticComplexity`: the max
 * falling while the total holds steady or rises is Extract Method REDISTRIBUTING
 * complexity rather than removing it. Both are reported so the dissertation can
 * tell those two outcomes apart instead of claiming the stronger one by default.
 */
export interface MetricsDelta {
  cyclomaticComplexity: number;
  maintainabilityIndex: number;
  duplicationRate: number;
  cyclomaticViolations: number;
  totalCyclomaticComplexity: number;
  functionCount: number;
}

/**
 * The full pre/post record for a single file processed by the pipeline.
 */
export interface FileMitigationRecord {
  filePath: string;
  initial: MetricsSnapshot;
  final: MetricsSnapshot;
  delta: MetricsDelta;
  iterations: number;
  converged: boolean;
  improved: boolean;
}

/**
 * Aggregated statistics across every file in the batch.
 */
export interface GlobalStats {
  totalFiles: number;
  filesConverged: number;
  filesNotConverged: number;
  filesImproved: number;
  avgIterations: number;
  avgDeltaCyclomaticComplexity: number;
  avgDeltaMaintainabilityIndex: number;
  avgDeltaDuplicationRate: number;
  avgDeltaCyclomaticViolations: number;
  avgDeltaTotalCyclomaticComplexity: number;
  /**
   * Files whose worst function got simpler while the file's TOTAL complexity did
   * not fall — i.e. the branching was moved into new helpers rather than removed.
   * Reporting this separately keeps "the pipeline reduced complexity" from
   * quietly covering both outcomes.
   */
  filesComplexityRedistributed: number;
}

/**
 * The final mitigation report exported to JSON / Markdown.
 */
export interface MitigationReport {
  generatedAt: string;
  globalStats: GlobalStats;
  files: FileMitigationRecord[];
}

/**
 * Internal accumulator used while the pipeline runs. Holds whatever has been
 * recorded so far for a file (initial first, then final).
 */
interface PartialRecord {
  filePath: string;
  initial?: MetricsSnapshot;
  final?: MetricsSnapshot;
  iterations?: number;
  converged?: boolean;
}

/**
 * On-disk form of the accumulator, written after every file so a run that dies
 * part-way does not lose the work already paid for.
 *
 * This matters because the pre-mitigation snapshots are NOT recoverable by
 * re-running: the Producer overwrites each file with its refactored version and
 * deletes the .bak on convergence, so a second pass would measure already-
 * refactored code as the "pre" state. Without a checkpoint, losing the process
 * at file 55 of 60 means discarding the working copy and paying for all 60
 * again.
 */
export interface ReporterCheckpoint {
  version: 1;
  savedAt: string;
  records: PartialRecord[];
}

const CHECKPOINT_FILENAME = 'linterflow-checkpoint.json';

@Injectable()
export class ReporterService {
  private readonly logger = new Logger(ReporterService.name);

  // Keyed by file path so initial/final records can be merged regardless of order.
  private records = new Map<string, PartialRecord>();

  /**
   * Clears all accumulated state. Call before starting a new orchestration run.
   */
  public reset(): void {
    this.records.clear();
  }

  /**
   * Records the PRE-mitigation metrics of a file (before the refactoring loop).
   */
  public recordInitialMetrics(
    filePath: string,
    metrics: FileMetrics,
    duplicationRate: number,
  ): void {
    const record = this.records.get(filePath) ?? { filePath };
    record.initial = this.toSnapshot(metrics, duplicationRate);
    this.records.set(filePath, record);
    this.logger.log(`Recorded initial metrics for ${filePath}`);
  }

  /**
   * Records the POST-mitigation metrics of a file (after the refactoring loop).
   */
  public recordFinalMetrics(
    filePath: string,
    metrics: FileMetrics,
    duplicationRate: number,
    iterations: number,
    converged: boolean,
  ): void {
    const record = this.records.get(filePath) ?? { filePath };
    record.final = this.toSnapshot(metrics, duplicationRate);
    record.iterations = iterations;
    record.converged = converged;
    this.records.set(filePath, record);
    this.logger.log(
      `Recorded final metrics for ${filePath} (converged=${converged}, iterations=${iterations})`,
    );
  }

  /**
   * True when this file has both snapshots, i.e. it was processed end to end.
   *
   * A file holding only `initial` was interrupted mid-refactor and must be
   * redone — its snapshot is kept so the caller can tell the two states apart.
   */
  public hasCompleteRecord(filePath: string): boolean {
    const record = this.records.get(filePath);
    return !!record?.initial && !!record?.final;
  }

  /** Files recorded so far, complete or not. */
  public recordedCount(): number {
    return this.records.size;
  }

  public checkpointPath(outputDir: string = process.cwd()): string {
    return path.join(outputDir, CHECKPOINT_FILENAME);
  }

  /**
   * Persists the accumulator. Call after EVERY file, never only at the end.
   */
  public saveCheckpoint(outputDir: string = process.cwd()): void {
    const payload: ReporterCheckpoint = {
      version: 1,
      savedAt: new Date().toISOString(),
      records: [...this.records.values()],
    };
    const target = this.checkpointPath(outputDir);
    // Write-then-rename: a crash during the write cannot leave a half-written
    // checkpoint where a complete one used to be.
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(temp, target);
  }

  /**
   * Restores a checkpoint, REPLACING any accumulated state. Returns how many
   * records were loaded, or 0 when there is nothing usable to resume from.
   *
   * A corrupt checkpoint is preserved alongside and treated as absent: losing
   * the resume is bad, but refusing to run at all is worse.
   */
  public loadCheckpoint(outputDir: string = process.cwd()): number {
    const target = this.checkpointPath(outputDir);
    if (!fs.existsSync(target)) return 0;

    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf-8')) as ReporterCheckpoint;
      if (parsed?.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error(`unrecognised checkpoint shape (version ${parsed?.version})`);
      }
      this.records = new Map(parsed.records.map((r) => [r.filePath, r]));
      return this.records.size;
    } catch (error: any) {
      const preserved = `${target}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(target, preserved);
      } catch {
        /* best effort — the warning below is what matters */
      }
      this.logger.error(
        `Unreadable checkpoint at ${target} (${error.message}). Preserved as ${preserved}; starting from scratch.`,
      );
      this.records.clear();
      return 0;
    }
  }

  /** Removes the checkpoint once the final report has been written. */
  public discardCheckpoint(outputDir: string = process.cwd()): void {
    const target = this.checkpointPath(outputDir);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }

  /**
   * Computes the per-file deltas and the global statistics for the whole batch.
   */
  public generateReport(): MitigationReport {
    const files: FileMitigationRecord[] = [];

    for (const record of this.records.values()) {
      // Guard against incomplete records (e.g. a file that never finished).
      const initial = record.initial ?? this.emptySnapshot();
      const final = record.final ?? initial;

      const delta: MetricsDelta = {
        cyclomaticComplexity: final.cyclomaticComplexity - initial.cyclomaticComplexity,
        maintainabilityIndex: final.maintainabilityIndex - initial.maintainabilityIndex,
        duplicationRate: final.duplicationRate - initial.duplicationRate,
        cyclomaticViolations: final.cyclomaticViolations - initial.cyclomaticViolations,
        totalCyclomaticComplexity:
          final.totalCyclomaticComplexity - initial.totalCyclomaticComplexity,
        functionCount: final.functionCount - initial.functionCount,
      };

      // "Improved" = complexity/violations/duplication went down OR maintainability went up.
      const improved =
        delta.cyclomaticComplexity < 0 ||
        delta.cyclomaticViolations < 0 ||
        delta.maintainabilityIndex > 0 ||
        delta.duplicationRate < 0;

      files.push({
        filePath: record.filePath,
        initial,
        final,
        delta,
        iterations: record.iterations ?? 0,
        converged: record.converged ?? false,
        improved,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      globalStats: this.computeGlobalStats(files),
      files,
    };
  }

  /**
   * Serialises the report to `linterflow-report-{timestamp}.json` and returns the path.
   */
  public exportJson(report: MitigationReport, outputDir: string = process.cwd()): string {
    const filePath = path.join(outputDir, `linterflow-report-${this.timestamp()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Serialises a human-readable Markdown summary and returns the path.
   */
  public exportMarkdown(report: MitigationReport, outputDir: string = process.cwd()): string {
    const filePath = path.join(outputDir, `linterflow-report-${this.timestamp()}.md`);
    fs.writeFileSync(filePath, this.renderMarkdown(report), 'utf-8');
    return filePath;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private computeGlobalStats(files: FileMitigationRecord[]): GlobalStats {
    const totalFiles = files.length;
    const filesConverged = files.filter((f) => f.converged).length;
    const filesImproved = files.filter((f) => f.improved).length;

    const filesComplexityRedistributed = files.filter(
      (f) => f.delta.cyclomaticComplexity < 0 && f.delta.totalCyclomaticComplexity >= 0,
    ).length;

    const sum = files.reduce(
      (acc, f) => {
        acc.iterations += f.iterations;
        acc.cc += f.delta.cyclomaticComplexity;
        acc.mi += f.delta.maintainabilityIndex;
        acc.dup += f.delta.duplicationRate;
        acc.violations += f.delta.cyclomaticViolations;
        acc.totalCc += f.delta.totalCyclomaticComplexity;
        return acc;
      },
      { iterations: 0, cc: 0, mi: 0, dup: 0, violations: 0, totalCc: 0 },
    );

    const avg = (value: number) => (totalFiles > 0 ? value / totalFiles : 0);

    return {
      totalFiles,
      filesConverged,
      filesNotConverged: totalFiles - filesConverged,
      filesImproved,
      avgIterations: avg(sum.iterations),
      avgDeltaCyclomaticComplexity: avg(sum.cc),
      avgDeltaMaintainabilityIndex: avg(sum.mi),
      avgDeltaDuplicationRate: avg(sum.dup),
      avgDeltaCyclomaticViolations: avg(sum.violations),
      avgDeltaTotalCyclomaticComplexity: avg(sum.totalCc),
      filesComplexityRedistributed,
    };
  }

  private renderMarkdown(report: MitigationReport): string {
    const g = report.globalStats;
    const lines: string[] = [];

    lines.push(`# LinterFlow Mitigation Report`);
    lines.push('');
    lines.push(`_Generated at: ${report.generatedAt}_`);
    lines.push('');
    lines.push(`## Global Summary`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Total files | ${g.totalFiles} |`);
    lines.push(`| Converged | ${g.filesConverged} |`);
    lines.push(`| Not converged | ${g.filesNotConverged} |`);
    lines.push(`| Improved | ${g.filesImproved} |`);
    lines.push(`| Avg. iterations | ${g.avgIterations.toFixed(2)} |`);
    lines.push(`| Avg. Δ Max CC (gate) | ${this.fmt(g.avgDeltaCyclomaticComplexity)} |`);
    lines.push(`| Avg. Δ CC violations | ${this.fmt(g.avgDeltaCyclomaticViolations)} |`);
    lines.push(`| Avg. Δ Total CC | ${this.fmt(g.avgDeltaTotalCyclomaticComplexity)} |`);
    lines.push(`| Avg. Δ Maintainability Index | ${this.fmt(g.avgDeltaMaintainabilityIndex)} |`);
    lines.push(`| Avg. Δ Duplication Rate (%) | ${this.fmt(g.avgDeltaDuplicationRate)} |`);
    lines.push(`| Complexity redistributed, not removed | ${g.filesComplexityRedistributed} |`);
    lines.push('');
    lines.push(
      `> **Max CC** is the gate (no function may exceed the threshold). **Violations** counts the` +
        ` functions over it. **Total CC** sums every function: a falling max with a flat or rising` +
        ` total means the branching was relocated by Extract Method, not eliminated.`,
    );
    lines.push('');
    lines.push(`## Per-File Results`);
    lines.push('');
    lines.push(
      `| File | Max CC (pre→post / Δ) | Viol. (pre→post) | Total CC (pre→post / Δ) | Fns (pre→post) | MI (pre→post / Δ) | Dup% (pre→post / Δ) | Iter | Converged |`,
    );
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);

    for (const f of report.files) {
      const cc = `${f.initial.cyclomaticComplexity} → ${f.final.cyclomaticComplexity} / ${this.fmt(f.delta.cyclomaticComplexity)}`;
      const viol = `${f.initial.cyclomaticViolations} → ${f.final.cyclomaticViolations}`;
      const totalCc = `${f.initial.totalCyclomaticComplexity} → ${f.final.totalCyclomaticComplexity} / ${this.fmt(f.delta.totalCyclomaticComplexity)}`;
      const fns = `${f.initial.functionCount} → ${f.final.functionCount}`;
      const mi = `${f.initial.maintainabilityIndex.toFixed(1)} → ${f.final.maintainabilityIndex.toFixed(1)} / ${this.fmt(f.delta.maintainabilityIndex)}`;
      const dup = `${f.initial.duplicationRate.toFixed(1)} → ${f.final.duplicationRate.toFixed(1)} / ${this.fmt(f.delta.duplicationRate)}`;
      const name = path.basename(f.filePath);
      lines.push(
        `| ${name} | ${cc} | ${viol} | ${totalCc} | ${fns} | ${mi} | ${dup} | ${f.iterations} | ${f.converged ? '✅' : '❌'} |`,
      );
    }

    lines.push('');
    return lines.join('\n');
  }

  private toSnapshot(metrics: FileMetrics, duplicationRate: number): MetricsSnapshot {
    return {
      cyclomaticComplexity: metrics.cyclomaticComplexity,
      maintainabilityIndex: metrics.maintainabilityIndex,
      duplicationRate,
      cyclomaticViolations: metrics.cyclomaticViolations,
      totalCyclomaticComplexity: metrics.totalCyclomaticComplexity,
      functionCount: metrics.functionCount,
    };
  }

  private emptySnapshot(): MetricsSnapshot {
    return {
      cyclomaticComplexity: 0,
      maintainabilityIndex: 0,
      duplicationRate: 0,
      cyclomaticViolations: 0,
      totalCyclomaticComplexity: 0,
      functionCount: 0,
    };
  }

  /** Formats a delta with an explicit sign (e.g. +3.20, -1.50). */
  private fmt(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}`;
  }

  /** Filesystem-safe ISO timestamp for report filenames. */
  private timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}
