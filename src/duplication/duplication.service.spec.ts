import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DuplicationService } from './duplication.service';

/**
 * These tests write real files and run jscpd over them rather than mocking it.
 *
 * The behaviour under test IS the interaction with jscpd — specifically that a
 * folder scan sees what a single-file scan cannot. A mocked detectClones would
 * assert that the code calls a function, which is precisely the thing that was
 * never in doubt, and would have passed just as happily with the defect this
 * service exists to work around.
 */
describe('DuplicationService', () => {
  let service: DuplicationService;
  let tmpDir: string;

  /** Two services with an identical 15-line body, differing only in class name. */
  const SERVICE_BODY = `
@Injectable()
export class NAME {
  private items: any[] = [];
  async findAll(page: number, limit: number) {
    if (page < 1) { throw new Error('page must be positive'); }
    if (limit < 1 || limit > 100) { throw new Error('limit out of range'); }
    const offset = (page - 1) * limit;
    const slice = this.items.slice(offset, offset + limit);
    return { data: slice, total: this.items.length, page, limit };
  }
  async findOne(id: string) {
    const found = this.items.find((i) => i.id === id);
    if (!found) { throw new Error('not found'); }
    return found;
  }
}
`;

  const write = (name: string, contents: string): void => {
    const full = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf-8');
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DuplicationService],
    }).compile();
    service = module.get<DuplicationService>(DuplicationService);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linterflow-dup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('finds a clone between two files, which a per-file scan cannot', async () => {
    write('users.service.ts', SERVICE_BODY.replace('NAME', 'UsersService'));
    write('posts.service.ts', SERVICE_BODY.replace('NAME', 'PostsService'));

    const result = await service.measureProject(tmpDir);

    expect(result.filesScanned).toBe(2);
    expect(result.clonePairs).toBeGreaterThan(0);
    expect(result.duplicationRate).toBeGreaterThan(50);
    expect(result.topFilePairs[0].files).toEqual(
      expect.arrayContaining(['posts.service.ts', 'users.service.ts']),
    );
  });

  it('attributes duplicated lines to BOTH sides of a clone pair', async () => {
    write('users.service.ts', SERVICE_BODY.replace('NAME', 'UsersService'));
    write('posts.service.ts', SERVICE_BODY.replace('NAME', 'PostsService'));

    const result = await service.measureProject(tmpDir);

    // Counting only side A — what the per-file formula does — would leave one
    // of the two files reporting zero duplicated lines.
    expect(result.worstFiles).toHaveLength(2);
    for (const file of result.worstFiles) {
      expect(file.duplicatedLines).toBeGreaterThan(0);
    }
  });

  it('counts a line once however many clones cover it, so the rate cannot exceed 100', async () => {
    // Four identical copies: every line of every file participates in several
    // overlapping pairs. Summing fragments would run well past 100%.
    for (const name of ['a', 'b', 'c', 'd']) {
      write(`${name}.service.ts`, SERVICE_BODY.replace('NAME', `${name}Service`));
    }

    const result = await service.measureProject(tmpDir);

    expect(result.duplicationRate).toBeLessThanOrEqual(100);
    for (const file of result.worstFiles) {
      expect(file.duplicatedLines).toBeLessThanOrEqual(file.totalLines);
    }
  });

  it('reports no duplication for files that differ', async () => {
    write('alpha.ts', 'export const alpha = () => 1;\n');
    write('beta.ts', 'export class Beta { run(x: number) { return x * 3; } }\n');

    const result = await service.measureProject(tmpDir);

    expect(result.clonePairs).toBe(0);
    expect(result.duplicationRate).toBe(0);
    expect(result.duplicatedLines).toBe(0);
  });

  it('ignores node_modules, .d.ts and .spec.ts, as the pipeline does', async () => {
    write('app.service.ts', SERVICE_BODY.replace('NAME', 'AppService'));
    write(
      'node_modules/dep/index.ts',
      SERVICE_BODY.replace('NAME', 'DependencyService'),
    );
    write('types.d.ts', SERVICE_BODY.replace('NAME', 'TypesService'));
    write('app.spec.ts', SERVICE_BODY.replace('NAME', 'SpecService'));

    const result = await service.measureProject(tmpDir);

    // Only app.service.ts is in scope, so its three excluded twins must not
    // register as the application duplicating itself.
    expect(result.filesScanned).toBe(1);
    expect(result.clonePairs).toBe(0);
  });

  it('rejects a directory that does not exist', async () => {
    await expect(
      service.measureProject(path.join(tmpDir, 'nope')),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a directory with no TypeScript in it', async () => {
    write('readme.md', '# nothing to measure\n');

    await expect(service.measureProject(tmpDir)).rejects.toThrow(/No .ts files/i);
  });

  it('compares two folders and reports the deltas', async () => {
    const before = path.join(tmpDir, 'before');
    const after = path.join(tmpDir, 'after');
    fs.mkdirSync(before);
    fs.mkdirSync(after);

    // "before" repeats itself; "after" has had one copy replaced.
    fs.writeFileSync(
      path.join(before, 'a.ts'),
      SERVICE_BODY.replace('NAME', 'A'),
    );
    fs.writeFileSync(
      path.join(before, 'b.ts'),
      SERVICE_BODY.replace('NAME', 'B'),
    );
    fs.writeFileSync(path.join(after, 'a.ts'), SERVICE_BODY.replace('NAME', 'A'));
    fs.writeFileSync(
      path.join(after, 'b.ts'),
      'export class B { run() { return 42; } }\n',
    );

    const comparison = await service.compare(before, after);

    expect(comparison.before.clonePairs).toBeGreaterThan(0);
    expect(comparison.after.clonePairs).toBe(0);
    expect(comparison.delta.duplicationRate).toBeLessThan(0);
    expect(comparison.delta.clonePairs).toBeLessThan(0);
  });
});
