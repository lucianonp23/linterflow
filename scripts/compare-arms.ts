/**
 * LinterFlow — Comparison of the two experimental arms
 * ====================================================
 *
 *   arm A  corpus-run/       SAST-guided loop, up to 5 iterations
 *   arm B  corpus-baseline/  naive refactoring prompt, one pass
 *
 * Both start from the same 60 files in corpus/, so every comparison is paired
 * on the file. The question is not whether refactoring by LLM helps — arm A
 * already showed that — but whether telling the model WHAT the analyser found
 * and WHERE is what earned the improvement.
 *
 * STRICTLY READ-ONLY over the corpora. It opens corpus/, corpus-run/ and
 * corpus-baseline/ for reading and writes only its own transcript, to a path
 * the caller chooses. Nothing here can overwrite a run: losing either arm means
 * re-spending the API calls that produced it.
 *
 * WHAT IS AND IS NOT MATCHED
 * --------------------------
 * Same corpus, model, prompt assembly, retry policy, response parsing and
 * Evaluator. Arm A iterates and re-measures; arm B cannot, having no
 * measurement to stop on. So the headline pass rates compare a guided pipeline
 * with naive prompting, and the "matched effort" figure — arm A's first-pass
 * convergences against arm B's single pass — is the closer analogue. Both are
 * reported; neither is presented as the other.
 *
 * Usage:
 *   npx ts-node scripts/compare-arms.ts
 *   npx ts-node scripts/compare-arms.ts --out=comparison.txt
 *   npx ts-node scripts/compare-arms.ts --no-save
 */
import * as fs from 'fs';
import * as path from 'path';

const CORPUS_RUN = path.resolve(process.cwd(), 'corpus-run');
const BASELINE = path.resolve(process.cwd(), 'corpus-baseline');

const MAX_CC = 10;
const MIN_MI = 65;
const MAX_DR = 3;

interface Snapshot {
  cyclomaticComplexity: number;
  cyclomaticViolations: number;
  totalCyclomaticComplexity: number;
  functionCount: number;
  maintainabilityIndex: number;
  duplicationRate: number;
}

interface Paired {
  file: string;
  initial: Snapshot;
  guided: Snapshot | null;
  naive: Snapshot | null;
  guidedIterations: number;
  guidedConverged: boolean;
  naivePasses: boolean;
}

function passesGate(s: Snapshot): boolean {
  return (
    s.cyclomaticViolations === 0 &&
    s.maintainabilityIndex >= MIN_MI &&
    s.duplicationRate <= MAX_DR
  );
}

/** Newest Reporter export in a directory. */
function newestReport(dir: string): string {
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('linterflow-report-') && f.endsWith('.json'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!candidates.length) {
    throw new Error(`No linterflow-report-*.json in ${dir}.`);
  }
  return candidates[0];
}

function load(): Paired[] {
  const guidedReport = JSON.parse(fs.readFileSync(newestReport(CORPUS_RUN), 'utf-8'));
  const baseline = JSON.parse(
    fs.readFileSync(path.join(BASELINE, 'baseline-report.json'), 'utf-8'),
  );

  const guidedByFile = new Map<string, any>();
  for (const record of guidedReport.files) {
    guidedByFile.set(path.basename(record.filePath), record);
  }

  const rows: Paired[] = [];
  for (const entry of baseline.files) {
    const guided = guidedByFile.get(entry.file);
    if (!guided) continue; // present in one arm only — cannot be paired
    rows.push({
      file: entry.file,
      initial: entry.initial,
      guided: guided.final ?? null,
      naive: entry.error === null ? entry.final : null,
      guidedIterations: guided.iterations ?? 0,
      guidedConverged: !!guided.converged,
      naivePasses: !!entry.passesGate,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Statistics — Wilcoxon signed-rank and Cliff's delta, matching stats_analysis.py
// ---------------------------------------------------------------------------

/** Two-sided Wilcoxon signed-rank, normal approximation with tie correction.
 *  The exact test is impractical here and n is comfortably large enough for
 *  the approximation; stats_analysis.py uses scipy's, so small p-value
 *  disagreements at the third decimal are expected and immaterial. */
function wilcoxon(a: number[], b: number[]): { W: number; p: number; n: number } {
  const diffs = a.map((x, i) => b[i] - x).filter((d) => d !== 0);
  const n = diffs.length;
  if (n === 0) return { W: 0, p: 1, n: 0 };

  const byAbs = diffs
    .map((d, i) => ({ d, abs: Math.abs(d), i }))
    .sort((x, y) => x.abs - y.abs);

  // Average ranks across ties.
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && byAbs[j + 1].abs === byAbs[i].abs) j++;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = avg;
    i = j + 1;
  }

  let wPlus = 0;
  let wMinus = 0;
  byAbs.forEach((entry, idx) => {
    if (entry.d > 0) wPlus += ranks[idx];
    else wMinus += ranks[idx];
  });

  const W = Math.min(wPlus, wMinus);
  const mean = (n * (n + 1)) / 4;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  const z = sd === 0 ? 0 : (W - mean) / sd;
  // Two-sided normal tail via erf.
  const p = Math.max(0, Math.min(1, erfc(Math.abs(z) / Math.SQRT2)));
  return { W, p, n };
}

/** Abramowitz & Stegun 7.1.26 — adequate for reporting to 5 decimals. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

function cliffsDelta(a: number[], b: number[]): { delta: number; magnitude: string } {
  let greater = 0;
  let less = 0;
  for (const x of b) {
    for (const y of a) {
      if (x > y) greater++;
      else if (x < y) less++;
    }
  }
  const delta = (greater - less) / (a.length * b.length);
  const abs = Math.abs(delta);
  const magnitude =
    abs < 0.147 ? 'negligible' : abs < 0.33 ? 'small' : abs < 0.474 ? 'medium' : 'large';
  return { delta, magnitude };
}

// ---------------------------------------------------------------------------

/**
 * `decisionPoints` is derived, not measured: totalCC - functionCount.
 *
 * It has to be here or the total-CC row misleads. McCabe gives every function a
 * floor of 1, so an arm that decomposes aggressively pays +1 per extracted
 * function and its total rises even when it removed branching. The guided arm
 * does exactly that (see 10-resultados §3); the naive arm decomposes less, so
 * its total stays flatter and it "wins" a row it did not earn. Subtracting the
 * function count cancels the floor and compares the branching itself.
 */
function decisionPoints(s: Snapshot): number {
  return s.totalCyclomaticComplexity - s.functionCount;
}

type MetricKey = keyof Snapshot | 'decisionPoints';

function valueOf(s: Snapshot, key: MetricKey): number {
  return key === 'decisionPoints' ? decisionPoints(s) : (s[key] as number);
}

const METRICS: [MetricKey, string, 'decrease' | 'increase'][] = [
  ['cyclomaticViolations', 'CC violations (lower is better)', 'decrease'],
  ['cyclomaticComplexity', 'Max CC per function (lower is better)', 'decrease'],
  ['totalCyclomaticComplexity', 'Total CC (lower is better — read with the next row)', 'decrease'],
  ['decisionPoints', 'Decision points = total CC - functions (lower is better)', 'decrease'],
  ['functionCount', 'Function count (context for the two rows above)', 'decrease'],
  ['maintainabilityIndex', 'Maintainability Index (higher is better)', 'increase'],
  ['duplicationRate', 'Duplication rate % (lower is better)', 'decrease'],
];

function main(): void {
  const args = process.argv.slice(2);
  const save = !args.includes('--no-save');
  const outArg = args.find((a) => a.startsWith('--out='));

  const rows = load();
  const usable = rows.filter((r) => r.guided && r.naive);
  const breached = usable.filter((r) => !passesGate(r.initial));
  const healthy = usable.filter((r) => passesGate(r.initial));

  const lines: string[] = [];
  const say = (text = '') => {
    lines.push(text);
    console.log(text);
  };

  say('='.repeat(72));
  say('LinterFlow — guided arm vs naive control arm');
  say('='.repeat(72));
  say(`  paired files            ${usable.length}`);
  say(`  breached the gate       ${breached.length}`);
  say(`  already passed the gate ${healthy.length}`);

  // --- 1. The headline: who ends up passing the gate ---
  say();
  say('-'.repeat(72));
  say('1. FILES THAT BREACHED THE GATE — did the arm fix them?');
  say('-'.repeat(72));
  const guidedFixed = breached.filter((r) => r.guidedConverged).length;
  const naiveFixed = breached.filter((r) => r.naivePasses).length;
  const guidedFirstPass = breached.filter(
    (r) => r.guidedConverged && r.guidedIterations <= 1,
  ).length;

  say(`  guided (up to 5 iterations)   ${guidedFixed}/${breached.length}  ` +
      `${((100 * guidedFixed) / breached.length).toFixed(0)}%`);
  say(`  naive  (one pass)             ${naiveFixed}/${breached.length}  ` +
      `${((100 * naiveFixed) / breached.length).toFixed(0)}%`);
  say();
  say(`  MATCHED EFFORT — one pass each:`);
  say(`    guided converged on pass 1  ${guidedFirstPass}/${breached.length}  ` +
      `${((100 * guidedFirstPass) / breached.length).toFixed(0)}%`);
  say(`    naive  single pass          ${naiveFixed}/${breached.length}  ` +
      `${((100 * naiveFixed) / breached.length).toFixed(0)}%`);
  say();
  say('  The guided arm iterates and the naive arm cannot, having nothing to');
  say('  stop on. The matched-effort row is the closer analogue; the row above');
  say('  it compares the pipeline as built with prompting as practised.');

  // --- 2. Did the naive arm damage healthy files? ---
  say();
  say('-'.repeat(72));
  say('2. FILES THAT ALREADY PASSED — did refactoring them anyway cost anything?');
  say('-'.repeat(72));
  const stillPass = healthy.filter((r) => r.naivePasses).length;
  say(`  the guided arm did not touch these at all (${healthy.length} API calls saved)`);
  say(`  the naive arm refactored all ${healthy.length}; still passing: ${stillPass}/${healthy.length}`);
  if (stillPass === healthy.length) {
    say();
    say('  None were broken. The gate\'s value here is the calls it avoids, not');
    say('  damage it prevents — report it that way.');
  }

  // --- 3. Paired tests on the 27, guided delta vs naive delta ---
  say();
  say('-'.repeat(72));
  say('3. PAIRED COMPARISON ON THE BREACHED FILES (guided Δ vs naive Δ)');
  say('-'.repeat(72));
  say('  Same file, two treatments. Negative Δ-of-Δ favours the guided arm on');
  say('  "lower is better" metrics, positive favours it on the MI row.');

  for (const [key, label, direction] of METRICS) {
    const guidedDelta = breached.map(
      (r) => valueOf(r.guided as Snapshot, key) - valueOf(r.initial, key),
    );
    const naiveDelta = breached.map(
      (r) => valueOf(r.naive as Snapshot, key) - valueOf(r.initial, key),
    );

    const mg = guidedDelta.reduce((s, v) => s + v, 0) / guidedDelta.length;
    const mn = naiveDelta.reduce((s, v) => s + v, 0) / naiveDelta.length;

    say();
    say(`  === ${label} ===`);
    say(`    mean Δ guided ${mg >= 0 ? '+' : ''}${mg.toFixed(3)}`);
    say(`    mean Δ naive  ${mn >= 0 ? '+' : ''}${mn.toFixed(3)}`);

    const { W, p, n } = wilcoxon(guidedDelta, naiveDelta);
    if (n === 0) {
      say('    Wilcoxon: skipped (every pair identical).');
      continue;
    }
    const { delta, magnitude } = cliffsDelta(guidedDelta, naiveDelta);
    const significant = p < 0.05;
    const guidedBetter = direction === 'decrease' ? mg < mn : mg > mn;
    say(`    Wilcoxon W = ${W.toFixed(1)}  n(non-zero) = ${n}`);
    say(`    p = ${p.toFixed(5)}  (${significant ? 'SIGNIFICANT' : 'not significant'} at 0.05)`);
    say(`    Cliff's d = ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} (${magnitude})`);
    say(
      `    => ${significant ? (guidedBetter ? 'guided arm better' : 'naive arm better') : 'no significant difference'}`,
    );
  }

  say();
  say('='.repeat(72));
  say('Done.');

  if (save) {
    const outPath = outArg
      ? path.resolve(process.cwd(), outArg.slice('--out='.length))
      : path.join(BASELINE, 'arm-comparison.txt');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
    console.log(`\nSaved to: ${outPath}`);
  }
}

main();
