/**
 * LinterFlow — Project-level duplication measurement (CLI)
 * ========================================================
 *
 * Thin command-line wrapper over `DuplicationService`, which is also what
 * `POST /api/duplication/measure` and the web UI call. The measurement lives in
 * the service so the CLI and the UI can never drift into reporting different
 * numbers for the same folder.
 *
 * WHY IT EXISTS
 * -------------
 * The pipeline measures duplication per file: `analyzeFile()` calls
 * `detectDuplications(filePath)` with a single path, so jscpd only ever compares
 * a file against itself. That is right for the gate — attributing a folder-wide
 * clone to one file would falsify that file's pre/post delta (a bug fixed
 * during development) — but repetition BETWEEN files is invisible to
 * it. Two near-identical services register 0% each.
 *
 * THE RATE IS NOT THE PER-FILE RATE
 * ---------------------------------
 * `EvaluatorService.calculateDuplicationRate()` sums clone fragments and divides
 * by the file's line count, counting only side A and double-counting overlaps.
 * Here both sides are attributed to their own file and each file keeps a SET of
 * duplicated line numbers, so a line in five clones counts once. Do not report
 * the two side by side as the same measurement.
 *
 * Usage:
 *   npm run dup -- <folder>
 *   npm run dup -- --before=manual-corpus --after=manual-corpus-run
 *   npm run dup -- <folder> --out=report.json --top=20
 */
import * as fs from 'fs';
import * as path from 'path';
import { DuplicationService } from '../src/duplication/duplication.service';
import {
  DuplicationComparison,
  ProjectDuplicationResult,
} from '../src/duplication/duplication.types';

function printResult(result: ProjectDuplicationResult, heading: string): void {
  console.log('\n' + '='.repeat(68));
  console.log(heading);
  console.log('='.repeat(68));
  console.log(`  directory        ${result.directory}`);
  console.log(`  files scanned    ${result.filesScanned}`);
  console.log(`  total lines      ${result.totalLines}`);
  console.log(`  clone pairs      ${result.clonePairs}`);
  console.log(
    `  duplicated lines ${result.duplicatedLines}  (unique, both sides attributed)`,
  );
  console.log(`  DUPLICATION RATE ${result.duplicationRate}%`);

  if (result.topFilePairs.length) {
    console.log('\n  Most duplicated file pairs:');
    for (const pair of result.topFilePairs) {
      console.log(
        `    ${pair.lines.toString().padStart(5)} lines  ${pair.clones
          .toString()
          .padStart(3)} clone(s)  ${pair.files[0]} <-> ${pair.files[1]}`,
      );
    }
  }

  if (result.worstFiles.length) {
    console.log('\n  Files with the most duplicated lines:');
    for (const file of result.worstFiles) {
      console.log(
        `    ${file.rate.toFixed(1).padStart(6)}%  ${file.duplicatedLines}/${file.totalLines}  ${file.file}`,
      );
    }
  }
}

function printComparison(comparison: DuplicationComparison): void {
  const { before, after, delta } = comparison;
  console.log('\n' + '='.repeat(68));
  console.log('BEFORE -> AFTER');
  console.log('='.repeat(68));
  const rows: [string, number, number, number][] = [
    ['files scanned', before.filesScanned, after.filesScanned, delta.filesScanned],
    ['total lines', before.totalLines, after.totalLines, delta.totalLines],
    ['clone pairs', before.clonePairs, after.clonePairs, delta.clonePairs],
    [
      'duplicated lines',
      before.duplicatedLines,
      after.duplicatedLines,
      delta.duplicatedLines,
    ],
    [
      'duplication rate %',
      before.duplicationRate,
      after.duplicationRate,
      delta.duplicationRate,
    ],
  ];
  for (const [label, pre, post, d] of rows) {
    const sign = d > 0 ? '+' : '';
    console.log(
      `  ${label.padEnd(20)} ${String(pre).padStart(10)} -> ${String(post).padStart(10)}   ${sign}${d}`,
    );
  }
  console.log(
    '\n  The pipeline does not target duplication BETWEEN files — it cannot see it.\n' +
      '  Movement there is a side effect of the CC/MI refactoring. Clones inside a\n' +
      '  single file are the exception: the per-file gate does see and act on those.',
  );
}

function parseArgs(argv: string[]) {
  let directory: string | null = null;
  let before: string | null = null;
  let after: string | null = null;
  let out: string | null = null;
  let top = 10;

  for (const arg of argv) {
    if (arg.startsWith('--before=')) before = arg.slice('--before='.length);
    else if (arg.startsWith('--after=')) after = arg.slice('--after='.length);
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else if (arg.startsWith('--top=')) top = parseInt(arg.slice('--top='.length), 10);
    else if (!arg.startsWith('-') && directory === null) directory = arg;
  }

  if (!Number.isFinite(top) || top <= 0) top = 10;
  return { directory, before, after, out, top };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.directory && !(opts.before && opts.after)) {
    console.error(
      'Usage:\n' +
        '  npm run dup -- <folder>\n' +
        '  npm run dup -- --before=<folder> --after=<folder>\n' +
        '  npm run dup -- <folder> --out=report.json --top=20',
    );
    process.exit(1);
  }

  const service = new DuplicationService();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let payload: Record<string, unknown>;
  let defaultOut: string;

  if (opts.before && opts.after) {
    const comparison = await service.compare(opts.before, opts.after, opts.top);
    printResult(comparison.before, 'BEFORE');
    printResult(comparison.after, 'AFTER');
    printComparison(comparison);
    payload = { generatedAt: timestamp, mode: 'comparison', ...comparison };
    defaultOut = path.resolve(
      process.cwd(),
      `project-duplication-${timestamp}.json`,
    );
  } else {
    const result = await service.measureProject(
      opts.directory as string,
      opts.top,
    );
    printResult(result, 'PROJECT DUPLICATION');
    payload = { generatedAt: timestamp, mode: 'single', result };
    defaultOut = path.join(
      result.directory,
      `project-duplication-${timestamp}.json`,
    );
  }

  const outPath = opts.out ? path.resolve(process.cwd(), opts.out) : defaultOut;
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`\nSaved to: ${outPath}`);
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
