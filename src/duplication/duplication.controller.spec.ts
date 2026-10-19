import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DuplicationController } from './duplication.controller';
import { DuplicationService } from './duplication.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectDuplicationResult } from './duplication.types';

describe('DuplicationController', () => {
  let controller: DuplicationController;
  let service: { measureProject: jest.Mock; compare: jest.Mock };

  const result = (rate: number): ProjectDuplicationResult => ({
    directory: '/tmp/x',
    filesScanned: 2,
    totalLines: 100,
    clonePairs: 1,
    duplicatedLines: rate,
    duplicationRate: rate,
    worstFiles: [],
    topFilePairs: [],
    thresholds: { minLines: 5, minTokens: 50 },
  });

  beforeEach(async () => {
    service = { measureProject: jest.fn(), compare: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DuplicationController],
      providers: [{ provide: DuplicationService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DuplicationController>(DuplicationController);
  });

  it('measures a single folder when compareWith is absent', async () => {
    service.measureProject.mockResolvedValue(result(4.1));

    const response = await controller.measure({ targetDirectory: './app' });

    expect(service.measureProject).toHaveBeenCalledWith('./app', undefined);
    expect(service.compare).not.toHaveBeenCalled();
    expect(response).toEqual({ mode: 'single', result: result(4.1) });
  });

  it('compares when compareWith is present, with the pre-mitigation copy first', async () => {
    service.compare.mockResolvedValue({
      before: result(4.1),
      after: result(1.2),
      delta: {
        filesScanned: 0,
        totalLines: 0,
        clonePairs: 0,
        duplicatedLines: 0,
        duplicationRate: -2.9,
      },
    });

    const response = await controller.measure({
      targetDirectory: './app-run',
      compareWith: './app',
    });

    // Argument order matters: the untouched copy is the "before".
    expect(service.compare).toHaveBeenCalledWith('./app', './app-run', undefined);
    expect(response.mode).toBe('comparison');
  });

  it('passes top through to the service', async () => {
    service.measureProject.mockResolvedValue(result(0));

    await controller.measure({ targetDirectory: './app', top: 25 });

    expect(service.measureProject).toHaveBeenCalledWith('./app', 25);
  });

  it('turns a bad path into a 400 with the reason, not a 500', async () => {
    service.measureProject.mockRejectedValue(
      new Error('Directory not found: ./nope'),
    );

    await expect(
      controller.measure({ targetDirectory: './nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.measure({ targetDirectory: './nope' }),
    ).rejects.toThrow('Directory not found: ./nope');
  });
});
