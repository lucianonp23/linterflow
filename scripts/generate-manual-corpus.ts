/**
 * LinterFlow — Mini social network (lay-user via)
 * ===============================================
 *
 * Designs the SECOND corpus of the dissertation: one application produced the
 * way a non-expert actually produces one — by asking an agent for a complete
 * app in a single plain request, with no specification.
 *
 *   scripts/generate-corpus.ts         -> 60 single files, 5x3x4 factorial
 *   scripts/generate-manual-corpus.ts  -> THIS SCRIPT: 1 app, 1 lay request
 *
 * Calls no API. Writes the request, the protocol and — after the app exists —
 * an inventory of whatever the agent actually built.
 *
 * WHY THE REQUEST IS VAGUE ON PURPOSE
 * -----------------------------------
 * The dissertation is about LLM-generated code in web application development.
 * The person who generates that code is usually NOT writing a specification:
 * they describe an app in a sentence and accept what comes back. A prompt set
 * with ten numbered rules per file measures something else — a developer who
 * already knows what they want. This corpus deliberately models the other case.
 *
 * WHAT THIS COSTS, AND WHY IT IS ACCEPTABLE
 * -----------------------------------------
 * The file set becomes an OUTCOME rather than a design variable. There is no
 * 5x4 grid to fill, no per-cell balance, and a second run of the same request
 * would produce a different application. So this corpus can never join the 60
 * files in a statistical test — it is a case study, n = 1, reported
 * descriptively. That was already true (see PLANO-FINALIZACAO "não misturar");
 * the vague request only makes the reason plainer.
 *
 * In exchange it buys the two things the 60 files cannot give: external
 * validity, and duplication with somewhere to live. Measure duplication with
 * `npm run dup`, NOT with the per-file rate — the pipeline compares a file only
 * against itself and cannot see clones between modules.
 *
 * THE ONE CONSTRAINT THAT IS NOT LAY
 * ----------------------------------
 * The request names TypeScript and NestJS. A true lay user would not, but the
 * Evaluator parses TypeScript and the corpus it is compared against is NestJS —
 * an app in another stack cannot be measured at all. This is a stated
 * constraint of the instrument, not an oversight, and it is the only piece of
 * technical direction the request carries.
 *
 * ZERO-SHOT
 * ---------
 * Same condition as the other corpus: the request may not mention quality,
 * metrics, complexity, maintainability, patterns, duplication or reuse.
 * assertZeroShot() checks this before anything is written.
 *
 * Usage:
 *   npm run corpus:manual                 # write the request + protocol
 *   npm run corpus:manual -- --inventory  # after generating: record what exists
 *   npm run corpus:manual -- --force      # overwrite an inventory that has measurements
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * The request, as a non-expert would type it.
 *
 * Deliberately: no file list, no layering, no rule count, no mention of DTOs,
 * repositories or validation. "Complete" and "working" are the only quality
 * words a lay user reaches for, and neither names a property under measurement.
 */
const REQUEST = [
  'Build me a complete social network app.',
  '',
  'People should be able to create an account, publish short posts, follow each other, and comment on posts. Everyone gets a timeline with the posts from the people they follow.',
  '',
  'Make it a working backend API in TypeScript using NestJS.',
].join('\n');

/**
 * What to reply when the agent asks a clarifying question — and agents almost
 * always do ("which database?", "do you want authentication?").
 *
 * A lay user defers. Fixing the answer in advance is what makes the protocol
 * reproducible: without it, every clarification becomes an undocumented
 * specification decision that quietly turns this back into the specified case.
 */
const CLARIFICATION_POLICY =
  "You decide, whatever you think is best. I don't know the technical details.";

const FORBIDDEN = [
  'complexity',
  'cyclomatic',
  'maintainability',
  'maintainable',
  'metric',
  'quality',
  'clean code',
  'refactor',
  'duplicat',
  'dry principle',
  'reusable',
  'reuse',
  'shared utility',
  'design pattern',
  'solid principle',
  'best practice',
  'readable',
  'readability',
  'well-structured',
  'modular',
];

function assertZeroShot(text: string, label: string): void {
  const lower = text.toLowerCase();
  const hits = FORBIDDEN.filter((term) => lower.includes(term));
  if (hits.length) {
    throw new Error(
      `Zero-Shot violation in "${label}": text mentions ${hits.join(', ')}.\n` +
        `The request may never name the property the experiment measures.`,
    );
  }
}

interface InventoryEntry {
  file: string;
  lines: number;
  measuredCC: number | null;
  measuredMI: number | null;
  measuredViolations: number | null;
  measuredTotalCC: number | null;
  measuredFunctions: number | null;
}

interface Inventory {
  request: string;
  clarificationPolicy: string;
  /** Filled in by hand — the agent and model that produced the app. */
  generatedWith: string | null;
  generatedAt: string | null;
  /** Anything the operator had to decide that the protocol did not cover. */
  notes: string[];
  fileCount: number;
  totalLines: number;
  files: InventoryEntry[];
}

const OUT_DIR = path.resolve(process.cwd(), 'manual-corpus');
const INVENTORY_PATH = path.join(OUT_DIR, 'inventory.json');

/**
 * Records what the agent actually built. Run AFTER the app is in place.
 *
 * This is the counterpart of the other corpus's manifest, with the direction
 * reversed: there the manifest is a plan the generation must satisfy, here it
 * is a description of an outcome nobody planned.
 */
function runInventory(force: boolean): void {
  if (!fs.existsSync(OUT_DIR)) {
    throw new Error(
      `No ${OUT_DIR} to inventory. Generate the app and copy it there first.`,
    );
  }

  if (fs.existsSync(INVENTORY_PATH) && !force) {
    const existing: Inventory = JSON.parse(
      fs.readFileSync(INVENTORY_PATH, 'utf-8'),
    );
    const measured = existing.files.filter((f) => f.measuredCC !== null).length;
    if (measured > 0) {
      console.error(
        `\n❌ ${INVENTORY_PATH} already holds ${measured} measured file(s).\n` +
          `   Re-running the inventory would reset them to null.\n` +
          `   Pass --force if you really mean to discard the measurements.\n`,
      );
      process.exit(1);
    }
  }

  const files: InventoryEntry[] = [];
  let totalLines = 0;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'prompts') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.spec.ts')) continue;

      const lines = fs.readFileSync(full, 'utf-8').split('\n').length;
      totalLines += lines;
      files.push({
        file: path.relative(OUT_DIR, full),
        lines,
        measuredCC: null,
        measuredMI: null,
        measuredViolations: null,
        measuredTotalCC: null,
        measuredFunctions: null,
      });
    }
  };
  walk(OUT_DIR);

  if (files.length === 0) {
    throw new Error(
      `No .ts files under ${OUT_DIR}. Copy the generated app there first.`,
    );
  }

  files.sort((a, b) => a.file.localeCompare(b.file));

  // Preserve anything already recorded by hand rather than blanking it.
  let generatedWith: string | null = null;
  let generatedAt: string | null = null;
  let notes: string[] = [];
  if (fs.existsSync(INVENTORY_PATH)) {
    const prior: Inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf-8'));
    generatedWith = prior.generatedWith ?? null;
    generatedAt = prior.generatedAt ?? null;
    notes = prior.notes ?? [];
  }

  const inventory: Inventory = {
    request: REQUEST,
    clarificationPolicy: CLARIFICATION_POLICY,
    generatedWith,
    generatedAt,
    notes,
    fileCount: files.length,
    totalLines,
    files,
  };

  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2), 'utf-8');

  console.log(`\n✅ Inventory written to ${INVENTORY_PATH}`);
  console.log(`   ${files.length} TypeScript file(s), ${totalLines} lines`);
  if (!generatedWith) {
    console.log(
      `\n⚠️  "generatedWith" is still null. Fill in the agent and model by hand —` +
        `\n   without it the case study cannot say what produced the code.`,
    );
  }
}

function writeProtocol(): void {
  assertZeroShot(REQUEST, 'request');
  assertZeroShot(CLARIFICATION_POLICY, 'clarification policy');

  const promptsDir = path.join(OUT_DIR, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.writeFileSync(path.join(promptsDir, 'request.prompt.txt'), REQUEST, 'utf-8');

  const md = [
    `# Mini social network — the lay-user request`,
    ``,
    `The second corpus of the dissertation. One application, produced the way a`,
    `non-expert produces one: a single plain request, no specification, and`,
    `whatever the agent decides to build.`,
    ``,
    `Counterpart to the 60-file corpus in [\`../corpus/\`](../corpus/PROMPTS.md).`,
    `Generated by \`scripts/generate-manual-corpus.ts\` — do not edit this file directly.`,
    ``,
    `## The request`,
    ``,
    '```text',
    REQUEST,
    '```',
    ``,
    `## Protocol`,
    ``,
    `1. Open a **fresh** agent session, in an **empty folder outside this repository**`,
    `   (a new folder inside it would be compiled by \`tsc\` and break \`npm run build\`).`,
    `2. Paste the request above. Nothing else.`,
    `3. If the agent asks a clarifying question, reply **exactly**:`,
    ``,
    '```text',
    CLARIFICATION_POLICY,
    '```',
    ``,
    `4. Let it build until it says it is done. Do not ask for features it did not`,
    `   include, do not report bugs, and do not ask it to change anything.`,
    `5. Copy the generated \`.ts\` files into \`manual-corpus/\`, unmodified.`,
    `6. Run \`npm run corpus:manual -- --inventory\` to record what was built.`,
    `7. Fill in \`generatedWith\`, \`generatedAt\` and any \`notes\` in \`inventory.json\` by hand.`,
    ``,
    `## Rules that keep the result usable`,
    ``,
    `**Do not let the agent revise files it already wrote.** If it goes back to`,
    `"tidy up" or "improve" earlier files, stop it. That is mitigation applied`,
    `before the treatment, and it destroys the pre-treatment snapshot the whole`,
    `experiment rests on. Building a new file that imports an earlier one is fine;`,
    `rewriting the earlier one is not.`,
    ``,
    `**Do not steer it about repetition.** Telling it to avoid repeating itself`,
    `would erase the duplication this corpus exists to measure; telling it to`,
    `repeat itself would manufacture that duplication. Neither belongs in the ask.`,
    ``,
    `**Save verbatim.** No formatting, no fixing type errors, no removing unused`,
    `imports. Compilation errors are the phenomenon under study, not noise.`,
    ``,
    `**Record deviations.** Anything you had to decide that this protocol does not`,
    `cover goes in \`notes\` in \`inventory.json\`. An undocumented decision is the`,
    `difference between a case study and an anecdote.`,
    ``,
    `## What this corpus can and cannot support`,
    ``,
    `| | Corpus of 60 | This application |`,
    `| --- | --- | --- |`,
    `| Role | Quantitative, inferential | Case study, descriptive |`,
    `| n | 60 paired files | 1 application |`,
    `| Tests | Wilcoxon + Cliff's δ | Descriptive; compared to the aggregate |`,
    `| File set | Designed (5×3×4) | **An outcome** — whatever the agent built |`,
    `| Reproducible | Yes, from the manifest | **No** — a second run builds something else |`,
    ``,
    `The two never enter the same statistical test.`,
    ``,
    `## Measuring`,
    ``,
    `Never point the pipeline at \`manual-corpus/\` — the Producer overwrites what it`,
    `refactors. Copy first:`,
    ``,
    '```bash',
    `cp -r manual-corpus/ manual-run/`,
    '```',
    ``,
    `Then run the pipeline over \`manual-run/\` (the web UI is fine — that is closest`,
    `to how a real user would reach it), and measure duplication at project level,`,
    `because the pipeline compares each file only against itself:`,
    ``,
    '```bash',
    `npm run dup -- --before=manual-corpus --after=manual-run`,
    '```',
    ``,
    `> The pipeline never tries to fix duplication between files — it cannot see it.`,
    `> Any movement in the project rate is a side effect of the CC/MI refactoring,`,
    `> and has to be reported as such.`,
    ``,
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, 'PROMPTS.md'), md, 'utf-8');

  console.log(`\n✅ Request and protocol written to ${OUT_DIR}`);
  console.log(`   Zero-Shot vocabulary check passed`);
  console.log(`\n   Next: follow manual-corpus/PROMPTS.md, then run`);
  console.log(`   npm run corpus:manual -- --inventory`);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--inventory')) {
    runInventory(args.includes('--force'));
    return;
  }
  writeProtocol();
}

main();
