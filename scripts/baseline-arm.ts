/**
 * LinterFlow — Control arm (naive refactoring prompt)
 * ===================================================
 *
 * The experiment's missing comparison condition. The pre/post design shows that
 * the guided loop improves code; it cannot show that the STATIC ANALYSIS is
 * what earned the improvement, because "detect, target, rewrite, iterate" were
 * only ever applied together. Asking an LLM to refactor is not this
 * dissertation's contribution — targeting it with SAST output is.
 *
 *   corpus/           the same 60 files, untouched
 *   corpus-run/       arm A — SAST-guided loop (already run)
 *   corpus-baseline/  arm B — THIS SCRIPT, naive prompt, one pass
 *
 * WHAT DIFFERS BETWEEN THE ARMS, AND ONLY THIS
 * --------------------------------------------
 * The control keeps the guided prompt's role, file path and all three
 * constraints. It drops exactly one thing: the block listing what the analyser
 * found — the violating functions by name and CC, the MI value, the duplication
 * rate — and softens "resolve these specific issues" to "improve its quality".
 *
 * Dropping the constraints too would change four variables at once. Without
 * constraint 2 the model may delete exports, which lowers CC by deleting code
 * and could make the control look BETTER for an absurd reason; without
 * constraint 3 it returns Markdown and a parsing failure gets counted as a
 * refactoring failure. The control has to be as close to the treatment as
 * possible except for the active ingredient.
 *
 * ONE PASS, AND WHY THAT IS FAIR BUT NOT PERFECT
 * ----------------------------------------------
 * The guided arm iterates up to 5 times, re-measuring each time. The control
 * cannot: with no measurement there is no stopping criterion, and one pass is
 * what a developer actually does. It is roughly fair — 17 of the 27 treated
 * files converged on the first iteration — but it does bundle "no SAST
 * targeting" with "no iteration". The comparison is therefore guided-pipeline
 * versus naive-prompting, not SAST targeting isolated from iteration. Say so
 * when reporting it.
 *
 * EVERYTHING ELSE IS MATCHED
 * --------------------------
 * Same model, same absence of sampling parameters, same prompt assembly, same
 * retry policy, same Markdown stripping, same export-removal rejection, same
 * EvaluatorService. Copied from ProducerService rather than imported because
 * that service is the treatment: it iterates, writes files in place and reports
 * to the Reporter. Reusing it would mean running arm A again with a different
 * prompt, not running a control.
 *
 * Usage:
 *   npm run baseline                      # all 60 files
 *   npm run baseline -- --only=high       # files whose name matches
 *   npm run baseline -- --force           # redo files already done
 *   npm run baseline -- --limit=5         # smoke test before spending 60 calls
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { EvaluatorService } from '../src/evaluator/evaluator.service';
import { FileMetrics } from '../src/core/types';
import { withRetry } from '../src/core/retry';

require('dotenv').config();

const CORPUS_DIR = path.resolve(process.cwd(), 'corpus');
const BASELINE_DIR = path.resolve(process.cwd(), 'corpus-baseline');
const RESULT_PATH = path.join(BASELINE_DIR, 'baseline-report.json');

/**
 * Mirrors ProducerService.executeGeminiRefactor: only `onRetry` is supplied, so
 * maxRetries and the backoff base stay at withRetry's defaults — the same ones
 * arm A ran under. Overriding either here would make the arms differ in how
 * hard they try, not just in what they are told.
 */
const RETRY = {
  onRetry: (attempt: number, delayMs: number, error: Error) =>
    console.warn(
      `\n    ! Gemini call failed (${error.message}). Retry ${attempt} in ${delayMs / 1000}s.`,
    ),
};

/** Pause between calls, to stay under the free-tier rate limit. */
const THROTTLE_MS = 2_000;

/**
 * Consecutive failures after which the run gives up.
 *
 * withRetry already absorbs the transient cases, so a failure reaching here has
 * survived five backed-off attempts. Several in a row means the problem is the
 * account, not the call — exhausted quota, a revoked key — and continuing would
 * spend roughly two minutes per remaining file discovering the same thing.
 * Stopping keeps the progress already saved and leaves the rest resumable.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * The control prompt.
 *
 * Compare with FeedbackService.generateRefactoringPrompt: identical but for the
 * missing "The static analysis engine has identified..." block and the softened
 * task line. Nothing here names a metric, a threshold or a function.
 */
function buildNaivePrompt(filePath: string): string {
  return `
You are an expert Software Architect assisting with an automated refactoring process.
Please review the following file: ${filePath}

Task: Refactor the provided source code to improve its quality.
Constraints:
1. Maintain all original business logic and functional requirements.
2. Preserve the file's public contract exactly — every exported class, function, interface, type and constant must keep its name and remain exported. Deleting or renaming exported code is not a refactoring and will be rejected.
3. Return ONLY the raw refactored source code. Do not include markdown formatting or conversational text.
  `.trim();
}

/** Byte-for-byte the extraction ProducerService performs on a response. */
function extractCode(responseText: string): string {
  const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/;
  const match = responseText.match(codeBlockRegex);
  if (match && match[1]) return match[1].trim();
  return responseText.replace(/```typescript/g, '').replace(/```/g, '').trim();
}

interface BaselineEntry {
  file: string;
  /** Metrics of the original corpus file — the shared "pre" of both arms. */
  initial: FileMetrics & { duplicationRate: number };
  /** Metrics after the single naive pass, or null when the call failed. */
  final: (FileMetrics & { duplicationRate: number }) | null;
  /** Would this output pass the same gate the guided arm had to pass? */
  passesGate: boolean;
  /** Exported symbols the model dropped. Non-empty means the guided pipeline
   *  would have rejected this candidate and rolled it back. */
  missingExports: string[];
  /** True when the model returned the file essentially unchanged. */
  unchanged: boolean;
  error: string | null;
}

const MAX_CC = 10;
const MIN_MI = 65;
const MAX_DR = 3;

function passesGate(m: FileMetrics & { duplicationRate: number }): boolean {
  return (
    m.cyclomaticViolations === 0 &&
    m.maintainabilityIndex >= MIN_MI &&
    m.duplicationRate <= MAX_DR
  );
}

async function measure(
  evaluator: EvaluatorService,
  filePath: string,
  source: string,
): Promise<FileMetrics & { duplicationRate: number }> {
  const metrics = evaluator.analyzeMetrics(source);
  const duplications = await evaluator.detectDuplications(filePath);
  const duplicationRate = evaluator.calculateDuplicationRate(duplications, source);
  return { ...metrics, duplicationRate };
}

function parseArgs(argv: string[]) {
  let only: string | null = null;
  let limit = Infinity;
  let force = false;
  for (const arg of argv) {
    if (arg.startsWith('--only=')) only = arg.slice('--only='.length);
    else if (arg.startsWith('--limit=')) limit = parseInt(arg.slice('--limit='.length), 10);
    else if (arg === '--force') force = true;
  }
  return { only, limit: Number.isFinite(limit) ? limit : Infinity, force };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Check your .env file.');
  }
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const ai = new GoogleGenAI({ apiKey });
  const evaluator = new EvaluatorService();

  if (!fs.existsSync(CORPUS_DIR)) {
    throw new Error(`No corpus at ${CORPUS_DIR}.`);
  }
  fs.mkdirSync(BASELINE_DIR, { recursive: true });

  // Resume rather than restart: a rate-limit wall or a crash should never cost
  // more than the file in flight, and the arm is 60 paid calls.
  let results: BaselineEntry[] = [];
  if (fs.existsSync(RESULT_PATH) && !opts.force) {
    results = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf-8')).files ?? [];
  }
  const done = new Set(results.filter((r) => r.error === null).map((r) => r.file));

  let files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  if (opts.only) files = files.filter((f) => f.includes(opts.only as string));
  const pending = files.filter((f) => opts.force || !done.has(f)).slice(0, opts.limit);

  console.log(`\nControl arm — naive refactoring prompt, single pass`);
  console.log(`  model      ${modelName}`);
  console.log(`  corpus     ${files.length} file(s)`);
  console.log(`  already done ${done.size}, running ${pending.length}\n`);

  let consecutiveFailures = 0;

  for (const [index, file] of pending.entries()) {
    const sourcePath = path.join(CORPUS_DIR, file);
    const outPath = path.join(BASELINE_DIR, file);
    const original = fs.readFileSync(sourcePath, 'utf-8');

    // Printed as one complete line AFTER the work, not as a prefix before it:
    // the EvaluatorService logs through Nest while measuring, which would split
    // a prefix from its verdict and leave 60 unattributable result lines.
    const label = `  [${String(index + 1).padStart(2)}/${pending.length}] ${file.padEnd(28)}`;

    const initial = await measure(evaluator, sourcePath, original);
    const originalExports = evaluator.extractExportedSymbols(original);

    const entry: BaselineEntry = {
      file,
      initial,
      final: null,
      passesGate: false,
      missingExports: [],
      unchanged: false,
      error: null,
    };

    try {
      const fullPrompt = `${buildNaivePrompt(sourcePath)}\n\n### ORIGINAL SOURCE CODE ###\n${original}`;
      const result = await withRetry(
        () => ai.models.generateContent({ model: modelName, contents: fullPrompt }),
        RETRY,
      );
      const refactored = extractCode(result.text || '');

      if (!refactored) {
        throw new Error('Model returned an empty response.');
      }

      fs.writeFileSync(outPath, refactored, 'utf-8');

      const candidateExports = new Set(evaluator.extractExportedSymbols(refactored));
      entry.missingExports = originalExports.filter((s) => !candidateExports.has(s));
      entry.unchanged = refactored.trim() === original.trim();
      entry.final = await measure(evaluator, outPath, refactored);
      entry.passesGate = passesGate(entry.final);

      const verdict = entry.passesGate ? 'PASSES' : 'still fails';
      const dropped = entry.missingExports.length
        ? `, dropped ${entry.missingExports.length} export(s)`
        : '';
      console.log(
        `${label}${verdict.padEnd(11)} viol ${initial.cyclomaticViolations}→${entry.final.cyclomaticViolations}, ` +
          `MI ${initial.maintainabilityIndex.toFixed(1)}→${entry.final.maintainabilityIndex.toFixed(1)}${dropped}`,
      );
      consecutiveFailures = 0;
    } catch (error: any) {
      entry.error = error.message;
      consecutiveFailures += 1;
      // The full message is kept in the report; the console gets the first line
      // only. Gemini returns a multi-line JSON envelope, and sixty of those
      // would bury the run's actual progress.
      const brief = String(error.message).replace(/\s+/g, ' ').slice(0, 120);
      console.log(`${label}FAILED — ${brief}`);
    }

    results = results.filter((r) => r.file !== file).concat(entry);
    // Saved after every file, so a wall costs one call, not sixty.
    fs.writeFileSync(
      RESULT_PATH,
      JSON.stringify({ generatedAt: new Date().toISOString(), model: modelName, files: results }, null, 2),
      'utf-8',
    );

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(
        `\n  ✖ Stopped after ${consecutiveFailures} consecutive failures — the API is not` +
          `\n    answering, so the remaining ${pending.length - index - 1} file(s) would fail the same way.` +
          `\n    Everything completed so far is saved. Re-run the same command to continue.`,
      );
      break;
    }

    if (index < pending.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS));
    }
  }

  const ok = results.filter((r) => r.error === null);
  const gate = ok.filter((r) => r.passesGate).length;
  const dropped = ok.filter((r) => r.missingExports.length > 0).length;
  const unchanged = ok.filter((r) => r.unchanged).length;

  console.log(`\n  ${ok.length} file(s) refactored, ${results.length - ok.length} failed`);
  console.log(`  pass the gate:        ${gate}/${ok.length}`);
  console.log(`  dropped exports:      ${dropped}  (the guided arm rejects and rolls these back)`);
  console.log(`  returned unchanged:   ${unchanged}`);
  console.log(`\n  Saved to ${RESULT_PATH}`);
  console.log(`  Compare with: npx ts-node scripts/compare-arms.ts\n`);
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
