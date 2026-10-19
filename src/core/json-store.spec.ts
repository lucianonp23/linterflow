import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJsonSafe, writeJsonAtomic } from './json-store';

describe('json-store', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linterflow-store-'));
    filePath = path.join(tmpDir, 'runs.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('writeJsonAtomic', () => {
    it('writes the value and reads it back', () => {
      writeJsonAtomic(filePath, [{ id: 'run-1' }]);
      expect(readJsonSafe(filePath, [])).toEqual([{ id: 'run-1' }]);
    });

    it('creates the directory when it does not exist yet', () => {
      const nested = path.join(tmpDir, 'data', 'runs.json');
      writeJsonAtomic(nested, { ok: true });
      expect(fs.existsSync(nested)).toBe(true);
    });

    it('leaves no temp file behind on success', () => {
      writeJsonAtomic(filePath, { ok: true });
      const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    it('keeps the previous content when serialisation fails', () => {
      writeJsonAtomic(filePath, [{ id: 'run-1' }]);

      // A circular structure makes JSON.stringify throw, standing in for any
      // failure between truncating and finishing the write.
      const circular: any = {};
      circular.self = circular;
      expect(() => writeJsonAtomic(filePath, circular)).toThrow();

      // The point of the temp-file dance: the original survived intact.
      expect(readJsonSafe(filePath, [])).toEqual([{ id: 'run-1' }]);
      const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });
  });

  describe('readJsonSafe', () => {
    it('returns the fallback when the file does not exist', () => {
      expect(readJsonSafe(filePath, [])).toEqual([]);
    });

    it('quarantines a corrupt file and falls back instead of throwing', () => {
      // A truncated write is exactly what a crash mid-writeFileSync leaves.
      fs.writeFileSync(filePath, '[{"id":"run-1"},{"id":"run', 'utf-8');

      expect(() => readJsonSafe(filePath, [])).not.toThrow();
      expect(readJsonSafe(filePath, ['fallback'])).toEqual(['fallback']);

      const quarantined = fs
        .readdirSync(tmpDir)
        .filter((f) => f.includes('.corrupt-'));
      expect(quarantined).toHaveLength(1);

      // The unreadable bytes are preserved for manual recovery, not discarded.
      const preserved = fs.readFileSync(path.join(tmpDir, quarantined[0]), 'utf-8');
      expect(preserved).toBe('[{"id":"run-1"},{"id":"run');
    });

    it('does not wedge the store: a write after corruption starts clean', () => {
      fs.writeFileSync(filePath, 'not json at all', 'utf-8');
      readJsonSafe(filePath, []);

      writeJsonAtomic(filePath, [{ id: 'run-2' }]);
      expect(readJsonSafe(filePath, [])).toEqual([{ id: 'run-2' }]);
    });
  });
});
