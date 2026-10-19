import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackService } from './feedback.service';
import { AnalysisReport, FileMetrics } from '../core/types';

/**
 * Builds a FileMetrics with sane defaults so each test only states the fields
 * it actually cares about.
 */
function metrics(overrides: Partial<FileMetrics> = {}): FileMetrics {
  return {
    cyclomaticComplexity: 3,
    maintainabilityIndex: 85,
    cyclomaticViolations: 0,
    totalCyclomaticComplexity: 9,
    functionCount: 4,
    violatingFunctions: [],
    ...overrides,
  };
}

describe('FeedbackService', () => {
  let service: FeedbackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeedbackService],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return null if the code is healthy (below thresholds)', () => {
    const healthyReport: AnalysisReport = {
      filePath: 'src/healthy-module.ts',
      metrics: metrics({ cyclomaticComplexity: 5, maintainabilityIndex: 85 }),
      duplications: [],
      duplicationRate: 0,
    };

    expect(service.generateRefactoringPrompt(healthyReport)).toBeNull();
  });

  it('should generate a HIGH priority prompt for complex code and duplications', () => {
    const badReport: AnalysisReport = {
      filePath: 'src/legacy-module.ts',
      metrics: metrics({
        cyclomaticComplexity: 15,
        maintainabilityIndex: 50,
        cyclomaticViolations: 2,
        totalCyclomaticComplexity: 40,
        functionCount: 6,
        violatingFunctions: [
          { name: 'processOrder', cyclomaticComplexity: 15 },
          { name: 'applyDiscount', cyclomaticComplexity: 12 },
        ],
      }),
      duplications: [{ lines: '10-25', fragment: 'function processOrder() { ... }' }],
      duplicationRate: 12.5, // Above the 3% threshold
    };

    const result = service.generateRefactoringPrompt(badReport);

    expect(result).toBeDefined();
    expect(result?.priority).toBe('HIGH');
    expect(result?.suggestedPrompt).toContain('2 of the 6 function(s)');
    expect(result?.suggestedPrompt).toContain('processOrder — CC 15');
    expect(result?.suggestedPrompt).toContain('The Maintainability Index is too low');
    expect(result?.suggestedPrompt).toContain('1 duplicated code block(s)');
  });

  it('gates on the violation count, not on the summed complexity of the file', () => {
    // A large but healthy file: no single function breaches the threshold even
    // though the decision points across the whole file add up well past it.
    // Summing instead of taking the max is what used to make this file fail.
    const largeButHealthy: AnalysisReport = {
      filePath: 'src/big-but-simple.ts',
      metrics: metrics({
        cyclomaticComplexity: 8,
        totalCyclomaticComplexity: 64,
        functionCount: 20,
        cyclomaticViolations: 0,
      }),
      duplications: [],
      duplicationRate: 0,
    };

    expect(service.generateRefactoringPrompt(largeButHealthy)).toBeNull();
  });

  it('names the offending functions instead of describing them in aggregate', () => {
    // Pointing at the functions is the whole mechanism: a 37k-character file
    // gives the model no way to find "2 of 6 functions" on its own.
    const report: AnalysisReport = {
      filePath: 'src/claims.controller.ts',
      metrics: metrics({
        cyclomaticComplexity: 89,
        cyclomaticViolations: 2,
        functionCount: 5,
        violatingFunctions: [
          { name: 'processClaim', cyclomaticComplexity: 89 },
          { name: 'validateCoverage', cyclomaticComplexity: 31 },
        ],
      }),
      duplications: [],
      duplicationRate: 0,
    };

    const prompt = service.generateRefactoringPrompt(report)?.suggestedPrompt ?? '';

    expect(prompt).toContain('processClaim — CC 89');
    expect(prompt).toContain('validateCoverage — CC 31');
    expect(prompt).toContain('Leave the functions that are already within the threshold alone');
  });

  it('tells the model the public contract must survive', () => {
    const report: AnalysisReport = {
      filePath: 'src/x.ts',
      metrics: metrics({
        cyclomaticViolations: 1,
        violatingFunctions: [{ name: 'doIt', cyclomaticComplexity: 20 }],
      }),
      duplications: [],
      duplicationRate: 0,
    };

    const prompt = service.generateRefactoringPrompt(report)?.suggestedPrompt ?? '';

    expect(prompt).toContain('Preserve the file\'s public contract exactly');
  });

  it('feeds a rejected attempt back into the next prompt', () => {
    // Without this the loop resends an identical request against identical
    // code, since the rollback restores exactly what was analysed before.
    const report: AnalysisReport = {
      filePath: 'src/x.ts',
      metrics: metrics({
        cyclomaticViolations: 1,
        violatingFunctions: [{ name: 'doIt', cyclomaticComplexity: 20 }],
      }),
      duplications: [],
      duplicationRate: 0,
    };

    const clean = service.generateRefactoringPrompt(report)?.suggestedPrompt ?? '';
    expect(clean).not.toContain('REJECTED');

    const retried =
      service.generateRefactoringPrompt(report, {
        iteration: 2,
        reason: 'the candidate dropped 3 exported symbol(s)',
      })?.suggestedPrompt ?? '';

    expect(retried).toContain('REJECTED');
    expect(retried).toContain('dropped 3 exported symbol(s)');
    expect(retried).toContain('Do not repeat that approach');
  });

  it('flags a single monstrous function hiding among trivial ones', () => {
    // The mean CC here is 19/13 ≈ 1.5 — an average would call this healthy.
    const oneHotspot: AnalysisReport = {
      filePath: 'src/payment.service.ts',
      metrics: metrics({
        cyclomaticComplexity: 19,
        totalCyclomaticComplexity: 31,
        functionCount: 13,
        cyclomaticViolations: 1,
      }),
      duplications: [],
      duplicationRate: 0,
    };

    const result = service.generateRefactoringPrompt(oneHotspot);

    expect(result?.priority).toBe('HIGH');
    expect(result?.suggestedPrompt).toContain('1 of the 13 function(s)');
  });
});
