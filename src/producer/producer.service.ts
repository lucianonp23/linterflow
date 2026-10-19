import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import { glob } from 'glob';
import { EvaluatorService } from '../evaluator/evaluator.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ReporterService } from '../reporter/reporter.service';
import { AnalysisReport, RejectedAttempt } from '../core/types';
import { withRetry } from '../core/retry';

@Injectable()
export class ProducerService {
  private readonly logger = new Logger(ProducerService.name);
  private readonly ai: GoogleGenAI;

  // Safety mechanism: Maximum number of times the AI can attempt to fix a single file
  private readonly MAX_REFACTOR_ITERATIONS = 5;

  /**
   * No sampling parameters are sent, deliberately.
   *
   * From Gemini 3.6 Flash onwards `temperature`, `top_p` and `top_k` are
   * accepted and silently ignored — no error, no warning — and Google's
   * migration guidance is to remove them, since future models return HTTP 400
   * for them. Verified here rather than assumed: the same prompt sent twice at
   * temperature 0 produced different answers, and temperatures 0 and 2
   * produced the same pair of outputs.
   *
   * So the loop's iteration-to-iteration variation comes from the model's own
   * sampling, which cannot be tuned from this end. What differentiates a retry
   * is the prompt: a rejected candidate feeds its reason into the next one.
   */

  constructor(
    private readonly configService: ConfigService,
    private readonly evaluator: EvaluatorService,
    private readonly feedback: FeedbackService,
    private readonly reporter: ReporterService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error(
        'Missing GEMINI_API_KEY environment variable. Please check your .env file.',
      );
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * The main entry point for the orchestration. Scans a directory and processes all TypeScript files.
   * @param targetDirectory The local folder path to scan.
   * @param filePattern Glob pattern relative to targetDirectory. Defaults to
   *                    every .ts file; the GitHub import flow narrows it to a
   *                    single file when the user selects one in the tree.
   */
  public async orchestrateFolder(
    targetDirectory: string,
    filePattern = '**/*.ts',
  ): Promise<void> {
    this.logger.log(`Initiating LinterFlow orchestration in directory: ${targetDirectory}`);

    try {
      const files = await glob(filePattern, {
        cwd: targetDirectory,
        absolute: true,
        ignore: ['**/node_modules/**', '**/*.d.ts', '**/*.spec.ts', '**/*.bak'],
      });

      this.logger.log(`Found ${files.length} valid TypeScript files to analyze.`);

      // Resume a run that died part-way, if one left a checkpoint here. The
      // pre-mitigation snapshots cannot be recovered by starting over — the
      // files on disk are already refactored — so picking the checkpoint up is
      // the difference between losing one file and losing the whole batch.
      const resumed = this.reporter.loadCheckpoint(targetDirectory);
      if (resumed > 0) {
        this.logger.warn(
          `♻️  Resuming from checkpoint: ${resumed} file(s) already recorded. Delete ${this.reporter.checkpointPath(targetDirectory)} to force a clean run.`,
        );
      } else {
        // Reset any state from a previous run so the report only reflects this batch.
        this.reporter.reset();
      }

      let skipped = 0;
      for (const filePath of files) {
        if (this.reporter.hasCompleteRecord(filePath)) {
          skipped++;
          continue;
        }
        await this.processSingleFile(filePath, targetDirectory);
        // Crash-safe: persist after every file, never only at the end.
        this.reporter.saveCheckpoint(targetDirectory);
      }
      if (skipped > 0) {
        this.logger.log(`⏭  Skipped ${skipped} file(s) already present in the checkpoint.`);
      }

      // Aggregate pre/post metrics and persist the mitigation report to disk.
      const report = this.reporter.generateReport();
      const jsonPath = this.reporter.exportJson(report, targetDirectory);
      const markdownPath = this.reporter.exportMarkdown(report, targetDirectory);
      this.logger.log(`📊 Report written to: ${jsonPath}`);
      this.logger.log(`📊 Summary written to: ${markdownPath}`);

      // The report is on disk; the checkpoint has served its purpose. Leaving
      // it behind would make the next run resume a batch that already finished.
      this.reporter.discardCheckpoint(targetDirectory);

      this.logger.log('Orchestration complete. All files processed.');
    } catch (error: any) {
      this.logger.error(`Failed to orchestrate folder: ${error.message}`);
    }
  }

  /**
   * Runs the full Evaluator analysis on a piece of source code and assembles
   * the AnalysisReport (metrics + duplications + duplication rate).
   */
  private async analyzeFile(filePath: string, sourceCode: string): Promise<AnalysisReport> {
    const metrics = this.evaluator.analyzeMetrics(sourceCode);
    // BUGFIX: scan the file under analysis, not the whole root directory.
    const duplications = await this.evaluator.detectDuplications(filePath);
    const duplicationRate = this.evaluator.calculateDuplicationRate(duplications, sourceCode);
    return { filePath, metrics, duplications, duplicationRate };
  }

  /**
   * Is the candidate at least as good as what is already on disk?
   *
   * The comparison is LEXICOGRAPHIC over the gate dimensions, in priority order,
   * rather than a weighted sum. Blyth et al. (SCAM 2025) needed weights because
   * they collapse five quality dimensions into one score, and they list those
   * weights ("derived through expert consensus") as a limitation. Ordering the
   * dimensions instead reaches the same non-regression rule with nothing left to
   * tune, so there is no weighting to defend at the viva.
   *
   * Ties fall through to the next dimension; a full tie is accepted, since equal
   * quality with different code is not a regression and refusing it would stall
   * the loop.
   */
  private isAcceptable(candidate: AnalysisReport, current: AnalysisReport): boolean {
    // 1. Functions over the complexity threshold — the primary variable.
    if (candidate.metrics.cyclomaticViolations !== current.metrics.cyclomaticViolations) {
      return candidate.metrics.cyclomaticViolations < current.metrics.cyclomaticViolations;
    }
    // 2. The worst function in the file.
    if (candidate.metrics.cyclomaticComplexity !== current.metrics.cyclomaticComplexity) {
      return candidate.metrics.cyclomaticComplexity < current.metrics.cyclomaticComplexity;
    }
    // 3. Maintainability (higher is better).
    if (candidate.metrics.maintainabilityIndex !== current.metrics.maintainabilityIndex) {
      return candidate.metrics.maintainabilityIndex > current.metrics.maintainabilityIndex;
    }
    // 4. Duplication (lower is better).
    return candidate.duplicationRate <= current.duplicationRate;
  }

  /**
   * Exported symbols present in the original but gone from the candidate.
   *
   * Additions are fine — extracting a helper and exporting it is legitimate.
   * Only removals are rejected, since those change the file's public contract.
   */
  private missingExports(originalExports: string[], candidateCode: string): string[] {
    const candidateExports = new Set(this.evaluator.extractExportedSymbols(candidateCode));
    return originalExports.filter((symbol) => !candidateExports.has(symbol));
  }

  /** Compact metric summary for the iteration logs. */
  private describeMetrics(report: AnalysisReport): string {
    const m = report.metrics;
    return `viol=${m.cyclomaticViolations} maxCC=${m.cyclomaticComplexity} totalCC=${m.totalCyclomaticComplexity} MI=${m.maintainabilityIndex.toFixed(1)} DR=${report.duplicationRate.toFixed(2)}%`;
  }

  /**
   * The Self-Healing Loop: Evaluates, reflects, and refactors a single file until it passes.
   */
  private async processSingleFile(filePath: string, rootDir: string): Promise<void> {
    this.logger.log(`--- Processing File: ${filePath} ---`);
    let currentIteration = 0;
    let passesThresholds = false;

    // Create a backup of the original file
    const backupPath = `${filePath}.bak`;

    // A .bak already here means a previous run died while refactoring this
    // file, so what is on disk may be a half-applied iteration. Restore the
    // original before measuring anything — otherwise the "pre" snapshot would
    // describe partially refactored code and the delta would be understated.
    if (fs.existsSync(backupPath)) {
      this.logger.warn(
        `↺ Found a leftover backup for ${filePath}; restoring it before reprocessing.`,
      );
      fs.copyFileSync(backupPath, filePath);
    }

    const originalContent = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(backupPath, originalContent, 'utf-8');

    // Capture the PRE-mitigation state so the Reporter can compute the delta later.
    const initialReport = await this.analyzeFile(filePath, originalContent);
    this.reporter.recordInitialMetrics(
      filePath,
      initialReport.metrics,
      initialReport.duplicationRate,
    );

    // Track the most recent analysis so we can record the final state accurately.
    let lastReport: AnalysisReport = initialReport;

    // The file's public contract, taken once from the ORIGINAL. Every candidate
    // is checked against this rather than against the previous iteration, so a
    // symbol cannot be dropped gradually across several accepted steps.
    const originalExports = this.evaluator.extractExportedSymbols(originalContent);

    // Carried into the next prompt so a rejection does not buy an identical call.
    let rejectedAttempt: RejectedAttempt | undefined;

    try {
      // The loop analyses FIRST and refactors second, so the result of the last
      // refactoring is always measured before the budget runs out. Analysing
      // after the final write costs nothing (it is local) and is what makes a
      // file that converges on the last attempt count as converged instead of
      // being written off as a failure.
      while (true) {
        const sourceCode = fs.readFileSync(filePath, 'utf-8');

        // 2. Data Gathering (Evaluator)
        this.evaluator.generateAST(sourceCode); // Validates the file still parses.
        const report = await this.analyzeFile(filePath, sourceCode);
        lastReport = report;

        // 3. Decision Making (Feedback)
        const refactoringPrompt = this.feedback.generateRefactoringPrompt(
          report,
          rejectedAttempt,
        );

        if (!refactoringPrompt) {
          this.logger.log(`✅ File meets architectural standards!`);
          passesThresholds = true;
          break;
        }

        // Debt remains but the refactoring budget is spent. Stop here rather
        // than paying for a call whose result nothing would ever look at.
        if (currentIteration >= this.MAX_REFACTOR_ITERATIONS) {
          this.logger.warn(
            `Refactoring budget of ${this.MAX_REFACTOR_ITERATIONS} iterations exhausted; debt still present.`,
          );
          break;
        }

        currentIteration++;
        this.logger.log(
          `[Iteration ${currentIteration}/${this.MAX_REFACTOR_ITERATIONS}] Technical debt detected. Calling Gemini API...`,
        );

        // 4. AI Refactoring
        const newCode = await this.executeGeminiRefactor(refactoringPrompt.suggestedPrompt, sourceCode);

        // 5. Acceptance guard. The candidate is written to disk (jscpd needs a
        //    real file to measure) and rolled back if it is not an improvement.
        //    Without this, a bad generation is kept and the next iteration
        //    builds on top of it — the run can end worse than it started.
        //    Blyth et al. (SCAM 2025, Algorithm 1) accept a proposal only when
        //    fitness does not regress; this is the same rule.
        fs.writeFileSync(filePath, newCode, 'utf-8');

        const reject = (reason: string) => {
          fs.writeFileSync(filePath, sourceCode, 'utf-8');
          rejectedAttempt = { iteration: currentIteration, reason };
          this.logger.warn(`↩︎ Iteration ${currentIteration} rejected: ${reason}. Rolled back.`);
        };

        let candidate: AnalysisReport;
        try {
          this.evaluator.generateAST(newCode); // Reject anything that stopped parsing.
          candidate = await this.analyzeFile(filePath, newCode);
        } catch (error: any) {
          reject(`the candidate no longer parses (${error.message})`);
          continue;
        }

        // Deletion beats refactoring on every metric the guard compares — an
        // emptied controller scores zero violations and a higher MI — so the
        // public contract is checked before the metrics are even consulted.
        const missing = this.missingExports(originalExports, newCode);
        if (missing.length > 0) {
          reject(
            `the candidate dropped ${missing.length} exported symbol(s) that must be preserved: ${missing.join(', ')}`,
          );
          continue;
        }

        if (!this.isAcceptable(candidate, report)) {
          reject(
            `${this.describeMetrics(candidate)} is worse than ${this.describeMetrics(report)}`,
          );
          continue;
        }

        rejectedAttempt = undefined;
        this.logger.log(
          `💾 Iteration ${currentIteration} accepted: ${this.describeMetrics(report)} → ${this.describeMetrics(candidate)}`,
        );
      }

      if (passesThresholds) {
        this.logger.log(`✨ Refactoring successful for ${filePath}. Removing backup.`);
        // Record the converged final state (the file currently on disk).
        this.reporter.recordFinalMetrics(
          filePath,
          lastReport.metrics,
          lastReport.duplicationRate,
          currentIteration,
          true,
        );
        fs.unlinkSync(backupPath);
      } else {
        this.logger.warn(`❌ Max iterations reached. Restoring original file.`);
        // Did not converge: the original is restored, so the final state equals the initial state.
        this.reporter.recordFinalMetrics(
          filePath,
          initialReport.metrics,
          initialReport.duplicationRate,
          currentIteration,
          false,
        );
        fs.writeFileSync(filePath, originalContent, 'utf-8');
        fs.unlinkSync(backupPath);
      }

    } catch (error: any) {
      this.logger.error(`Fatal error processing ${filePath}: ${error.message}. Restoring backup.`);
      // On a fatal error the file is restored to its original; record it as non-converged.
      this.reporter.recordFinalMetrics(
        filePath,
        initialReport.metrics,
        initialReport.duplicationRate,
        currentIteration,
        false,
      );
      fs.writeFileSync(filePath, originalContent, 'utf-8');
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    }
  }

  /**
   * Connects to the Gemini API to execute the refactoring prompt.
   */
  private async executeGeminiRefactor(systemPrompt: string, originalCode: string): Promise<string> {
    try {
      const fullPrompt = `${systemPrompt}\n\n### ORIGINAL SOURCE CODE ###\n${originalCode}`;
      const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.6-flash';

      // A rate limit must not be mistaken for a failure to converge: without
      // this retry a 429 escapes the loop, the file is rolled back and the
      // Reporter records a non-convergence that never happened.
      const result = await withRetry(
        () =>
          this.ai.models.generateContent({
            model: modelName,
            contents: fullPrompt,
          }),
        {
          onRetry: (attempt, delayMs, error) =>
            this.logger.warn(
              `Gemini call failed (${error.message}). Retry ${attempt} in ${delayMs / 1000}s.`,
            ),
        },
      );

      let responseText = result.text || '';

      // Improved Extraction: Matches code blocks and takes the first one, or falls back to cleaned text
      const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/;
      const match = responseText.match(codeBlockRegex);
      
      if (match && match[1]) {
        return match[1].trim();
      }

      // Fallback if no code blocks found
      return responseText.replace(/```typescript/g, '').replace(/```/g, '').trim();
    } catch (error: any) {
      throw new Error(`Gemini API call failed: ${error.message}`);
    }
  }
}
