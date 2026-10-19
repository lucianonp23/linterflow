import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GithubService } from './github.service';
import { ImportRepoDto } from './dto/import-repo.dto';

describe('GithubService', () => {
  let service: GithubService;
  let tempRoot: string;
  const importId = 'e4c8f6a2-1234-4b5c-9d0e-abcdef012345';

  beforeEach(() => {
    service = new GithubService();
    // Point the service at an isolated fixture sandbox instead of ./temp
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linterflow-gh-'));
    (service as any).tempRoot = tempRoot;

    // Fixture: temp/{uuid}/repo-main/{src/app.service.ts, README.md}
    const repoRoot = path.join(tempRoot, importId, 'repo-main');
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.service.ts'), 'export {};');
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# fixture');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('ImportRepoDto.parseGithubUrl', () => {
    it('extracts owner and repo from a plain URL', () => {
      expect(
        ImportRepoDto.parseGithubUrl('https://github.com/nestjs/nest'),
      ).toEqual({ owner: 'nestjs', repo: 'nest' });
    });

    it('tolerates .git suffix, www and trailing slash', () => {
      expect(
        ImportRepoDto.parseGithubUrl('https://www.github.com/foo/bar.git/'),
      ).toEqual({ owner: 'foo', repo: 'bar' });
    });

    it('rejects non-GitHub and malformed URLs', () => {
      expect(ImportRepoDto.parseGithubUrl('https://gitlab.com/foo/bar')).toBeNull();
      expect(ImportRepoDto.parseGithubUrl('not a url')).toBeNull();
      expect(
        ImportRepoDto.parseGithubUrl('https://github.com/only-owner'),
      ).toBeNull();
    });
  });

  describe('mapDirectory', () => {
    it('maps the tree with the strict node contract, directories first', async () => {
      const nodes = await service.mapDirectory(
        path.join(tempRoot, importId, 'repo-main'),
        'repo-main',
      );

      expect(nodes).toEqual([
        {
          name: 'src',
          type: 'directory',
          path: 'repo-main/src',
          children: [
            {
              name: 'app.service.ts',
              type: 'file',
              path: 'repo-main/src/app.service.ts',
            },
          ],
        },
        { name: 'README.md', type: 'file', path: 'repo-main/README.md' },
      ]);
    });
  });

  describe('resolveSafePath (Path Traversal protection)', () => {
    it('resolves a valid path inside the sandbox', () => {
      const resolved = service.resolveSafePath(importId, 'repo-main/src');
      expect(resolved).toBe(path.join(tempRoot, importId, 'repo-main', 'src'));
    });

    it('rejects ../ escape attempts', () => {
      expect(() =>
        service.resolveSafePath(importId, '../../../etc/passwd'),
      ).toThrow(BadRequestException);
      expect(() =>
        service.resolveSafePath(importId, 'repo-main/../..'),
      ).toThrow(BadRequestException);
    });

    it('rejects absolute paths outside the sandbox', () => {
      expect(() => service.resolveSafePath(importId, '/etc/passwd')).toThrow(
        BadRequestException,
      );
    });

    it('rejects unknown importId and missing paths', () => {
      expect(() =>
        service.resolveSafePath('00000000-0000-4000-8000-000000000000', 'x'),
      ).toThrow(NotFoundException);
      expect(() =>
        service.resolveSafePath(importId, 'repo-main/missing.ts'),
      ).toThrow(NotFoundException);
    });
  });

  describe('resolveAnalysisTarget', () => {
    it('returns the directory with the default pattern for a directory', () => {
      expect(service.resolveAnalysisTarget(importId, 'repo-main/src')).toEqual({
        directory: path.join(tempRoot, importId, 'repo-main', 'src'),
        pattern: '**/*.ts',
      });
    });

    it('narrows the pattern to the basename for a single .ts file', () => {
      expect(
        service.resolveAnalysisTarget(importId, 'repo-main/src/app.service.ts'),
      ).toEqual({
        directory: path.join(tempRoot, importId, 'repo-main', 'src'),
        pattern: 'app.service.ts',
      });
    });

    it('rejects non-TypeScript files', () => {
      expect(() =>
        service.resolveAnalysisTarget(importId, 'repo-main/README.md'),
      ).toThrow(BadRequestException);
    });
  });
});
