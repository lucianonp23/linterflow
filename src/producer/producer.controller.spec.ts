import { Test, TestingModule } from '@nestjs/testing';
import { ProducerController } from './producer.controller';
import { ProducerService } from './producer.service';
import { ReporterService } from '../reporter/reporter.service';
import { PipelineBillingService } from '../credits/pipeline-billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AppEnvironmentService } from '../core/app-environment.service';
import { ForbiddenException } from '@nestjs/common';
import { AuthPrincipal } from '../users/user.types';

describe('ProducerController', () => {
  let controller: ProducerController;
  let producerService: jest.Mocked<ProducerService>;
  let reporterService: jest.Mocked<ReporterService>;
  let billingService: jest.Mocked<PipelineBillingService>;
  let mockAppEnvironment: any;

  const principal: AuthPrincipal = {
    sub: 'user-1',
    role: 'user',
    name: 'Test User',
    email: 'test@example.com',
  };

  const authorizedRun = {
    run: { id: 'run-1' },
    estimate: {
      files: [
        { filePath: '/x/a.ts', loc: 120, category: 'medium', cost: 1 },
        { filePath: '/x/b.ts', loc: 450, category: 'long', cost: 2 },
      ],
      totalCost: 3,
    },
    creditsCharged: 3,
    creditsRemaining: 7,
  };

  beforeEach(async () => {
    const mockProducerService = {
      orchestrateFolder: jest.fn().mockResolvedValue(undefined),
    };

    const mockBillingService = {
      authorizeRun: jest.fn().mockResolvedValue(authorizedRun),
      completeRun: jest.fn(),
    };

    const mockReporterService = {
      generateReport: jest.fn().mockReturnValue({
        generatedAt: '2026-06-03T00:00:00.000Z',
        globalStats: {
          totalFiles: 1,
          filesConverged: 1,
          filesNotConverged: 0,
          filesImproved: 1,
          avgIterations: 2,
          avgDeltaCyclomaticComplexity: -5,
          avgDeltaMaintainabilityIndex: 20,
          avgDeltaDuplicationRate: -2,
        },
        files: [
          {
            filePath: 'src/foo.ts',
            initial: {
              cyclomaticComplexity: 15,
              maintainabilityIndex: 50,
              duplicationRate: 5,
            },
            final: {
              cyclomaticComplexity: 10,
              maintainabilityIndex: 70,
              duplicationRate: 3,
            },
            delta: {
              cyclomaticComplexity: -5,
              maintainabilityIndex: 20,
              duplicationRate: -2,
            },
            iterations: 2,
            converged: true,
            improved: true,
          },
        ],
      }),
    };

    mockAppEnvironment = {
      current: 'staging',
      isProduction: jest.fn().mockReturnValue(false),
      isLocalPathAnalysisEnabled: jest.fn().mockReturnValue(true),
      assertLocalPathAnalysisAllowed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProducerController],
      providers: [
        {
          provide: ProducerService,
          useValue: mockProducerService,
        },
        {
          provide: ReporterService,
          useValue: mockReporterService,
        },
        {
          provide: PipelineBillingService,
          useValue: mockBillingService,
        },
        {
          // Staging by default here: the existing cases assert the happy path,
          // and the production refusal gets its own block below.
          provide: AppEnvironmentService,
          useValue: mockAppEnvironment,
        },
      ],
    })
      // The real guard needs JwtService; unit tests call handlers directly.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProducerController>(ProducerController);
    producerService = module.get(ProducerService) as jest.Mocked<ProducerService>;
    reporterService = module.get(ReporterService) as jest.Mocked<ReporterService>;
    billingService = module.get(
      PipelineBillingService,
    ) as jest.Mocked<PipelineBillingService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/orchestrator/start', () => {
    it('should return 202 Accepted with correct response shape', async () => {
      const dto = { targetDirectory: './mock-code' };
      const before = new Date().getTime();
      const result = await controller.startOrchestration(dto, principal);
      const after = new Date().getTime();

      expect(result.status).toBe('PROCESSING');
      expect(result.message).toContain('started successfully in the background');
      expect(result.targetDirectory).toBe('./mock-code');
      expect(result.timestamp).toBeDefined();

      // Verify timestamp is ISO string and within reasonable bounds
      const timestamp = new Date(result.timestamp).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should charge the account before starting the pipeline', async () => {
      const dto = { targetDirectory: './src' };
      const result = await controller.startOrchestration(dto, principal);

      expect(billingService.authorizeRun).toHaveBeenCalledWith(
        principal,
        'local',
        './src',
        './src',
      );
      expect(result.runId).toBe('run-1');
      expect(result.filesFound).toBe(2);
      expect(result.creditsCharged).toBe(3);
      expect(result.creditsRemaining).toBe(7);
    });

    it('should call orchestrateFolder without await (fire-and-forget)', async () => {
      const dto = { targetDirectory: './src' };
      await controller.startOrchestration(dto, principal);

      // Verify the method was called
      expect(producerService.orchestrateFolder).toHaveBeenCalledWith('./src');
      // Verify it was called exactly once
      expect(producerService.orchestrateFolder).toHaveBeenCalledTimes(1);
    });

    it('should not start the pipeline when authorization fails (e.g. 402)', async () => {
      billingService.authorizeRun.mockRejectedValueOnce(
        new Error('Insufficient credits'),
      );

      await expect(
        controller.startOrchestration({ targetDirectory: './src' }, principal),
      ).rejects.toThrow('Insufficient credits');
      expect(producerService.orchestrateFolder).not.toHaveBeenCalled();
    });

    it('should record the finished report on the run when the pipeline ends', async () => {
      await controller.startOrchestration({ targetDirectory: './src' }, principal);

      // Let the fire-and-forget .then() chain flush.
      await new Promise(process.nextTick);

      expect(billingService.completeRun).toHaveBeenCalledWith(
        'run-1',
        reporterService.generateReport(),
      );
    });

    it('should return immediately even if orchestrateFolder throws', async () => {
      const dto = { targetDirectory: './mock-code' };
      producerService.orchestrateFolder.mockRejectedValueOnce(
        new Error('Critical failure'),
      );

      // The controller should still return 202 successfully
      const result = await controller.startOrchestration(dto, principal);
      expect(result.status).toBe('PROCESSING');
      expect(result.targetDirectory).toBe('./mock-code');
    });
  });

  describe('GET /api/orchestrator/report', () => {
    it('should return the report from ReporterService', () => {
      const result = controller.getReport();

      expect(result).toBeDefined();
      expect(result.generatedAt).toBe('2026-06-03T00:00:00.000Z');
      expect(result.globalStats).toBeDefined();
      expect(result.globalStats.totalFiles).toBe(1);
      expect(result.files).toHaveLength(1);
    });

    it('should call generateReport exactly once', () => {
      controller.getReport();
      expect(reporterService.generateReport).toHaveBeenCalledTimes(1);
    });

    it('should return global stats with correct structure', () => {
      const result = controller.getReport();

      const { globalStats } = result;
      expect(globalStats).toHaveProperty('totalFiles');
      expect(globalStats).toHaveProperty('filesConverged');
      expect(globalStats).toHaveProperty('filesNotConverged');
      expect(globalStats).toHaveProperty('filesImproved');
      expect(globalStats).toHaveProperty('avgIterations');
      expect(globalStats).toHaveProperty('avgDeltaCyclomaticComplexity');
      expect(globalStats).toHaveProperty('avgDeltaMaintainabilityIndex');
      expect(globalStats).toHaveProperty('avgDeltaDuplicationRate');
    });

    it('should return per-file results with correct structure', () => {
      const result = controller.getReport();
      const file = result.files[0];

      expect(file).toHaveProperty('filePath');
      expect(file).toHaveProperty('initial');
      expect(file).toHaveProperty('final');
      expect(file).toHaveProperty('delta');
      expect(file).toHaveProperty('iterations');
      expect(file).toHaveProperty('converged');
      expect(file).toHaveProperty('improved');

      // Verify nested properties
      expect(file.initial).toHaveProperty('cyclomaticComplexity');
      expect(file.initial).toHaveProperty('maintainabilityIndex');
      expect(file.initial).toHaveProperty('duplicationRate');

      expect(file.delta).toHaveProperty('cyclomaticComplexity');
      expect(file.delta).toHaveProperty('maintainabilityIndex');
      expect(file.delta).toHaveProperty('duplicationRate');
    });
  });

  describe('when local-path analysis is disabled (production)', () => {
    beforeEach(() => {
      mockAppEnvironment.isLocalPathAnalysisEnabled.mockReturnValue(false);
      mockAppEnvironment.isProduction.mockReturnValue(true);
      mockAppEnvironment.current = 'production';
      mockAppEnvironment.assertLocalPathAnalysisAllowed.mockImplementation(() => {
        throw new ForbiddenException(
          'Analysis by local path is disabled in production. Import a public GitHub repository instead.',
        );
      });
    });

    it('refuses the run', async () => {
      await expect(
        controller.startOrchestration({ targetDirectory: '/etc' }, principal),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // The refusal has to come before billing and before the pipeline, not
    // alongside them: a rejected request must leave no charge, no run record
    // and above all no background job already walking the filesystem.
    it('charges nothing and starts no pipeline', async () => {
      await expect(
        controller.startOrchestration({ targetDirectory: '/etc' }, principal),
      ).rejects.toThrow();

      expect(billingService.authorizeRun).not.toHaveBeenCalled();
      expect(producerService.orchestrateFolder).not.toHaveBeenCalled();
    });

    it('still serves the report, which only reads', () => {
      expect(controller.getReport()).toBeDefined();
    });
  });
});
