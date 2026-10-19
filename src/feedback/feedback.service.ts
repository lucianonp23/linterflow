import { Injectable, Logger } from '@nestjs/common';
import {
  AnalysisReport,
  RefactoringPrompt,
  RejectedAttempt,
  MAX_CYCLOMATIC_COMPLEXITY,
  MIN_MAINTAINABILITY_INDEX,
  MAX_DUPLICATION_RATE,
} from '../core/types';

@Injectable()
export class FeedbackService {
  // TODO desenvolver de uma forma mais dinâmica a geração de prompts com base
  // na análise feita --> Ser mais flexivel em relacao ao resultado anterior --> mais design patterns
  
  
    private readonly logger = new Logger(FeedbackService.name);

  // Quality thresholds live in core/types.ts so the Evaluator counts violations
  // against exactly the same numbers this service gates on.
  private readonly MAX_CYCLOMATIC_COMPLEXITY = MAX_CYCLOMATIC_COMPLEXITY;
  private readonly MIN_MAINTAINABILITY_INDEX = MIN_MAINTAINABILITY_INDEX;
  private readonly MAX_DUPLICATION_RATE = MAX_DUPLICATION_RATE;

  /**
   * Analyzes the Evaluator's report and generates a refactoring prompt if thresholds are breached.
   * @param report The structured data from the EvaluatorService.
   * @returns A RefactoringPrompt object, or null if the code is healthy.
   */
  public generateRefactoringPrompt(
    report: AnalysisReport,
    rejectedAttempt?: RejectedAttempt,
  ): RefactoringPrompt | null {
    this.logger.log(`Evaluating metrics for: ${report.filePath}`);

    const issues: string[] = [];
    let promptPriority: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

    // 1. Check Cyclomatic Complexity — per function, never summed over the file.
    // `cyclomaticViolations > 0` is equivalent to `max CC > threshold`; it is
    // phrased as a count because that is what the prompt needs to convey.
    if (report.metrics.cyclomaticViolations > 0) {
      const { cyclomaticViolations, functionCount, violatingFunctions } = report.metrics;

      // Naming the offending functions is the point. Describing the problem in
      // aggregate ("2 of 6 functions are too complex") leaves the model to
      // locate them inside a file that can run to 37k characters; pointing at
      // them directly is the mechanism Blyth et al. (SCAM 2025) found to drive
      // most of the improvement in static-analysis-guided repair.
      const named = violatingFunctions
        .map((fn) => `    · ${fn.name} — CC ${fn.cyclomaticComplexity}`)
        .join('\n');

      issues.push(
        `- ${cyclomaticViolations} of the ${functionCount} function(s) in this file exceed the maximum Cyclomatic Complexity of ${this.MAX_CYCLOMATIC_COMPLEXITY}:\n${named}\n` +
          `  Refactor exactly those functions to reduce nested conditionals — consider the Strategy pattern or extracting logic into smaller helper functions. Do not simply move the branching into new helpers if the same decisions still have to be made; prefer removing the branching outright. Leave the functions that are already within the threshold alone.`
      );
      promptPriority = 'HIGH';
    }

    // 2. Check Maintainability Index
    if (report.metrics.maintainabilityIndex < this.MIN_MAINTAINABILITY_INDEX) {
      issues.push(
        `- The Maintainability Index is too low at ${report.metrics.maintainabilityIndex.toFixed(2)}. The code is becoming hard to read and maintain. Please simplify the logic and ensure variable names are descriptive.`
      );
      if (promptPriority === 'LOW') promptPriority = 'MEDIUM';
    }

    // 3. Check for DRY Violations (Duplication rate above the 3% threshold)
    if (report.duplicationRate > this.MAX_DUPLICATION_RATE) {
      issues.push(
        `- The duplication rate is ${report.duplicationRate.toFixed(2)}% across ${report.duplications.length} duplicated code block(s) (Threshold: ${this.MAX_DUPLICATION_RATE}%). Please refactor by extracting the duplicated logic into a shared utility function or base class to adhere to the DRY principle.`
      );
      promptPriority = 'HIGH'; // Duplication is usually a high priority structural flaw
    }

    // 4. Return null if no issues were found (Code meets quality standards!)
    if (issues.length === 0) {
      this.logger.log('Code meets quality standards. No refactoring prompt generated.');
      return null;
    }

    // On splitting the issues across separate prompts: Blyth et al. (SCAM 2025)
    // tested 1, 2, 3, 5 and all-at-once, and only "one issue per iteration" was
    // clearly worse across quality dimensions. Sending them together is the
    // empirically supported choice, so this stays as one prompt.
    //
    // 5. Assemble the final System Prompt for the LLM
    const previous = rejectedAttempt
      ? `\nThe previous attempt at this file was REJECTED and rolled back: ${rejectedAttempt.reason}.\n` +
        `Do not repeat that approach — the code below is the version before it, unchanged.\n`
      : '';

    const suggestedPrompt = `
You are an expert Software Architect assisting with the LinterFlow automated refactoring process.
Please review the following file: ${report.filePath}

The static analysis engine has identified the following structural technical debt:
${issues.join('\n')}
${previous}
Task: Refactor the provided source code to resolve these specific issues.
Constraints:
1. Maintain all original business logic and functional requirements.
2. Preserve the file's public contract exactly — every exported class, function, interface, type and constant must keep its name and remain exported. Deleting or renaming exported code is not a refactoring and will be rejected.
3. Return ONLY the raw refactored source code. Do not include markdown formatting or conversational text.
    `.trim();

    this.logger.log(`Generated a ${promptPriority} priority refactoring prompt.`);

    return {
      targetFilePath: report.filePath,
      suggestedPrompt,
      priority: promptPriority,
    };
  }
}