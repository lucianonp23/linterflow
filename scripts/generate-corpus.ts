/**
 * LinterFlow — Experimental Corpus PROMPT Generator
 * -------------------------------------------------
 * Produces the 60 Zero-Shot generation prompts used in the dissertation experiment.
 *
 *   5 NestJS component types  ×  3 Cyclomatic Complexity tiers  ×  4 files = 60
 *
 * IMPORTANT: This script does NOT call any LLM API — it only plans the experiment
 * (phase 1a). Materialising the prompts into measured corpus files is phase 1b, and
 * there are two ways to do it:
 *
 *   npm run corpus:build   scripts/build-corpus.ts — generates through the Gemini API,
 *                          measures with the EvaluatorService and regenerates anything
 *                          outside its tier band. ~3 h, reproducible.
 *   manually               paste each prompt from PROMPTS.md into an AI agent, save the
 *                          output as corpus/<file>.ts, measure, repeat. ~13 h.
 *
 * Both preserve the Zero-Shot condition: it lives in the CONTENT of the prompt, not in
 * the channel it travels through. See docs/07-experimento.md for the trade-off.
 *
 * The complexity tier is a DESIGN VARIABLE fixed before generation: it is induced
 * primarily through the richness of the business domain the prompt describes, and only
 * VERIFIED afterwards by measurement. No prompt mentions code quality, metrics, clean
 * code, or design patterns — generation stays Zero-Shot with respect to maintainability.
 *
 * Outputs (under ./corpus):
 *   prompts/<type>_<tier>_<index>.prompt.txt   — one prompt per corpus file
 *   PROMPTS.md                                 — all 60 prompts + both phase-1b workflows
 *   manifest.json                              — the plan + slots to record measured metrics
 *
 * Usage:
 *   npm run corpus            # write all prompt files (no network, no API key needed)
 */
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Experimental design
// ---------------------------------------------------------------------------

type ComponentType =
  | 'controller'
  | 'service'
  | 'repository'
  | 'middleware'
  | 'dto';
type Tier = 'low' | 'medium' | 'high';

const COMPONENT_TYPES: ComponentType[] = [
  'controller',
  'service',
  'repository',
  'middleware',
  'dto',
];

const TIERS: Tier[] = ['low', 'medium', 'high'];
const FILES_PER_COMBINATION = 4; // 5 × 3 × 4 = 60

// Intended Cyclomatic Complexity band per tier (McCabe). Used to VERIFY the output
// after measurement; the band is induced through the domain, not requested as a number.
// Measured as the MAXIMUM CC per function, matching the pipeline's gate — see the
// note on TIER_BAND in scripts/build-corpus.ts. Keep the two in sync.
const TIER_BAND: Record<Tier, { min: number; max: number; label: string }> = {
  low: { min: 1, max: 5, label: 'max CC <= 5' },
  medium: { min: 6, max: 10, label: '5 < max CC <= 10' },
  high: { min: 11, max: Infinity, label: 'max CC > 10' },
};

// Tier directive: biases structural complexity WITHOUT mentioning code quality.
// Complexity is realised primarily by how many business rules the component must
// implement, so the instruction asks the model to implement every rule fully.
const TIER_SPEC: Record<Tier, string> = {
  low: 'Scope: a simple domain with very few rules. Implement the operations with mostly straight-line logic and minimal conditional branching.',
  // Recalibrated 2026-08-15. The previous wording ("Implement every rule fully,
  // including the conditional branching and loops they require") was all but the
  // `high` directive with a smaller domain, and measured 11–36 against a 6–10
  // band across three files and thirteen generations. Since a prompt is never
  // edited between attempts, every retry just resamples the same skewed
  // distribution — the fix has to be in the prompt, not in more retries.
  // Rule COUNT is now bounded and the rules are declared independent, because
  // interacting rules are what produce the nesting that drives CC up.
  medium:
    'Scope: a domain with a moderate set of business rules — four to seven independent validity or state checks in its busiest operation, and fewer in the others. Implement each check as a direct conditional; the checks stand alone rather than combining into nested special cases.',
  high: 'Scope: a rule-heavy domain with many interacting business rules, edge cases and special conditions. Implement every rule and edge case fully and explicitly, even where this leads to deeply nested conditionals, multiple loops and switch statements.',
};

const COMPONENT_SPEC: Record<ComponentType, string> = {
  controller:
    'a NestJS REST Controller (use @Controller and HTTP method decorators such as @Get/@Post/@Put/@Delete) that exposes endpoints for the domain below and applies the domain rules inline in the handlers',
  service:
    'a NestJS @Injectable() Service that contains the business logic for the domain below',
  repository:
    'a NestJS data-access Repository class that performs CRUD-style operations for the domain below against an in-memory data store, applying any selection/validation rules in code',
  middleware:
    'a NestJS middleware (implements NestMiddleware) that inspects and processes incoming requests for the domain below',
  dto: 'a set of TypeScript DTO / validator classes (using class-validator decorators) plus any helper validation logic for the domain below',
};

// Concrete business domains, 20 per tier (5 components × 4 files), each distinct so
// that the four files in every component×tier cell never collapse into near-duplicates.
// Domains are scaled to the tier: low = few rules, high = many interacting rules.
const DOMAINS: Record<Tier, string[]> = {
  low: [
    'a personal bookmark manager',
    'a to-do list',
    'a contact address book',
    'a movie watchlist',
    'a reading list tracker',
    'a recipe ingredient list',
    'a daily water-intake log',
    'a habit check-off tracker',
    'a podcast subscription list',
    'a product wishlist',
    'a plant-watering reminder list',
    'a gift-idea list',
    'a favourite-quotes collection',
    'a simple note tagging store',
    'a book-lending tracker',
    'a link-shortener registry',
    'an FAQ entry store',
    'a unit-of-measure catalogue',
    'a saved-search registry',
    'a sticker/emoji pack catalogue',
  ],
  medium: [
    'an event booking system with availability and cancellation refund rules',
    'a hotel room reservation with date-overlap checks',
    'a shopping cart with discount tiers and coupon validation',
    'a leave/holiday request approval with per-employee quotas',
    'a parking-lot allocation with vehicle-type rules',
    'a subscription billing with plan upgrades and downgrades',
    'a food-delivery order with zone-based delivery fees',
    'a library loan with overdue fines and renewal limits',
    'a gym class booking with capacity and waitlist handling',
    'a flight seat selection with fare classes',
    'a support ticket queue with priority routing',
    'a loyalty-points accrual and redemption flow',
    'a ride fare estimation with surge time windows',
    'an inventory restock with reorder thresholds',
    'an appointment scheduler with working-hour constraints',
    'a currency exchange with tiered spreads',
    'a course enrollment with prerequisite checks',
    'a promo-code engine with simple stacking rules',
    'a warehouse pick-list with order batching',
    'a meeting-room booking with conflict resolution',
  ],
  high: [
    'an insurance claims workflow (claim type, customer tier, coverage limits, fraud flags)',
    'a loan approval engine (credit-score bands, income, collateral, risk tiers)',
    'an e-commerce checkout (tax, shipping, multiple coupons, inventory, fraud checks)',
    'a payroll calculation (tax brackets, overtime, deductions, benefits)',
    'a tax-return assessment (multiple income types, deductions, credits)',
    'an order-fulfilment routing (warehouse stock, carrier rules, SLAs)',
    'a fraud-detection scoring engine (multiple weighted signals and thresholds)',
    'a medical triage prioritisation (symptoms, vitals, risk factors)',
    'a telecom billing rating (call types, tiers, roaming, taxes)',
    'a mortgage eligibility engine (DTI, LTV, employment, property type)',
    'a logistics dispatch optimiser (capacity, time windows, priorities)',
    'a dynamic pricing engine (demand, inventory, competitor price, customer segment)',
    'a KYC/AML compliance check (document types, risk countries, watchlists)',
    'a student grading and progression engine (weighted components, resits, caps)',
    'a supply-chain reorder planner (lead times, safety stock, seasonality)',
    'an access-control policy evaluator (roles, resources, conditions, hierarchy)',
    'a promotion eligibility engine (segments, purchase history, stacking, exclusions)',
    'an energy tariff calculator (time-of-use, tiers, surcharges, rebates)',
    'a cancellation-penalty engine (timing, customer tier, reason, partial refunds)',
    'a multi-currency invoice reconciliation (FX, rounding, tax, disputes)',
  ],
};

/**
 * Builds the Zero-Shot generation prompt for one corpus file. Intentionally does NOT
 * mention metric thresholds, clean code, design patterns, or refactoring — the goal is
 * raw, unconstrained output that carries realistic technical debt.
 */
function buildPrompt(type: ComponentType, tier: Tier, domain: string): string {
  return [
    `Generate ${COMPONENT_SPEC[type]}.`,
    `Domain: ${domain}.`,
    TIER_SPEC[tier],
    `Produce a single, self-contained TypeScript file that is syntactically valid and compiles in a NestJS project.`,
    `Return ONLY the raw TypeScript source code — no Markdown fences, no comments explaining the code, no prose before or after.`,
  ].join('\n');
}

interface ManifestEntry {
  file: string;
  componentType: ComponentType;
  tier: Tier;
  index: number;
  intendedBand: string;
  domain: string;
  prompt: string;
  // To be filled in by the researcher AFTER manual generation + measurement:
  measuredCC: number | null;
  measuredMI: number | null;
  measuredDR: number | null;
  inBand: boolean | null;
  generatedWith: string | null; // e.g. "Gemini 2.5 / ChatGPT / Claude — agent used"
}

// ---------------------------------------------------------------------------
// Main — writes prompt artefacts only, never calls a network/API.
// ---------------------------------------------------------------------------

function main() {
  const corpusDir = path.resolve(process.cwd(), 'corpus');
  const promptsDir = path.join(corpusDir, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });

  const manifest: ManifestEntry[] = [];
  const md: string[] = [];

  md.push('# LinterFlow — Zero-Shot Corpus Prompts');
  md.push('');
  md.push(
    '60 prompts: 5 NestJS component types × 3 complexity tiers × 4 files.',
  );
  md.push('');
  md.push(
    'Intended CC bands (maximum Cyclomatic Complexity per function): Low = `max CC <= 5`, Medium = `5 < max CC <= 10`, High = `max CC > 10`.',
  );
  md.push('');
  md.push('## Materialising these prompts (phase 1b)');
  md.push('');
  md.push('Two ways to turn the prompts below into measured corpus files.');
  md.push(
    'Both preserve the Zero-Shot condition — it lives in the CONTENT of the',
  );
  md.push('prompt, not in the channel it travels through.');
  md.push('');
  md.push('### Automated (recommended) — ~3 h');
  md.push('');
  md.push('```bash');
  md.push(
    'npm run corpus:build            # generate + measure + regenerate what is missing',
  );
  md.push(
    'npm run corpus:build -- --measure-only   # re-measure only, no API calls',
  );
  md.push('```');
  md.push('');
  md.push(
    'Generates through the Gemini API at temperature 0.9, measures with the same',
  );
  md.push(
    'EvaluatorService the pipeline uses, and regenerates anything outside its tier',
  );
  md.push(
    'band. Records `measuredCC/MI/DR`, `inBand`, `generatedWith` and `attempts`.',
  );
  md.push('');
  md.push('### Manual — ~13 h');
  md.push('');
  md.push('1. Copy a prompt below into your AI agent / chat assistant.');
  md.push(
    '2. Save the returned code verbatim as `corpus/<type>_<tier>_<index>.ts`.',
  );
  md.push('3. Measure it: `npm run corpus:build -- --measure-only`.');
  md.push(
    '4. **Tier verification:** if the measured CC is OUTSIDE the intended band, discard',
  );
  md.push(
    '   the file and regenerate with the SAME prompt until it lands within band.',
  );
  md.push(
    '5. Record the model used in `generatedWith` — keep it identical across all 60.',
  );
  md.push('');
  md.push('### Rules that apply to both');
  md.push('');
  md.push(
    '- Do not edit the prompts to mention quality, metrics, clean code, or patterns —',
  );
  md.push(
    '  that would break the Zero-Shot condition the experiment depends on.',
  );
  md.push(
    '- Do not edit a prompt to steer its measured CC either. Regeneration relies on the',
  );
  md.push(
    "  model's non-determinism, with the prompt kept byte-identical between attempts.",
  );
  md.push(
    '- Keep the same model across all 60 files: it is a controlled variable.',
  );
  md.push('');

  let count = 0;
  const total = COMPONENT_TYPES.length * TIERS.length * FILES_PER_COMBINATION;

  for (const type of COMPONENT_TYPES) {
    for (const tier of TIERS) {
      for (let index = 1; index <= FILES_PER_COMBINATION; index++) {
        count++;
        const componentSlot = COMPONENT_TYPES.indexOf(type); // 0..4
        const domainSlot = componentSlot * FILES_PER_COMBINATION + (index - 1); // 0..19
        const domain = DOMAINS[tier][domainSlot];

        const fileName = `${type}_${tier}_${index}.ts`;
        const promptName = `${type}_${tier}_${index}.prompt.txt`;
        const prompt = buildPrompt(type, tier, domain);

        fs.writeFileSync(
          path.join(promptsDir, promptName),
          prompt + '\n',
          'utf-8',
        );

        manifest.push({
          file: fileName,
          componentType: type,
          tier,
          index,
          intendedBand: TIER_BAND[tier].label,
          domain,
          prompt,
          measuredCC: null,
          measuredMI: null,
          measuredDR: null,
          inBand: null,
          generatedWith: null,
        });

        md.push(
          `### ${count}. \`${fileName}\`  —  tier: ${tier} (${TIER_BAND[tier].label})`,
        );
        md.push('');
        md.push('```text');
        md.push(prompt);
        md.push('```');
        md.push('');
      }
    }
  }

  // Guard: once build-corpus.ts has measured the corpus, the manifest holds the only
  // record of measuredCC/MI/DR. Blindly rewriting it here would reset all 60 slots to
  // null and silently destroy the measurements. Refuse unless --force is passed.
  const manifestPath = path.join(corpusDir, 'manifest.json');
  const force = process.argv.includes('--force');

  if (fs.existsSync(manifestPath) && !force) {
    const existing = JSON.parse(
      fs.readFileSync(manifestPath, 'utf-8'),
    ) as ManifestEntry[];
    const measured = existing.filter((e) => e.measuredCC !== null).length;

    if (measured > 0) {
      console.error(
        `\n❌ Refusing to overwrite ${manifestPath}: it already holds ${measured} measured file(s).\n` +
          `   Rewriting it would reset every measuredCC/MI/DR to null.\n` +
          `   Pass --force if you really mean to discard the measurements.\n`,
      );
      process.exit(1);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(path.join(corpusDir, 'PROMPTS.md'), md.join('\n'), 'utf-8');

  console.log(`✅ Wrote ${total} prompts to ${promptsDir}`);
  console.log(
    `📄 Combined prompt sheet: ${path.join(corpusDir, 'PROMPTS.md')}`,
  );
  console.log(
    `📄 Manifest (fill metrics after generation): ${path.join(corpusDir, 'manifest.json')}`,
  );
  console.log(
    '\nNext (phase 1b): run "npm run corpus:build" to generate, measure and regenerate',
  );
  console.log(
    'the 60 files automatically — or follow the manual workflow in PROMPTS.md instead.',
  );
}

main();
