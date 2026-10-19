/**
 * LinterFlow — Corpus Builder (materialise + measure)
 * ---------------------------------------------------
 * Phase 1b of the experiment (see docs/07-experimento.md for the numbering):
 * takes the 60 Zero-Shot prompts planned by `generate-corpus.ts` (phase 1a) and
 * turns them into measured, in-band corpus files.
 *
 *   1a  npm run corpus        design: 60 prompts + empty manifest
 *   1b  npm run corpus:build  THIS SCRIPT — generate + measure + regenerate
 *   2   pipeline run          mitigation (Producer + Feedback) over corpus-run/
 *   3   npm run stats         Wilcoxon + Cliff's delta
 *
 * It GENERATES as well as measures. It never mitigates: no FeedbackService, no
 * ProducerService. Applying quality criteria here would refactor the corpus at
 * generation time and destroy the Zero-Shot condition the experiment rests on.
 * Use --measure-only for a measurement pass with no API calls.
 *
 *   prompt → Gemini → corpus/<file>.ts → Evaluator → in band? → manifest.json
 *                          ↑                             │
 *                          └──────── regenerate ─────────┘ (out of band)
 *
 * This is the automated counterpart to the manual workflow documented in
 * `corpus/PROMPTS.md`. The Zero-Shot condition lives in the CONTENT of the
 * prompt — which never mentions quality, metrics or design patterns — not in
 * the channel it travels through, so sending it over the API preserves the
 * experimental condition while making it reproducible.
 *
 * Design notes:
 *  - Metrics come from the SAME EvaluatorService the pipeline uses. Never
 *    reimplement them here: if the two diverge, the manifest's "pre" state and
 *    the Reporter's "pre" state tell different stories.
 *  - TEMPERATURE IS INERT on Gemini 3.6 Flash — the model ignores it. The
 *    regeneration loop relies on the model's own non-determinism instead. See
 *    the constant's comment below.
 *  - Every attempt is counted and written to the manifest. Regenerating until
 *    a file lands in band is a form of selection (documented in PROMPTS.md
 *    step 4); recording the attempt count is what keeps it defensible.
 *  - The manifest is saved after EVERY file, so a crash or a rate-limit wall
 *    never costs more than the file in flight.
 *
 * Usage:
 *   npm run corpus:build                    # generate everything still missing
 *   npm run corpus:build -- --only=high     # only files whose name matches
 *   npm run corpus:build -- --force         # regenerate even files already in band
 *   npm run corpus:build -- --measure-only  # no API calls; just re-measure what exists
 *   npm run corpus:build -- --max-attempts=8
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { EvaluatorService } from '../src/evaluator/evaluator.service';
import { FileMetrics } from '../src/core/types';
import { withRetry } from '../src/core/retry';

require('dotenv').config();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Intended Cyclomatic Complexity band per tier (McCabe).
 * DUPLICATED from scripts/generate-corpus.ts — keep the two in sync.
 *
 * The band is checked against the file's MAXIMUM CC per function, the same
 * value EvaluatorService gates on. It used to be checked against the module
 * aggregate (the sum over the whole file), which made every band unreachable:
 * a trivial bookmarks CRUD controller summed to 33 against a `low` target of 5,
 * so all 60 files would have stalled at max attempts.
 */
const TIER_BAND: Record<string, { min: number; max: number; label: string }> = {
  low: { min: 1, max: 5, label: 'max CC <= 5' },
  medium: { min: 6, max: 10, label: '5 < max CC <= 10' },
  high: { min: 11, max: Infinity, label: 'max CC > 10' },
};

/**
 * Nominal only — the model ignores it.
 *
 * This used to read "must be > 0 or regeneration returns the same file
 * forever", which is false for Gemini 3.6 Flash: from that model onwards
 * `temperature`, `top_p` and `top_k` are accepted and silently discarded, and
 * future models will reject them with HTTP 400. Measured, not assumed — the
 * same prompt at temperature 0 returns different answers on consecutive calls.
 *
 * The regeneration loop works anyway, but for a different reason than the
 * comment claimed: the model is non-deterministic on its own. The spread seen
 * while materialising the corpus (one file measured 17, 15, 15, 11, 14 across
 * five attempts at the same prompt) is that inherent sampling, not this value.
 *
 * Kept only so --measure-only runs and the manifest keep reporting what was
 * requested. Nothing here can steer the output.
 */
const TEMPERATURE = 0.9;

/** Some domains simply will not yield CC > 10. Cap the attempts and report them. */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Pause between API calls, to stay under the free-tier rate limit. */
const THROTTLE_MS = 2_000;

/** Exponential backoff for 429 / 5xx. */
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 4_000;

interface ManifestEntry {
  file: string;
  componentType: string;
  tier: string;
  index: number;
  intendedBand: string;
  domain: string;
  prompt: string;
  /** Max CC per function — the value the tier band is checked against. */
  measuredCC: number | null;
  measuredMI: number | null;
  measuredDR: number | null;
  /** Functions above the CC threshold, and the sum/count behind measuredCC. */
  measuredViolations?: number | null;
  measuredTotalCC?: number | null;
  measuredFunctions?: number | null;
  inBand: boolean | null;
  generatedWith: string | null;
  /** How many generations it took to land in band. Added by this script. */
  attempts?: number | null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  only: string | null;
  force: boolean;
  measureOnly: boolean;
  maxAttempts: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    only: null,
    force: false,
    measureOnly: false,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
  };

  for (const arg of argv) {
    if (arg === '--force') opts.force = true;
    else if (arg === '--measure-only') opts.measureOnly = true;
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length);
    else if (arg.startsWith('--max-attempts=')) {
      const n = Number(arg.slice('--max-attempts='.length));
      if (Number.isFinite(n) && n > 0) opts.maxAttempts = n;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Strips Markdown fences from the model's answer. Mirrors the extraction in
 * ProducerService.executeGeminiRefactor — Gemini adds fences regardless of the
 * "return only raw source" instruction.
 */
function stripFences(responseText: string): string {
  const codeBlockRegex = /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/;
  const match = responseText.match(codeBlockRegex);
  if (match && match[1]) return match[1].trim();
  return responseText
    .replace(/```typescript/g, '')
    .replace(/```/g, '')
    .trim();
}

async function generateCode(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
): Promise<string> {
  // Shares the retry policy with the pipeline (src/core/retry.ts) so a rate
  // limit behaves the same whether it hits corpus generation or mitigation.
  return withRetry(
    async () => {
      const result = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { temperature: TEMPERATURE },
      });
      const code = stripFences(result.text || '');
      if (!code) throw new Error('Model returned an empty response.');
      return code;
    },
    {
      maxRetries: MAX_RETRIES,
      baseDelayMs: BASE_BACKOFF_MS,
      onRetry: (attempt, delayMs, error) =>
        console.log(
          `      ⏳ ${error.message?.slice(0, 80)} — retry ${attempt}/${MAX_RETRIES} in ${delayMs / 1000}s`,
        ),
    },
  );
}

// ---------------------------------------------------------------------------
// Measurement — delegates to the SAME Evaluator the pipeline uses
// ---------------------------------------------------------------------------

interface Measurement {
  metrics: FileMetrics;
  duplicationRate: number;
}

async function measure(
  evaluator: EvaluatorService,
  filePath: string,
  sourceCode: string,
): Promise<Measurement> {
  evaluator.generateAST(sourceCode); // throws if the model produced invalid TS
  const metrics = evaluator.analyzeMetrics(sourceCode);
  const duplications = await evaluator.detectDuplications(filePath);
  const duplicationRate = evaluator.calculateDuplicationRate(
    duplications,
    sourceCode,
  );
  return { metrics, duplicationRate };
}

function isInBand(tier: string, cc: number): boolean {
  const band = TIER_BAND[tier];
  if (!band) return false;
  return cc >= band.min && cc <= band.max;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const corpusDir = path.resolve(process.cwd(), 'corpus');
  const manifestPath = path.join(corpusDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(
      `❌ No manifest at ${manifestPath}. Run "npm run corpus" first.`,
    );
    process.exit(1);
  }

  const manifest: ManifestEntry[] = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8'),
  );
  const evaluator = new EvaluatorService();

  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  let ai: GoogleGenAI | null = null;

  if (!opts.measureOnly) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ Missing GEMINI_API_KEY. Check your .env file.');
      process.exit(1);
    }
    ai = new GoogleGenAI({ apiKey });
  }

  const targets = manifest.filter(
    (e) => !opts.only || e.file.includes(opts.only),
  );

  console.log(`\n📦 LinterFlow corpus builder`);
  console.log(
    `   model:        ${opts.measureOnly ? '(measure-only, no API calls)' : model}`,
  );
  console.log(`   temperature:  ${TEMPERATURE}`);
  console.log(`   max attempts: ${opts.maxAttempts}`);
  console.log(`   targets:      ${targets.length}/${manifest.length}\n`);

  const stalled: ManifestEntry[] = [];
  let generated = 0;
  let skipped = 0;

  for (const entry of targets) {
    const filePath = path.join(corpusDir, entry.file);
    const exists = fs.existsSync(filePath);

    // Resume: a file already in band is left alone unless --force.
    if (exists && entry.inBand === true && !opts.force) {
      skipped++;
      continue;
    }

    const band = TIER_BAND[entry.tier];
    console.log(
      `▶ ${entry.file}  (${entry.tier}, target ${band?.label ?? '?'})`,
    );

    let attempts = 0;
    let landed = false;

    while (attempts < opts.maxAttempts && !landed) {
      attempts++;

      try {
        // --measure-only never calls the API; it re-measures what is on disk.
        if (!opts.measureOnly) {
          const code = await generateCode(ai!, model, entry.prompt);
          fs.writeFileSync(filePath, code + '\n', 'utf-8');
          await sleep(THROTTLE_MS);
        } else if (!exists) {
          console.log(`   ⏭  no file on disk, nothing to measure`);
          break;
        }

        const sourceCode = fs.readFileSync(filePath, 'utf-8');
        const { metrics, duplicationRate } = await measure(
          evaluator,
          filePath,
          sourceCode,
        );
        const cc = metrics.cyclomaticComplexity;
        landed = isInBand(entry.tier, cc);

        entry.measuredCC = cc;
        entry.measuredMI = metrics.maintainabilityIndex;
        entry.measuredDR = duplicationRate;
        entry.measuredViolations = metrics.cyclomaticViolations;
        entry.measuredTotalCC = metrics.totalCyclomaticComplexity;
        entry.measuredFunctions = metrics.functionCount;
        entry.inBand = landed;
        entry.attempts = attempts;
        if (!opts.measureOnly) entry.generatedWith = model;

        console.log(
          `   ${landed ? '✅' : '↻ '} attempt ${attempts}: maxCC=${cc}  viol=${metrics.cyclomaticViolations}  totalCC=${metrics.totalCyclomaticComplexity}  fns=${metrics.functionCount}  MI=${metrics.maintainabilityIndex.toFixed(1)}  DR=${duplicationRate.toFixed(2)}%`,
        );

        // In measure-only mode there is nothing to regenerate.
        if (opts.measureOnly) break;
      } catch (error: any) {
        // A syntactically invalid generation is a failed attempt, not a crash.
        console.log(`   ⚠️  attempt ${attempts} failed: ${error.message}`);
        entry.attempts = attempts;
        if (opts.measureOnly) break;
      }
    }

    if (landed) generated++;
    else if (!opts.measureOnly) {
      stalled.push(entry);
      console.log(
        `   ❌ gave up after ${attempts} attempts — still out of band`,
      );
    }

    // Crash-safe: persist after every file, never only at the end.
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  const inBandTotal = manifest.filter((e) => e.inBand === true).length;
  const withAttempts = manifest.filter((e) => typeof e.attempts === 'number');
  const avgAttempts = withAttempts.length
    ? withAttempts.reduce((s, e) => s + (e.attempts ?? 0), 0) /
      withAttempts.length
    : 0;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(
    `📊 Corpus status: ${inBandTotal}/${manifest.length} files in band`,
  );
  console.log(
    `   generated this run: ${generated}   skipped (already in band): ${skipped}`,
  );
  if (withAttempts.length) {
    console.log(
      `   average attempts to land in band: ${avgAttempts.toFixed(2)}`,
    );
  }

  if (stalled.length) {
    console.log(`\n⚠️  ${stalled.length} file(s) never landed in band:`);
    for (const e of stalled) {
      console.log(
        `   · ${e.file}  — measured CC=${e.measuredCC}, wanted ${e.intendedBand}`,
      );
    }
    console.log(
      `\n   These domains resist the intended complexity. Either enrich the domain in\n` +
        `   generate-corpus.ts and re-run "npm run corpus", or accept them and document\n` +
        `   the deviation in the dissertation's threats to validity.`,
    );
  }

  if (inBandTotal === manifest.length) {
    console.log(
      `\n✨ Corpus complete. Next: commit it, then run the pipeline over a COPY`,
    );
    console.log(
      `   (cp -r corpus/ corpus-run/) — the Producer overwrites what it refactors.`,
    );
  }

  console.log(`\n📄 Manifest: ${manifestPath}\n`);
}

main().catch((error) => {
  console.error(`\n❌ Fatal: ${error.message}`);
  process.exit(1);
});
