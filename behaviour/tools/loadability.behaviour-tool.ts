/**
 * Loadability probe: does each treated file even import, before and after treatment?
 * A module that throws at import time has no callable behaviour to compare.
 * Run through Jest so the transpilation is the same one the suite uses:
 *   npx jest --config behaviour/jest.config.js --testRegex 'behaviour/tools/.*behaviour-tool\.ts$'
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const arms = ['corpus', 'corpus-run'];

test('loadability of every file changed by the guided loop', () => {
  const names = fs
    .readdirSync(path.join(ROOT, 'corpus'))
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !fs.readFileSync(path.join(ROOT, 'corpus', f)).equals(fs.readFileSync(path.join(ROOT, 'corpus-run', f))))
    .map((f) => f.replace(/\.ts$/, ''));
  const rows = names.map((name) => {
    const row: Record<string, unknown> = { subject: name };
    for (const arm of arms) {
      try {
        jest.isolateModules(() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const m = require(path.join(ROOT, arm, `${name}.ts`));
          row[`${arm}:exports`] = Object.keys(m).sort();
        });
        row[arm] = 'loads';
      } catch (e: any) {
        row[arm] = `throws ${e?.constructor?.name}: ${String(e?.message).split('\n')[0].slice(0, 160)}`;
      }
    }
    row.sameExports = JSON.stringify(row['corpus:exports']) === JSON.stringify(row['corpus-run:exports']);
    return row;
  });
  fs.mkdirSync(path.join(ROOT, 'behaviour', 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'behaviour', 'results', 'loadability.json'), `${JSON.stringify(rows, null, 1)}\n`);
  expect(rows.length).toBe(27);
});
