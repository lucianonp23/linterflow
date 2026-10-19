import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProducerService } from './producer.service';
import { EvaluatorService } from '../evaluator/evaluator.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ReporterService } from '../reporter/reporter.service';
import * as fs from 'fs';
import { glob } from 'glob';

// 1. Mock the File System and Glob
jest.mock('fs');
jest.mock('glob');

// 2. Mock the Google Gemini SDK
const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('ProducerService', () => {
  let service: ProducerService;
  let feedbackService: FeedbackService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProducerService,
        {
          provide: ConfigService,
          useValue: {
            // Provide an API key; let GEMINI_MODEL fall back to the default.
            get: jest.fn((key: string) =>
              key === 'GEMINI_API_KEY' ? 'test-key' : undefined,
            ),
          },
        },
        {
          provide: EvaluatorService,
          useValue: {
            generateAST: jest.fn(),
            extractExportedSymbols: jest.fn().mockReturnValue(['Foo']),
            analyzeMetrics: jest.fn().mockReturnValue({ cyclomaticComplexity: 5, maintainabilityIndex: 80 }),
            detectDuplications: jest.fn().mockResolvedValue([]),
            calculateDuplicationRate: jest.fn().mockReturnValue(0),
          },
        },
        {
          provide: FeedbackService,
          useValue: {
            generateRefactoringPrompt: jest.fn(),
          },
        },
        {
          provide: ReporterService,
          useValue: {
            reset: jest.fn(),
            recordInitialMetrics: jest.fn(),
            recordFinalMetrics: jest.fn(),
            // Checkpointing: default to "no checkpoint on disk, nothing done
            // yet", so every test exercises a clean run unless it says otherwise.
            loadCheckpoint: jest.fn().mockReturnValue(0),
            hasCompleteRecord: jest.fn().mockReturnValue(false),
            saveCheckpoint: jest.fn(),
            discardCheckpoint: jest.fn(),
            recordedCount: jest.fn().mockReturnValue(0),
            checkpointPath: jest.fn().mockReturnValue('/src/linterflow-checkpoint.json'),
            generateReport: jest.fn().mockReturnValue({
              generatedAt: '2026-06-03T00:00:00.000Z',
              globalStats: {},
              files: [],
            }),
            exportJson: jest.fn().mockReturnValue('/src/report.json'),
            exportMarkdown: jest.fn().mockReturnValue('/src/report.md'),
          },
        },
      ],
    }).compile();

    service = module.get<ProducerService>(ProducerService);
    feedbackService = module.get<FeedbackService>(FeedbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw an error if GEMINI_API_KEY is missing', () => {
    const emptyConfig = { get: jest.fn().mockReturnValue(undefined) } as any;
    expect(
      () => new ProducerService(emptyConfig, null as any, null as any, null as any),
    ).toThrow('Missing GEMINI_API_KEY environment variable. Please check your .env file.');
  });

  it('should create a backup and restore it if refactoring fails after max iterations', async () => {
    const fakeFilePath = '/src/bad-file.ts';
    const backupPath = `${fakeFilePath}.bak`;
    const originalCode = 'const original = true;';

    (glob as unknown as jest.Mock).mockResolvedValue([fakeFilePath]);
    (fs.readFileSync as jest.Mock).mockReturnValue(originalCode);
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    // AI always returns a "fix", but Feedback Service always insists it still has technical debt
    jest.spyOn(feedbackService, 'generateRefactoringPrompt').mockReturnValue({
      targetFilePath: fakeFilePath,
      suggestedPrompt: 'Make it better',
      priority: 'HIGH',
    });
    mockGenerateContent.mockResolvedValue({ text: 'const aiFix = true;' });

    await service.orchestrateFolder('/src');

    // 1. Verify backup was created
    expect(fs.writeFileSync).toHaveBeenCalledWith(backupPath, originalCode, 'utf-8');

    // 2. Verify that after max iterations, it restored the original content
    expect(fs.writeFileSync).toHaveBeenCalledWith(fakeFilePath, originalCode, 'utf-8');

    // 3. Verify backup was deleted
    expect(fs.unlinkSync).toHaveBeenCalledWith(backupPath);
  });

  it('should successfully refactor, extract code from markdown, and delete backup', async () => {
    const fakeFilePath = '/src/refactor-me.ts';
    const originalCode = 'function old() {}';
    const fixedCode = 'function modern() {}';
    const mockPrompt = 'Refactor this';

    (glob as unknown as jest.Mock).mockResolvedValue([fakeFilePath]);
    (fs.readFileSync as jest.Mock).mockReturnValue(originalCode);

    // Feedback: First call returns prompt, second call returns null (success)
    jest.spyOn(feedbackService, 'generateRefactoringPrompt')
      .mockReturnValueOnce({
        targetFilePath: fakeFilePath,
        suggestedPrompt: mockPrompt,
        priority: 'HIGH',
      })
      .mockReturnValueOnce(null);

    // Gemini: Returns code wrapped in markdown
    mockGenerateContent.mockResolvedValue({ text: `\`\`\`typescript\n${fixedCode}\n\`\`\`` });

    await service.orchestrateFolder('/src');

    // Validation 1: Ensure Gemini was called with the correct model and prompt
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.6-flash',
      contents: expect.stringContaining(mockPrompt)
    }));
  });

  describe('refactoring budget', () => {
    const fakeFilePath = '/src/budget.ts';
    const MAX_ITERATIONS = 5;

    const debtPrompt = {
      targetFilePath: fakeFilePath,
      suggestedPrompt: 'Make it better',
      priority: 'HIGH' as const,
    };

    beforeEach(() => {
      (glob as unknown as jest.Mock).mockResolvedValue([fakeFilePath]);
      (fs.readFileSync as jest.Mock).mockReturnValue('const code = true;');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockGenerateContent.mockResolvedValue({ text: 'const fixed = true;' });
    });

    it('never spends a call whose result is not evaluated', async () => {
      // Debt on every analysis: the file never converges.
      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValue(debtPrompt);

      await service.orchestrateFolder('/src');

      // The loop analyses before it refactors, so the budget buys exactly
      // MAX calls and each of their results gets measured.
      expect(mockGenerateContent).toHaveBeenCalledTimes(MAX_ITERATIONS);
      // MAX calls + the analysis that evaluates the last one.
      expect(feedbackService.generateRefactoringPrompt).toHaveBeenCalledTimes(
        MAX_ITERATIONS + 1,
      );
    });

    it('counts a file that converges on the last allowed iteration as converged', async () => {
      const reporter = (service as any).reporter as ReporterService;

      // Debt on the first 5 analyses; the 6th (after the 5th refactor) is clean.
      const spy = jest.spyOn(feedbackService, 'generateRefactoringPrompt');
      for (let i = 0; i < MAX_ITERATIONS; i++) spy.mockReturnValueOnce(debtPrompt);
      spy.mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      // Before the fix the loop exited without ever evaluating the 5th result,
      // so this file was rolled back and recorded as a failure.
      expect(reporter.recordFinalMetrics).toHaveBeenCalledWith(
        fakeFilePath,
        expect.anything(),
        expect.anything(),
        MAX_ITERATIONS,
        true, // converged
      );
      expect(fs.unlinkSync).toHaveBeenCalledWith(`${fakeFilePath}.bak`);
    });

    it('records a file that exhausts the budget as not converged', async () => {
      const reporter = (service as any).reporter as ReporterService;

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValue(debtPrompt);

      await service.orchestrateFolder('/src');

      expect(reporter.recordFinalMetrics).toHaveBeenCalledWith(
        fakeFilePath,
        expect.anything(),
        expect.anything(),
        MAX_ITERATIONS,
        false,
      );
    });
  });

  describe('API resilience', () => {
    it('retries a rate-limited call instead of recording a false non-convergence', async () => {
      const fakeFilePath = '/src/throttled.ts';
      const reporter = (service as any).reporter as ReporterService;

      (glob as unknown as jest.Mock).mockResolvedValue([fakeFilePath]);
      (fs.readFileSync as jest.Mock).mockReturnValue('const code = true;');
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce({
          targetFilePath: fakeFilePath,
          suggestedPrompt: 'Make it better',
          priority: 'HIGH',
        })
        .mockReturnValueOnce(null);

      // First attempt is throttled, the retry succeeds.
      mockGenerateContent
        .mockRejectedValueOnce(new Error('429 Too Many Requests: quota exceeded'))
        .mockResolvedValueOnce({ text: 'const fixed = true;' });

      await service.orchestrateFolder('/src');

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      // The transient 429 must not leak out as an experimental result.
      expect(reporter.recordFinalMetrics).toHaveBeenCalledWith(
        fakeFilePath,
        expect.anything(),
        expect.anything(),
        1,
        true,
      );
    }, 20_000);

    it('gives up on an error that retrying cannot fix', async () => {
      const fakeFilePath = '/src/bad-key.ts';
      const originalCode = 'const code = true;';

      (glob as unknown as jest.Mock).mockResolvedValue([fakeFilePath]);
      (fs.readFileSync as jest.Mock).mockReturnValue(originalCode);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      jest.spyOn(feedbackService, 'generateRefactoringPrompt').mockReturnValue({
        targetFilePath: fakeFilePath,
        suggestedPrompt: 'Make it better',
        priority: 'HIGH',
      });

      mockGenerateContent.mockRejectedValue(new Error('400 API key not valid'));

      await service.orchestrateFolder('/src');

      // No point burning the backoff schedule on a permanent failure.
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledWith(fakeFilePath, originalCode, 'utf-8');
    });
  });

  it('should restore backup if a fatal error occurs during processing', async () => {
    const fakeFilePath = '/src/fatal.ts';
    const originalCode = 'fatal code';

    (glob as unknown as jest.Mock).mockResolvedValue([fakeFilePath]);
    (fs.readFileSync as jest.Mock).mockReturnValue(originalCode);
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    // Simulate a crash in the feedback stage
    jest.spyOn(feedbackService, 'generateRefactoringPrompt').mockImplementation(() => {
      throw new Error('Unexpected crash');
    });

    await service.orchestrateFolder('/src');

    // Verify it restored the original code after the crash
    expect(fs.writeFileSync).toHaveBeenCalledWith(fakeFilePath, originalCode, 'utf-8');
    expect(fs.unlinkSync).toHaveBeenCalledWith(`${fakeFilePath}.bak`);
  });

  /**
   * Checkpointing. The pre-mitigation snapshots live only in the Reporter's
   * memory until the run ends, and they cannot be recovered by starting over:
   * converged files have already been overwritten with refactored code. Losing
   * the process at file 55 of 60 would mean paying for all 60 again.
   */
  describe('checkpointing', () => {
    const fileA = '/src/a.ts';
    const fileB = '/src/b.ts';

    beforeEach(() => {
      (glob as unknown as jest.Mock).mockResolvedValue([fileA, fileB]);
      (fs.readFileSync as jest.Mock).mockReturnValue('const code = true;');
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      jest.spyOn(feedbackService, 'generateRefactoringPrompt').mockReturnValue(null);
    });

    it('persists after every file, not only at the end of the run', async () => {
      const reporter = (service as any).reporter as ReporterService;

      await service.orchestrateFolder('/src');

      // Two files -> two checkpoint writes. A single write at the end would
      // lose everything to a crash mid-batch.
      expect(reporter.saveCheckpoint).toHaveBeenCalledTimes(2);
      expect(reporter.saveCheckpoint).toHaveBeenCalledWith('/src');
    });

    it('skips files the checkpoint already accounts for', async () => {
      const reporter = (service as any).reporter as ReporterService;
      (reporter.loadCheckpoint as jest.Mock).mockReturnValue(1);
      (reporter.hasCompleteRecord as jest.Mock).mockImplementation(
        (p: string) => p === fileA,
      );

      await service.orchestrateFolder('/src');

      // Only the unfinished file is reprocessed, and the accumulated state is
      // kept rather than wiped.
      expect(reporter.reset).not.toHaveBeenCalled();
      expect(reporter.recordInitialMetrics).toHaveBeenCalledTimes(1);
      expect(reporter.recordInitialMetrics).toHaveBeenCalledWith(
        fileB,
        expect.anything(),
        expect.anything(),
      );
    });

    it('resets when there is no checkpoint to resume', async () => {
      const reporter = (service as any).reporter as ReporterService;

      await service.orchestrateFolder('/src');

      expect(reporter.reset).toHaveBeenCalled();
    });

    it('discards the checkpoint once the report is on disk', async () => {
      const reporter = (service as any).reporter as ReporterService;

      await service.orchestrateFolder('/src');

      // Leaving it behind would make the next run resume a finished batch.
      expect(reporter.discardCheckpoint).toHaveBeenCalledWith('/src');
    });

    it('restores a leftover backup before measuring an interrupted file', async () => {
      // A .bak still on disk means the previous run died mid-refactor, so the
      // file may hold a half-applied iteration. Measuring it as-is would record
      // partially refactored code as the "pre" state.
      (fs.existsSync as jest.Mock).mockImplementation(
        (p: string) => p === `${fileA}.bak`,
      );

      await service.orchestrateFolder('/src');

      expect(fs.copyFileSync).toHaveBeenCalledWith(`${fileA}.bak`, fileA);
      expect(fs.copyFileSync).not.toHaveBeenCalledWith(`${fileB}.bak`, fileB);
    });
  });

  /**
   * The acceptance guard: a generation is kept only if it does not regress.
   * Without it a bad iteration is written to disk and the next one builds on
   * top of it, so a run can finish worse than it started.
   */
  describe('acceptance guard', () => {
    const fakeFilePath = '/src/guarded.ts';
    const originalCode = 'const code = true;';
    const candidateCode = 'const fixed = true;';

    const debtPrompt = {
      targetFilePath: fakeFilePath,
      suggestedPrompt: 'Make it better',
      priority: 'HIGH' as const,
    };

    /** FileMetrics with only the fields the guard compares. */
    const m = (cyclomaticViolations: number, cyclomaticComplexity: number, maintainabilityIndex = 70) => ({
      cyclomaticComplexity,
      maintainabilityIndex,
      cyclomaticViolations,
      totalCyclomaticComplexity: cyclomaticComplexity * 2,
      functionCount: 4,
    });

    /** Writes to the target file, in order, ignoring the .bak write. */
    const writesToTarget = () =>
      (fs.writeFileSync as jest.Mock).mock.calls
        .filter((call) => call[0] === fakeFilePath)
        .map((call) => call[1]);

    beforeEach(() => {
      (glob as unknown as jest.Mock).mockResolvedValue([fakeFilePath]);
      (fs.readFileSync as jest.Mock).mockReturnValue(originalCode);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockGenerateContent.mockResolvedValue({ text: candidateCode });
    });

    it('rolls back a candidate that makes the file worse', async () => {
      const evaluator = (service as any).evaluator as EvaluatorService;

      (evaluator.analyzeMetrics as jest.Mock)
        .mockReturnValueOnce(m(1, 12)) // pre-mitigation snapshot
        .mockReturnValueOnce(m(1, 12)) // loop top, iteration 1
        .mockReturnValueOnce(m(3, 20)) // the candidate — regressed
        .mockReturnValue(m(1, 12)); // loop top again, after the rollback

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce(debtPrompt)
        .mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      // The candidate is written (jscpd needs a real file), then undone.
      expect(writesToTarget()).toEqual([candidateCode, originalCode]);
    });

    it('keeps a candidate that improves the file', async () => {
      const evaluator = (service as any).evaluator as EvaluatorService;

      (evaluator.analyzeMetrics as jest.Mock)
        .mockReturnValueOnce(m(2, 15)) // pre-mitigation snapshot
        .mockReturnValueOnce(m(2, 15)) // loop top, iteration 1
        .mockReturnValue(m(0, 6)); // the candidate, and every read after it

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce(debtPrompt)
        .mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      // Written once and never undone.
      expect(writesToTarget()).toEqual([candidateCode]);
    });

    it('rolls back a candidate that no longer parses', async () => {
      const evaluator = (service as any).evaluator as EvaluatorService;

      (evaluator.analyzeMetrics as jest.Mock).mockReturnValue(m(1, 12));

      // generateAST runs at the top of the loop and again on the candidate.
      (evaluator.generateAST as jest.Mock)
        .mockImplementationOnce(() => undefined) // loop top, iteration 1
        .mockImplementationOnce(() => {
          throw new Error('Static analysis error: Unexpected token');
        })
        .mockImplementation(() => undefined);

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce(debtPrompt)
        .mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      expect(writesToTarget()).toEqual([candidateCode, originalCode]);
    });

    it('rejects a candidate that drops an exported symbol', async () => {
      // Deletion beats refactoring on every metric the guard compares, so
      // without this check an emptied file is the best-scoring candidate there
      // is: zero violations, CC of 1, and a higher Maintainability Index.
      const evaluator = (service as any).evaluator as EvaluatorService;

      (evaluator.analyzeMetrics as jest.Mock)
        .mockReturnValueOnce(m(4, 89))
        .mockReturnValueOnce(m(4, 89))
        .mockReturnValue(m(0, 1)); // the gutted candidate — perfect on paper

      (evaluator.extractExportedSymbols as jest.Mock)
        .mockReturnValueOnce(['ClaimsController', 'CreateClaimDto']) // original
        .mockReturnValue(['ClaimsController']); // candidate lost one

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce(debtPrompt)
        .mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      expect(writesToTarget()).toEqual([candidateCode, originalCode]);
    });

    it('allows a candidate that adds exports while keeping the originals', async () => {
      // Extracting a helper and exporting it is a legitimate refactoring.
      const evaluator = (service as any).evaluator as EvaluatorService;

      (evaluator.analyzeMetrics as jest.Mock)
        .mockReturnValueOnce(m(2, 15))
        .mockReturnValueOnce(m(2, 15))
        .mockReturnValue(m(0, 6));

      (evaluator.extractExportedSymbols as jest.Mock)
        .mockReturnValueOnce(['ClaimsController'])
        .mockReturnValue(['ClaimsController', 'extractedHelper']);

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce(debtPrompt)
        .mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      expect(writesToTarget()).toEqual([candidateCode]);
    });

    it('tells the next prompt why the last candidate was rejected', async () => {
      const evaluator = (service as any).evaluator as EvaluatorService;

      (evaluator.analyzeMetrics as jest.Mock)
        .mockReturnValueOnce(m(1, 12))
        .mockReturnValueOnce(m(1, 12))
        .mockReturnValueOnce(m(3, 20)) // rejected: worse
        .mockReturnValue(m(1, 12));

      const spy = jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce(debtPrompt)
        .mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      // First call has no history; the one after the rollback carries it.
      expect(spy.mock.calls[0][1]).toBeUndefined();
      expect(spy.mock.calls[1][1]).toEqual(
        expect.objectContaining({ iteration: 1, reason: expect.stringContaining('worse') }),
      );
    });

    it('accepts a candidate of exactly equal quality rather than stalling', async () => {
      const evaluator = (service as any).evaluator as EvaluatorService;

      (evaluator.analyzeMetrics as jest.Mock).mockReturnValue(m(1, 12));

      jest
        .spyOn(feedbackService, 'generateRefactoringPrompt')
        .mockReturnValueOnce(debtPrompt)
        .mockReturnValueOnce(null);

      await service.orchestrateFolder('/src');

      expect(writesToTarget()).toEqual([candidateCode]);
    });
  });
});
