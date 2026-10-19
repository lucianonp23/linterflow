import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReporterService } from './reporter.service';
import { FileMetrics } from '../core/types';

function metrics(overrides: Partial<FileMetrics> = {}): FileMetrics {
  return {
    cyclomaticComplexity: 5,
    maintainabilityIndex: 80,
    cyclomaticViolations: 0,
    totalCyclomaticComplexity: 15,
    functionCount: 5,
    violatingFunctions: [],
    ...overrides,
  };
}

describe('ReporterService', () => {
  let service: ReporterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReporterService],
    }).compile();

    service = module.get<ReporterService>(ReporterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should compute the delta between initial and final metrics', () => {
    service.recordInitialMetrics(
      'src/foo.ts',
      metrics({ cyclomaticComplexity: 18, maintainabilityIndex: 40 }),
      12,
    );
    service.recordFinalMetrics(
      'src/foo.ts',
      metrics({ cyclomaticComplexity: 8, maintainabilityIndex: 72 }),
      0,
      3,
      true,
    );

    const report = service.generateReport();
    const file = report.files[0];

    expect(file.delta.cyclomaticComplexity).toBe(-10); // 8 - 18
    expect(file.delta.maintainabilityIndex).toBe(32); // 72 - 40
    expect(file.delta.duplicationRate).toBe(-12); // 0 - 12
    expect(file.converged).toBe(true);
    expect(file.improved).toBe(true);
  });

  it('should track violations, total complexity and function count', () => {
    service.recordInitialMetrics(
      'src/svc.ts',
      metrics({
        cyclomaticComplexity: 19,
        cyclomaticViolations: 1,
        totalCyclomaticComplexity: 31,
        functionCount: 13,
      }),
      0,
    );
    service.recordFinalMetrics(
      'src/svc.ts',
      metrics({
        cyclomaticComplexity: 7,
        cyclomaticViolations: 0,
        totalCyclomaticComplexity: 37,
        functionCount: 17,
      }),
      0,
      2,
      true,
    );

    const file = service.generateReport().files[0];

    expect(file.delta.cyclomaticViolations).toBe(-1);
    expect(file.delta.totalCyclomaticComplexity).toBe(6);
    expect(file.delta.functionCount).toBe(4);
  });

  it('counts a file whose max fell but total did not as redistributed', () => {
    // Extract Method: the worst function got simpler, but the branching was
    // relocated rather than removed, so the total went UP.
    service.recordInitialMetrics(
      'src/moved.ts',
      metrics({ cyclomaticComplexity: 19, totalCyclomaticComplexity: 31 }),
      0,
    );
    service.recordFinalMetrics(
      'src/moved.ts',
      metrics({ cyclomaticComplexity: 7, totalCyclomaticComplexity: 37 }),
      0,
      2,
      true,
    );

    // Genuine removal: both fell.
    service.recordInitialMetrics(
      'src/removed.ts',
      metrics({ cyclomaticComplexity: 14, totalCyclomaticComplexity: 30 }),
      0,
    );
    service.recordFinalMetrics(
      'src/removed.ts',
      metrics({ cyclomaticComplexity: 6, totalCyclomaticComplexity: 18 }),
      0,
      1,
      true,
    );

    const { globalStats } = service.generateReport();

    expect(globalStats.filesComplexityRedistributed).toBe(1);
  });

  it('should aggregate global statistics across files', () => {
    service.recordInitialMetrics('a.ts', metrics({ cyclomaticComplexity: 12, maintainabilityIndex: 50 }), 5);
    service.recordFinalMetrics('a.ts', metrics({ cyclomaticComplexity: 6, maintainabilityIndex: 70 }), 0, 2, true);

    service.recordInitialMetrics('b.ts', metrics({ cyclomaticComplexity: 20, maintainabilityIndex: 30 }), 8);
    service.recordFinalMetrics('b.ts', metrics({ cyclomaticComplexity: 20, maintainabilityIndex: 30 }), 8, 5, false);

    const { globalStats } = service.generateReport();

    expect(globalStats.totalFiles).toBe(2);
    expect(globalStats.filesConverged).toBe(1);
    expect(globalStats.filesNotConverged).toBe(1);
    expect(globalStats.filesImproved).toBe(1);
    expect(globalStats.avgIterations).toBe(3.5); // (2 + 5) / 2
  });

  it('should reset accumulated records', () => {
    service.recordInitialMetrics('x.ts', metrics({ cyclomaticComplexity: 1, maintainabilityIndex: 99 }), 0);
    service.reset();
    expect(service.generateReport().files).toHaveLength(0);
  });

  /**
   * Checkpointing against the real filesystem — the Producer's own tests mock
   * this service away, so this is the only place the round trip is exercised.
   */
  describe('checkpointing', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linterflow-checkpoint-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('survives a round trip through disk', () => {
      service.recordInitialMetrics('a.ts', metrics({ cyclomaticComplexity: 18 }), 4);
      service.recordFinalMetrics('a.ts', metrics({ cyclomaticComplexity: 7 }), 1, 3, true);
      service.recordInitialMetrics('b.ts', metrics({ cyclomaticComplexity: 12 }), 0);
      service.saveCheckpoint(dir);

      const restored = new ReporterService();
      expect(restored.loadCheckpoint(dir)).toBe(2);

      // a.ts finished; b.ts was interrupted after its pre-snapshot and must be
      // redone, so only the first counts as complete.
      expect(restored.hasCompleteRecord('a.ts')).toBe(true);
      expect(restored.hasCompleteRecord('b.ts')).toBe(false);

      const file = restored.generateReport().files.find((f) => f.filePath === 'a.ts');
      expect(file?.delta.cyclomaticComplexity).toBe(-11);
      expect(file?.iterations).toBe(3);
      expect(file?.converged).toBe(true);
    });

    it('reports nothing to resume when no checkpoint exists', () => {
      expect(service.loadCheckpoint(dir)).toBe(0);
    });

    it('replaces accumulated state instead of merging into it', () => {
      service.recordInitialMetrics('a.ts', metrics(), 0);
      service.saveCheckpoint(dir);

      service.recordInitialMetrics('stale.ts', metrics(), 0);
      service.loadCheckpoint(dir);

      expect(service.recordedCount()).toBe(1);
      expect(service.hasCompleteRecord('stale.ts')).toBe(false);
    });

    it('preserves a corrupt checkpoint and starts clean rather than refusing to run', () => {
      fs.writeFileSync(service.checkpointPath(dir), '{ not json', 'utf-8');

      expect(service.loadCheckpoint(dir)).toBe(0);
      expect(fs.existsSync(service.checkpointPath(dir))).toBe(false);
      const preserved = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
      expect(preserved).toHaveLength(1);
    });

    it('rejects a checkpoint written by an incompatible version', () => {
      fs.writeFileSync(
        service.checkpointPath(dir),
        JSON.stringify({ version: 99, savedAt: 'x', records: [] }),
        'utf-8',
      );
      expect(service.loadCheckpoint(dir)).toBe(0);
    });

    it('discards the checkpoint on request, and tolerates it being gone', () => {
      service.recordInitialMetrics('a.ts', metrics(), 0);
      service.saveCheckpoint(dir);
      expect(fs.existsSync(service.checkpointPath(dir))).toBe(true);

      service.discardCheckpoint(dir);
      expect(fs.existsSync(service.checkpointPath(dir))).toBe(false);
      expect(() => service.discardCheckpoint(dir)).not.toThrow();
    });

    it('leaves no temporary file behind after a save', () => {
      service.recordInitialMetrics('a.ts', metrics(), 0);
      service.saveCheckpoint(dir);
      expect(fs.readdirSync(dir)).toEqual(['linterflow-checkpoint.json']);
    });
  });
});
