import {
  CreditsService,
  MEDIUM_FILE_MAX_LOC,
  LONG_FILE_MAX_LOC,
} from './credits.service';
import * as fs from 'fs';
import { glob } from 'glob';

jest.mock('fs');
jest.mock('glob', () => ({ glob: jest.fn() }));

describe('CreditsService', () => {
  let service: CreditsService;

  beforeEach(() => {
    service = new CreditsService();
    jest.clearAllMocks();
  });

  describe('countLoc', () => {
    it('should count only non-blank lines', () => {
      const source = 'const a = 1;\n\n  \nconst b = 2;\n';
      expect(service.countLoc(source)).toBe(2);
    });
  });

  describe('categorize / costForLoc', () => {
    it('should price files up to the medium threshold at 1 credit', () => {
      expect(service.categorize(1)).toBe('medium');
      expect(service.categorize(MEDIUM_FILE_MAX_LOC)).toBe('medium');
      expect(service.costForLoc(MEDIUM_FILE_MAX_LOC)).toBe(1);
    });

    it('should price long files (301–600 LOC) at 2 credits', () => {
      expect(service.categorize(MEDIUM_FILE_MAX_LOC + 1)).toBe('long');
      expect(service.categorize(LONG_FILE_MAX_LOC)).toBe('long');
      expect(service.costForLoc(LONG_FILE_MAX_LOC)).toBe(2);
    });

    it('should price very long files (> 600 LOC) at 3 credits', () => {
      expect(service.categorize(LONG_FILE_MAX_LOC + 1)).toBe('very-long');
      expect(service.costForLoc(LONG_FILE_MAX_LOC + 1)).toBe(3);
    });
  });

  describe('estimateRun', () => {
    it('should sum the per-file cost over the resolved file set', async () => {
      const files = ['/target/a.ts', '/target/b.ts'];
      (glob as unknown as jest.Mock).mockResolvedValue(files);

      const mediumSource = Array(100).fill('const x = 1;').join('\n');
      const longSource = Array(450).fill('const x = 1;').join('\n');
      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce(mediumSource)
        .mockReturnValueOnce(longSource);

      const estimate = await service.estimateRun('/target');

      expect(estimate.files).toHaveLength(2);
      expect(estimate.files[0]).toMatchObject({ loc: 100, category: 'medium', cost: 1 });
      expect(estimate.files[1]).toMatchObject({ loc: 450, category: 'long', cost: 2 });
      expect(estimate.totalCost).toBe(3);
    });

    it('should exclude the same files the pipeline ignores', async () => {
      (glob as unknown as jest.Mock).mockResolvedValue([]);

      const estimate = await service.estimateRun('/target', '**/*.ts');

      expect(glob).toHaveBeenCalledWith('**/*.ts', {
        cwd: '/target',
        absolute: true,
        ignore: ['**/node_modules/**', '**/*.d.ts', '**/*.spec.ts', '**/*.bak'],
      });
      expect(estimate.totalCost).toBe(0);
      expect(estimate.files).toHaveLength(0);
    });
  });
});
